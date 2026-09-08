const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Tmux, sessionName, parseSessionName, isValidId, formatAge } = require('./tmux');

function fakeExec(responses = {}) {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push([bin, ...args]);
    const key = args[0];
    const r = responses[key];
    if (r instanceof Error) throw r;
    return { stdout: typeof r === 'string' ? r : '', stderr: '' };
  };
  return { exec, calls };
}

describe('sessionName', () => {
  it('builds devshop-<id>-<command>', () => {
    assert.equal(sessionName('proj-001-my-app', 'run'), 'devshop-proj-001-my-app-run');
  });

  it('rejects IDs that are not kebab-case', () => {
    for (const bad of ['My App', '../x', 'a;rm -rf', '', 'x=y']) {
      assert.throws(() => sessionName(bad, 'run'), /Invalid project ID/);
    }
  });

  it('rejects commands outside the allowlist', () => {
    assert.throws(() => sessionName('my-app', 'deploy'), /Invalid command/);
    assert.throws(() => sessionName('my-app', 'status'), /Invalid command/);
  });

  it('round-trips through parseSessionName', () => {
    assert.deepEqual(parseSessionName(sessionName('proj-001-my-app', 'pair')), { projectId: 'proj-001-my-app', command: 'pair' });
    assert.equal(parseSessionName('devshop-remote'), null);
    assert.equal(parseSessionName('other-session'), null);
  });

  it('isValidId', () => {
    assert.equal(isValidId('my-app2'), true);
    assert.equal(isValidId('-leading'), false);
    assert.equal(isValidId(undefined), false);
  });
});

describe('formatAge', () => {
  it('formats seconds, minutes, hours', () => {
    assert.equal(formatAge(42), '42s');
    assert.equal(formatAge(125), '2m');
    assert.equal(formatAge(3600 * 2 + 60 * 5), '2h 05m');
  });
});

describe('Tmux', () => {
  it('newSession passes an argv array with -- and never a shell string', async () => {
    const { exec, calls } = fakeExec();
    const tmux = new Tmux({ exec });
    await tmux.newSession({ name: 'devshop-x-run', cwd: '/root dir', argv: ['/usr/bin/node', '/p/index.js', 'run', 'x', '--remote-control'] });
    assert.deepEqual(calls[0], ['tmux', 'new-session', '-d', '-s', 'devshop-x-run', '-c', '/root dir', '--', '/usr/bin/node', '/p/index.js', 'run', 'x', '--remote-control']);
  });

  it('newSession attaches in the foreground when detached is false', async () => {
    const { exec, calls } = fakeExec();
    await new Tmux({ exec }).newSession({ name: 's', cwd: '/c', argv: ['x'], detached: false });
    assert.ok(!calls[0].includes('-d'));
  });

  it('hasSession uses the exact-match target form', async () => {
    const { exec, calls } = fakeExec();
    assert.equal(await new Tmux({ exec }).hasSession('devshop-x-run'), true);
    assert.deepEqual(calls[0], ['tmux', 'has-session', '-t', '=devshop-x-run']);
    const missing = fakeExec({ 'has-session': new Error('no session') });
    assert.equal(await new Tmux({ exec: missing.exec }).hasSession('nope'), false);
  });

  it('listSessions returns only devshop- sessions with parsed fields and age', async () => {
    const now = 1_000_000 * 1000;
    const { exec } = fakeExec({ 'list-sessions': 'devshop-proj-a-run|999900\nother|999000\ndevshop-remote|990000\n' });
    const sessions = await new Tmux({ exec, now: () => now }).listSessions();
    assert.deepEqual(sessions.map(s => s.name), ['devshop-proj-a-run', 'devshop-remote']);
    assert.equal(sessions[0].projectId, 'proj-a');
    assert.equal(sessions[0].command, 'run');
    assert.equal(sessions[0].ageSeconds, 100);
    assert.equal(sessions[0].age, '1m');
    assert.equal(sessions[1].projectId, undefined);
  });

  it('listSessions is empty when tmux has no server', async () => {
    const { exec } = fakeExec({ 'list-sessions': new Error('no server running') });
    assert.deepEqual(await new Tmux({ exec }).listSessions(), []);
  });

  it('sendText sends literal text (after --) then Enter', async () => {
    const { exec, calls } = fakeExec();
    await new Tmux({ exec }).sendText('devshop-x-run', '-dash /exit $(rm)');
    assert.deepEqual(calls[0], ['tmux', 'send-keys', '-t', '=devshop-x-run:', '-l', '--', '-dash /exit $(rm)']);
    assert.deepEqual(calls[1], ['tmux', 'send-keys', '-t', '=devshop-x-run:', 'Enter']);
  });

  it('sendKey and killSession target the exact session', async () => {
    const { exec, calls } = fakeExec();
    const tmux = new Tmux({ exec });
    await tmux.sendKey('s', 'C-c');
    assert.deepEqual(calls[0], ['tmux', 'send-keys', '-t', '=s:', 'C-c']);
    assert.equal(await tmux.killSession('s'), true);
    assert.deepEqual(calls[1], ['tmux', 'kill-session', '-t', '=s']);
  });
});
