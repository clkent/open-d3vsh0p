const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('child_process');
const path = require('path');
const { remoteCommand, agentSessionName, STOP_GRACE_MS } = require('./remote');
const { INDEX_JS } = require('../remote/remote-plist');

const registry = {
  projects: [
    { id: 'proj-001-alpha', name: 'alpha', projectDir: '/tmp/alpha' },
    { id: 'proj-002-beta', name: 'beta', projectDir: '/tmp/beta' }
  ]
};

function fakeTmux({ existing = [], sessions = [] } = {}) {
  const calls = [];
  const alive = new Set(existing);
  return {
    calls, alive,
    hasSession: async (n) => { calls.push(['has', n]); return alive.has(n); },
    newSession: async (o) => { calls.push(['new', o]); alive.add(o.name); },
    listSessions: async () => sessions.filter(s => alive.has(s.name)),
    sendText: async (n, t) => calls.push(['text', n, t]),
    sendKey: async (n, k) => calls.push(['key', n, k]),
    killSession: async (n) => { calls.push(['kill', n]); return alive.delete(n); },
    capturePane: async () => 'Session URL: https://claude.ai/code/abc123XYZ?x=1\n'
  };
}

function makeDeps(overrides = {}) {
  const logs = [];
  const errors = [];
  const execCalls = [];
  const tmux = overrides.tmux || fakeTmux();
  return {
    logs, errors, execCalls, tmux,
    deps: {
      tmux,
      exec: async (bin, args) => { execCalls.push([bin, ...args]); return overrides.execResult?.(bin, args) || { stdout: '' }; },
      log: (m) => logs.push(m),
      error: (m) => errors.push(m),
      loadRegistry: async () => registry,
      loadConfig: async () => ({ remoteControl: { serverName: 'ctl' } }),
      ensureControlDir: async () => '/ctl',
      runControlServer: async (o) => { execCalls.push(['server', o]); return 0; },
      sleep: async () => {},
      nodePath: '/opt/node',
      fs: { mkdir: async () => {}, writeFile: async (p, c) => execCalls.push(['write', p, c.length]), unlink: async () => {}, access: async () => {} },
      home: '/Users/me',
      ...overrides.deps
    }
  };
}

describe('agentSessionName', () => {
  it('maps commands to agent names', () => {
    assert.equal(agentSessionName('run', 'p'), 'Morgan — p');
    assert.equal(agentSessionName('pair', 'p'), 'Morgan — p');
    assert.equal(agentSessionName('talk', 'p'), 'Riley — p');
    assert.equal(agentSessionName('kickoff', 'p'), 'Riley — p kickoff');
  });
});

describe('remote launch', () => {
  it('starts a detached tmux session running the orchestrator with --remote-control', async () => {
    const d = makeDeps();
    const code = await remoteCommand('launch', ['run', 'alpha'], {}, d.deps);
    assert.equal(code, 0);
    const [, opts] = d.tmux.calls.find(c => c[0] === 'new');
    assert.equal(opts.name, 'devshop-proj-001-alpha-run');
    assert.equal(opts.detached, true);
    assert.deepEqual(opts.argv, ['/opt/node', INDEX_JS, 'run', 'proj-001-alpha', '--remote-control']);
    assert.ok(d.logs.some(l => /Morgan — proj-001-alpha/.test(l)));
  });

  it('passes --resume through for run and pair', async () => {
    const d = makeDeps();
    await remoteCommand('launch', ['pair', 'beta'], { resume: true }, d.deps);
    const [, opts] = d.tmux.calls.find(c => c[0] === 'new');
    assert.deepEqual(opts.argv.slice(-2), ['--remote-control', '--resume']);
  });

  it('rejects commands outside the allowlist without touching tmux', async () => {
    const d = makeDeps();
    assert.equal(await remoteCommand('launch', ['deploy', 'alpha'], {}, d.deps), 1);
    assert.equal(d.tmux.calls.length, 0);
    assert.ok(d.errors.some(e => /run, talk, pair, kickoff/.test(e)));
  });

  it('rejects an unknown project', async () => {
    const d = makeDeps();
    assert.equal(await remoteCommand('launch', ['run', 'nope'], {}, d.deps), 1);
    assert.equal(d.tmux.calls.length, 0);
  });

  it('refuses a duplicate session and points at the existing one', async () => {
    const d = makeDeps({ tmux: fakeTmux({ existing: ['devshop-proj-001-alpha-run'] }) });
    assert.equal(await remoteCommand('launch', ['run', 'alpha'], {}, d.deps), 1);
    assert.ok(!d.tmux.calls.some(c => c[0] === 'new'));
    assert.ok(d.errors.some(e => /tmux attach -t devshop-proj-001-alpha-run/.test(e)));
  });

  it('kickoff takes a validated new name and never --resume', async () => {
    const d = makeDeps();
    assert.equal(await remoteCommand('launch', ['kickoff', 'New App'], {}, d.deps), 1);
    assert.equal(await remoteCommand('launch', ['kickoff', 'new-app'], { resume: true }, d.deps), 0);
    const [, opts] = d.tmux.calls.find(c => c[0] === 'new');
    assert.equal(opts.name, 'devshop-new-app-kickoff');
    assert.deepEqual(opts.argv.slice(2), ['kickoff', 'new-app', '--remote-control']);
  });
});

describe('remote sessions', () => {
  it('lists launcher sessions and hides the control session', async () => {
    const tmux = fakeTmux({
      existing: ['devshop-proj-001-alpha-run', 'devshop-remote'],
      sessions: [
        { name: 'devshop-proj-001-alpha-run', projectId: 'proj-001-alpha', command: 'run', age: '5m' },
        { name: 'devshop-remote', age: '1h 00m' }
      ]
    });
    const d = makeDeps({ tmux });
    assert.equal(await remoteCommand('sessions', [], {}, d.deps), 0);
    assert.equal(d.logs.length, 1);
    assert.match(d.logs[0], /devshop-proj-001-alpha-run\s+proj-001-alpha\s+run\s+up 5m/);
  });

  it('prints No remote sessions when empty', async () => {
    const d = makeDeps();
    await remoteCommand('sessions', [], {}, d.deps);
    assert.deepEqual(d.logs, ['No remote sessions']);
  });
});

describe('remote stop', () => {
  const sessions = [
    { name: 'devshop-proj-001-alpha-run', projectId: 'proj-001-alpha', command: 'run', age: '5m' },
    { name: 'devshop-proj-001-alpha-talk', projectId: 'proj-001-alpha', command: 'talk', age: '2m' }
  ];

  it('sends /exit and reports ended once the session disappears', async () => {
    const tmux = fakeTmux({ existing: ['devshop-proj-001-alpha-run'], sessions });
    const origSendText = tmux.sendText;
    tmux.sendText = async (n, t) => { await origSendText(n, t); tmux.alive.delete(n); };
    const d = makeDeps({ tmux });
    assert.equal(await remoteCommand('stop', ['alpha'], {}, d.deps), 0);
    assert.deepEqual(tmux.calls.find(c => c[0] === 'text'), ['text', 'devshop-proj-001-alpha-run', '/exit']);
    assert.ok(!tmux.calls.some(c => c[0] === 'key'));
    assert.ok(d.logs.some(l => /devshop-proj-001-alpha-run: ended/.test(l)));
  });

  it('sends Ctrl-C after the grace period when the session lingers', async () => {
    const tmux = fakeTmux({ existing: ['devshop-proj-001-alpha-run'], sessions });
    let slept = 0;
    const d = makeDeps({ tmux, deps: { sleep: async (ms) => { slept += ms; } } });
    await remoteCommand('stop', ['alpha'], {}, d.deps);
    assert.ok(slept >= STOP_GRACE_MS);
    assert.deepEqual(tmux.calls.find(c => c[0] === 'key'), ['key', 'devshop-proj-001-alpha-run', 'C-c']);
  });

  it('--command limits the stop to one session type', async () => {
    const tmux = fakeTmux({ existing: ['devshop-proj-001-alpha-run', 'devshop-proj-001-alpha-talk'], sessions });
    tmux.sendText = async (n) => { tmux.alive.delete(n); };
    const d = makeDeps({ tmux });
    await remoteCommand('stop', ['alpha'], { command: 'talk' }, d.deps);
    assert.ok(tmux.alive.has('devshop-proj-001-alpha-run'), 'run session untouched');
    assert.ok(!tmux.alive.has('devshop-proj-001-alpha-talk'));
  });

  it('reports nothing to stop', async () => {
    const d = makeDeps();
    assert.equal(await remoteCommand('stop', ['beta'], {}, d.deps), 0);
    assert.deepEqual(d.logs, ['No remote sessions for proj-002-beta']);
  });
});

describe('remote start / install / remove / status', () => {
  it('start refuses when claude auth status reports no claude.ai login', async () => {
    const d = makeDeps({ execResult: (bin, args) => bin === 'claude' ? { stdout: JSON.stringify({ loggedIn: true, authMethod: 'apiKey' }) } : null });
    assert.equal(await remoteCommand('start', [], {}, d.deps), 1);
    assert.ok(d.errors.some(e => /claude\.ai login/.test(e)));
    assert.ok(!d.execCalls.some(c => c[0] === 'server'));
    const out = makeDeps({ execResult: (bin) => bin === 'claude' ? { stdout: JSON.stringify({ loggedIn: false }) } : null });
    assert.equal(await remoteCommand('start', [], {}, out.deps), 1);
  });

  it('start proceeds when auth status is claude.ai or unavailable', async () => {
    const ok = makeDeps({ execResult: (bin) => bin === 'claude' ? { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) } : null });
    assert.equal(await remoteCommand('start', [], {}, ok.deps), 0);
    const unknown = makeDeps({ execResult: (bin) => bin === 'claude' ? { stdout: 'not json' } : null });
    assert.equal(await remoteCommand('start', [], {}, unknown.deps), 0);
  });

  it('start regenerates the control dir and runs the server with the configured name', async () => {
    const d = makeDeps();
    assert.equal(await remoteCommand('start', [], {}, d.deps), 0);
    const server = d.execCalls.find(c => c[0] === 'server');
    assert.deepEqual(server[1], { controlDir: '/ctl', serverName: 'ctl' });
  });

  it('install writes the plist and loads it', async () => {
    const d = makeDeps({ execResult: (bin, args) => bin === 'which' ? { stdout: '/opt/homebrew/bin/tmux\n' } : null });
    assert.equal(await remoteCommand('install', [], {}, d.deps), 0);
    const write = d.execCalls.find(c => c[0] === 'write');
    assert.equal(write[1], '/Users/me/Library/LaunchAgents/com.devshop.remote.plist');
    assert.ok(d.execCalls.some(c => c[0] === 'launchctl' && c[1] === 'load'));
  });

  it('install fails clearly without tmux', async () => {
    const d = makeDeps({ execResult: (bin) => bin === 'which' ? { stdout: '\n' } : null });
    assert.equal(await remoteCommand('install', [], {}, d.deps), 1);
    assert.ok(d.errors.some(e => /tmux not found/.test(e)));
  });

  it('remove unloads, deletes the plist, and kills the control session', async () => {
    const tmux = fakeTmux({ existing: ['devshop-remote'] });
    const d = makeDeps({ tmux });
    assert.equal(await remoteCommand('remove', [], {}, d.deps), 0);
    assert.ok(d.execCalls.some(c => c[0] === 'launchctl' && c[1] === 'unload'));
    assert.deepEqual(tmux.calls.find(c => c[0] === 'kill'), ['kill', 'devshop-remote']);
  });

  it('status reports plist, tmux session, server process, and the session URL from the pane', async () => {
    const tmux = fakeTmux({ existing: ['devshop-remote'] });
    const d = makeDeps({
      tmux,
      execResult: (bin, args) => bin === 'launchctl' ? { stdout: '123\t0\tcom.devshop.remote\n' } : { stdout: '' }
    });
    assert.equal(await remoteCommand('status', [], {}, d.deps), 0);
    const out = d.logs.join('\n');
    assert.match(out, /launchd plist:\s+installed, loaded/);
    assert.match(out, /tmux session:\s+devshop-remote up/);
    assert.match(out, /server process:\s+running/);
    assert.match(out, /session URL:\s+https:\/\/claude\.ai\/code\/abc123XYZ/);
  });

  it('unknown subcommand lists the valid ones', async () => {
    const d = makeDeps();
    assert.equal(await remoteCommand('bogus', [], {}, d.deps), 1);
    assert.ok(d.errors.some(e => /start, install, remove, status, launch, sessions, stop/.test(e)));
  });
});

describe('remote CLI wiring', () => {
  it('is listed in help with its subcommands', async () => {
    const indexPath = path.join(__dirname, '..', 'index.js');
    const stdout = await new Promise((resolve, reject) => {
      execFile('node', [indexPath, 'help'], (err, out) => err ? reject(err) : resolve(out));
    });
    assert.match(stdout, /remote <sub> \[args\]/);
    assert.match(stdout, /launch <run\|talk\|pair\|kickoff>/);
  });

  it('remote without a subcommand exits 1 with guidance', async () => {
    const indexPath = path.join(__dirname, '..', 'index.js');
    const result = await new Promise((resolve) => {
      execFile('node', [indexPath, 'remote'], (err, out, stderr) => resolve({ code: err?.code ?? 0, stderr }));
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /remote requires a subcommand/);
  });
});
