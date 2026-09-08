const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { runControlServer, RAPID_EXIT_MS, MAX_RAPID_EXITS } = require('./server');

/** Fake spawn: each call pops the next {code, ranMs} script entry. */
function fakeSpawn(script, clock) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.kill = () => { setImmediate(() => child.emit('exit', 0)); };
    const step = script.shift() || { code: 0, ranMs: RAPID_EXIT_MS + 1 };
    setImmediate(() => {
      clock.t += step.ranMs;
      if (step.hang) return; // stays running until killed
      child.emit('exit', step.code);
    });
    return child;
  };
  return { spawn, calls };
}

function deps(script, clock, signals = new EventEmitter()) {
  const { spawn, calls } = fakeSpawn(script, clock);
  const logs = [];
  const sleeps = [];
  return {
    calls, logs, sleeps,
    deps: {
      spawn,
      log: (m) => logs.push(m),
      now: () => clock.t,
      sleep: async (ms) => { sleeps.push(ms); },
      signals
    }
  };
}

describe('runControlServer', () => {
  it('starts server mode in the control dir with the session name', async () => {
    const clock = { t: 0 };
    const signals = new EventEmitter();
    const d = deps([{ code: 0, ranMs: RAPID_EXIT_MS + 1, hang: true }], clock, signals);
    const run = runControlServer({ controlDir: '/ctl', serverName: 'ctl name', deps: d.deps });
    await new Promise(r => setImmediate(r));
    signals.emit('SIGINT');
    assert.equal(await run, 0);
    assert.equal(d.calls[0].bin, 'claude');
    assert.deepEqual(d.calls[0].args, ['remote-control', '--name', 'ctl name', '--spawn', 'session']);
    assert.equal(d.calls[0].opts.cwd, '/ctl');
    assert.equal(d.calls[0].opts.stdio, 'inherit');
  });

  it('restarts with --continue after a long-lived server exits, with backoff', async () => {
    const clock = { t: 0 };
    const signals = new EventEmitter();
    const d = deps([
      { code: 1, ranMs: 20 * 60 * 1000 }, // served, then network give-up
      { code: 1, ranMs: 20 * 60 * 1000 },
      { code: 0, ranMs: 60 * 1000, hang: true }
    ], clock, signals);
    const run = runControlServer({ controlDir: '/ctl', serverName: 'n', deps: d.deps });
    for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r));
    signals.emit('SIGINT');
    assert.equal(await run, 0);
    assert.equal(d.calls.length, 3);
    assert.ok(!d.calls[0].args.includes('--continue'));
    assert.ok(d.calls[1].args.includes('--continue'));
    assert.ok(d.calls[2].args.includes('--continue'));
    assert.deepEqual(d.sleeps, [5000, 5000], 'backoff resets after each healthy run');
  });

  it('gives up with guidance after consecutive rapid exits', async () => {
    const clock = { t: 0 };
    const d = deps(Array.from({ length: MAX_RAPID_EXITS }, () => ({ code: 1, ranMs: 100 })), clock);
    const code = await runControlServer({ controlDir: '/ctl', serverName: 'n', deps: d.deps });
    assert.equal(code, 1);
    assert.equal(d.calls.length, MAX_RAPID_EXITS);
    assert.ok(d.calls.every(c => !c.args.includes('--continue')), 'never --continue without a served session');
    assert.ok(d.logs.some(l => /claude auth login/.test(l)));
  });

  it('escalates backoff across repeated rapid exits before the cap', async () => {
    const clock = { t: 0 };
    const d = deps([{ code: 1, ranMs: 100 }, { code: 1, ranMs: 100 }, { code: 1, ranMs: 100 }], clock);
    await runControlServer({ controlDir: '/ctl', serverName: 'n', deps: d.deps });
    assert.deepEqual(d.sleeps, [5000, 15000]);
  });
});
