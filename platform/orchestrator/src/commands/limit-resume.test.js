const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');
const {
  isValidSessionId,
  transcriptPath,
  probeAvailability,
  watchForStall,
  waitForLimitReset,
  runSessionWithAutoResume
} = require('./limit-resume');

/** Fake `claude -p` process for probe tests. */
function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdout.resume = () => {};
  proc.kill = () => { proc.killed = true; };
  return proc;
}

describe('isValidSessionId', () => {
  it('accepts a canonical UUID', () => {
    assert.ok(isValidSessionId('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'));
  });

  it('rejects traversal-shaped values', () => {
    assert.ok(!isValidSessionId('../../etc/passwd'));
  });

  it('rejects malformed and non-string values', () => {
    assert.ok(!isValidSessionId('morgan-session-123'));
    assert.ok(!isValidSessionId(''));
    assert.ok(!isValidSessionId(null));
    assert.ok(!isValidSessionId({ toString: () => 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }));
  });
});

describe('transcriptPath', () => {
  it('sanitizes the project dir like Claude Code does', () => {
    const p = transcriptPath('/Users/devshop/d3vsh0p', 'abc-123');
    assert.equal(p, path.join(os.homedir(), '.claude', 'projects', '-Users-devshop-d3vsh0p', 'abc-123.jsonl'));
  });
});

describe('probeAvailability', () => {
  it('classifies exit 0 as available', async () => {
    const proc = makeFakeProc();
    const verdict = probeAvailability({ spawnFn: () => proc });
    proc.emit('exit', 0);
    assert.equal(await verdict, 'available');
  });

  it('classifies limit-pattern stderr as limited', async () => {
    const proc = makeFakeProc();
    const verdict = probeAvailability({ spawnFn: () => proc });
    proc.stderr.emit('data', "You've hit your session limit · resets 3:45pm");
    proc.emit('exit', 1);
    assert.equal(await verdict, 'limited');
  });

  it('classifies weekly-limit stderr as limited', async () => {
    const proc = makeFakeProc();
    const verdict = probeAvailability({ spawnFn: () => proc });
    proc.stderr.emit('data', "You've hit your weekly limit · resets Mon 12:00am");
    proc.emit('exit', 1);
    assert.equal(await verdict, 'limited');
  });

  it('classifies non-limit failures as unknown', async () => {
    const proc = makeFakeProc();
    const verdict = probeAvailability({ spawnFn: () => proc });
    proc.stderr.emit('data', 'connect ECONNREFUSED');
    proc.emit('exit', 1);
    assert.equal(await verdict, 'unknown');
  });

  it('classifies spawn errors as unknown', async () => {
    const proc = makeFakeProc();
    const verdict = probeAvailability({ spawnFn: () => proc });
    proc.emit('error', new Error('ENOENT'));
    assert.equal(await verdict, 'unknown');
  });

  it('classifies a hung probe as unknown via timeout', async () => {
    const proc = makeFakeProc();
    const verdict = await probeAvailability({ spawnFn: () => proc, timeoutMs: 10 });
    assert.equal(verdict, 'unknown');
    assert.ok(proc.killed);
  });

  it('never echoes probe stderr to the orchestrator output', async () => {
    const marker = '[31mEVIL-ANSI-OUTPUT[0m';
    const outWrites = [];
    const errWrites = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk, ...rest) => { outWrites.push(String(chunk)); return origOut(chunk, ...rest); };
    process.stderr.write = (chunk, ...rest) => { errWrites.push(String(chunk)); return origErr(chunk, ...rest); };
    try {
      const proc = makeFakeProc();
      const verdict = probeAvailability({ spawnFn: () => proc });
      proc.stderr.emit('data', marker);
      proc.emit('exit', 1);
      await verdict;
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    assert.ok(!outWrites.some(w => w.includes('EVIL-ANSI-OUTPUT')));
    assert.ok(!errWrites.some(w => w.includes('EVIL-ANSI-OUTPUT')));
  });
});

describe('watchForStall', () => {
  it('kills via onLimitDetected when a stall is confirmed limited', async () => {
    let t = 0;
    let limitCalls = 0;
    const watcher = watchForStall({
      transcriptFile: '/fake/transcript.jsonl',
      onLimitDetected: () => { limitCalls++; },
      deps: {
        statFn: async () => { t += 10; return { mtimeMs: 100 }; },
        probe: async () => 'limited',
        now: () => t,
        log: () => {},
        pollMs: 1,
        stallThresholdMs: 5
      }
    });
    await watcher.done;
    assert.equal(limitCalls, 1);
  });

  it('backs off after a benign idle — no re-probe without new activity', async () => {
    let t = 0;
    let probeCalls = 0;
    let limitCalls = 0;
    let polls = 0;
    let resolveEnough;
    const enoughPolls = new Promise(r => { resolveEnough = r; });
    const watcher = watchForStall({
      transcriptFile: '/fake/transcript.jsonl',
      onLimitDetected: () => { limitCalls++; },
      deps: {
        statFn: async () => {
          t += 10;
          polls++;
          if (polls >= 10) resolveEnough();
          return { mtimeMs: 100 };
        },
        probe: async () => { probeCalls++; return 'available'; },
        now: () => t,
        log: () => {},
        pollMs: 1,
        stallThresholdMs: 5
      }
    });
    await enoughPolls;
    watcher.stop();
    await watcher.done;
    assert.equal(probeCalls, 1);
    assert.equal(limitCalls, 0);
  });

  it('re-arms after new activity and confirms a later limit', async () => {
    let t = 0;
    let polls = 0;
    let probeCalls = 0;
    let limitCalls = 0;
    const watcher = watchForStall({
      transcriptFile: '/fake/transcript.jsonl',
      onLimitDetected: () => { limitCalls++; },
      deps: {
        statFn: async () => {
          t += 10;
          polls++;
          // constant mtime, then a burst of activity at poll 5, constant again
          return { mtimeMs: polls === 5 ? 200 : polls > 5 ? 300 : 100 };
        },
        probe: async () => { probeCalls++; return probeCalls === 1 ? 'available' : 'limited'; },
        now: () => t,
        log: () => {},
        pollMs: 1,
        stallThresholdMs: 5
      }
    });
    await watcher.done;
    assert.equal(probeCalls, 2);
    assert.equal(limitCalls, 1);
  });

  it('self-disables with a warning when the transcript never appears', async () => {
    const logs = [];
    let limitCalls = 0;
    const watcher = watchForStall({
      transcriptFile: '/does/not/exist.jsonl',
      onLimitDetected: () => { limitCalls++; },
      deps: {
        statFn: async () => { throw new Error('ENOENT'); },
        probe: async () => 'limited',
        log: (msg) => logs.push(msg),
        pollMs: 1,
        stallThresholdMs: 5
      }
    });
    await watcher.done;
    assert.equal(limitCalls, 0);
    assert.ok(logs.some(l => l.includes('stall detection disabled')));
  });
});

describe('waitForLimitReset', () => {
  it('gives up immediately at the resume cap without probing', async () => {
    let probeCalls = 0;
    const outcome = await waitForLimitReset({
      resumeCount: 2,
      deps: { probe: async () => { probeCalls++; return 'available'; }, log: () => {} }
    });
    assert.deepEqual(outcome, { verdict: 'giveUp', reason: 'resume_cap' });
    assert.equal(probeCalls, 0);
  });

  it('resumes when a probe returns available', async () => {
    const outcome = await waitForLimitReset({
      resumeCount: 0,
      deps: { probe: async () => 'available', log: () => {}, intervalMs: 1 }
    });
    assert.deepEqual(outcome, { verdict: 'resume', reason: 'limit_lifted' });
  });

  it('keeps waiting on limited/unknown, then resumes', async () => {
    const verdicts = ['limited', 'unknown', 'available'];
    const outcome = await waitForLimitReset({
      resumeCount: 0,
      deps: { probe: async () => verdicts.shift(), log: () => {}, intervalMs: 1 }
    });
    assert.equal(outcome.verdict, 'resume');
    assert.equal(verdicts.length, 0);
  });

  it('gives up when max wait is exceeded', async () => {
    const outcome = await waitForLimitReset({
      resumeCount: 0,
      deps: { probe: async () => 'limited', log: () => {}, intervalMs: 1, maxWaitMs: 0 }
    });
    assert.deepEqual(outcome, { verdict: 'giveUp', reason: 'max_wait' });
  });

  it('gives up when the window end would be exceeded', async () => {
    const outcome = await waitForLimitReset({
      resumeCount: 0,
      windowEndTimeMs: 1050,
      deps: {
        probe: async () => 'limited',
        now: () => 1000,
        log: () => {},
        intervalMs: 100,
        minWindowRemainingMs: 0
      }
    });
    assert.deepEqual(outcome, { verdict: 'giveUp', reason: 'window_end' });
  });

  it('cancels on SIGINT and falls through as giveUp', async () => {
    // Detach any pre-existing SIGINT listeners (e.g. the test runner's) so
    // emitting the event only reaches the wait loop's handler.
    const prior = process.listeners('SIGINT');
    prior.forEach(l => process.removeListener('SIGINT', l));
    try {
      const waiting = waitForLimitReset({
        resumeCount: 0,
        deps: { probe: async () => 'limited', log: () => {}, intervalMs: 5000 }
      });
      await new Promise(r => setTimeout(r, 10));
      process.emit('SIGINT');
      const outcome = await waiting;
      assert.deepEqual(outcome, { verdict: 'giveUp', reason: 'cancelled' });
      assert.equal(process.listeners('SIGINT').length, 0);
    } finally {
      prior.forEach(l => process.on('SIGINT', l));
    }
  });
});

describe('--no-auto-resume CLI flag', () => {
  it('is documented in CLI help output', async () => {
    const { execFile } = require('child_process');
    const indexPath = path.join(__dirname, '..', 'index.js');
    const stdout = await new Promise((resolve, reject) => {
      execFile('node', [indexPath, 'help'], (err, out) => err ? reject(err) : resolve(out));
    });
    assert.ok(stdout.includes('--no-auto-resume'));
    assert.ok(stdout.includes('usage-limit'));
  });
});

describe('runSessionWithAutoResume', () => {
  /** Session whose promise resolves when terminate() is called, or immediately. */
  function makeSession({ resolveOnTerminate = false } = {}) {
    let resolveExit;
    const promise = new Promise(r => { resolveExit = r; });
    const proc = { exit: () => resolveExit() };
    if (!resolveOnTerminate) resolveExit();
    return { promise, proc };
  }
  const noopWatch = () => ({ stop: () => {}, done: Promise.resolve() });

  it('intentional early exit: probes once, never waits, no resume', async () => {
    let spawns = 0;
    let saves = 0;
    let probeCalls = 0;
    let waitCalls = 0;
    const result = await runSessionWithAutoResume({
      spawnSession: () => { spawns++; return makeSession(); },
      saveSession: async () => { saves++; },
      transcriptFile: '/fake/t.jsonl',
      autoResume: true,
      deps: {
        probe: async () => { probeCalls++; return 'available'; },
        wait: async () => { waitCalls++; return { verdict: 'resume', reason: 'x' }; },
        watch: noopWatch,
        log: () => {}
      }
    });
    assert.equal(spawns, 1);
    assert.equal(saves, 1);
    assert.equal(probeCalls, 1);
    assert.equal(waitCalls, 0);
    assert.equal(result.autoResumeCount, 0);
    assert.ok(!result.timedOut);
  });

  it('limit flow: detect → wait → resume → final exit; post-session state correct', async () => {
    let spawns = 0;
    let saves = 0;
    let waitCalls = 0;
    const spawnArgs = [];
    const result = await runSessionWithAutoResume({
      spawnSession: ({ isResume }) => {
        spawns++;
        spawnArgs.push(isResume);
        // first session freezes (exits only when terminated), second ends normally
        return makeSession({ resolveOnTerminate: spawns === 1 });
      },
      saveSession: async () => { saves++; },
      transcriptFile: '/fake/t.jsonl',
      autoResume: true,
      deps: {
        // watcher confirms a limit on session 1 only
        watch: spawnsRefWatch(),
        terminate: (proc) => proc.exit(),
        probe: async () => 'available',
        wait: async () => { waitCalls++; return { verdict: 'resume', reason: 'limit_lifted' }; },
        log: () => {}
      }
    });

    function spawnsRefWatch() {
      let call = 0;
      return ({ onLimitDetected }) => {
        call++;
        if (call === 1) setImmediate(onLimitDetected);
        return { stop: () => {}, done: Promise.resolve() };
      };
    }

    assert.equal(spawns, 2);
    assert.equal(saves, 2, 'session saved after every exit');
    assert.equal(waitCalls, 1);
    assert.equal(result.autoResumeCount, 1);
    assert.deepEqual(spawnArgs, [false, true], 'second spawn resumes');
  });

  it('wait give-up concludes the run without respawn', async () => {
    let spawns = 0;
    const result = await runSessionWithAutoResume({
      spawnSession: () => { spawns++; return makeSession(); },
      saveSession: async () => {},
      transcriptFile: '/fake/t.jsonl',
      autoResume: true,
      deps: {
        probe: async () => 'limited',
        wait: async () => ({ verdict: 'giveUp', reason: 'max_wait' }),
        watch: noopWatch,
        log: () => {}
      }
    });
    assert.equal(spawns, 1);
    assert.equal(result.autoResumeCount, 0);
    assert.equal(result.giveUpReason, 'max_wait');
  });

  it('--no-auto-resume bypasses detection entirely', async () => {
    let probeCalls = 0;
    let watchCalls = 0;
    const result = await runSessionWithAutoResume({
      spawnSession: () => makeSession(),
      saveSession: async () => {},
      transcriptFile: '/fake/t.jsonl',
      autoResume: false,
      deps: {
        probe: async () => { probeCalls++; return 'limited'; },
        wait: async () => ({ verdict: 'resume', reason: 'x' }),
        watch: () => { watchCalls++; return noopWatch(); },
        log: () => {}
      }
    });
    assert.equal(probeCalls, 0);
    assert.equal(watchCalls, 0);
    assert.equal(result.autoResumeCount, 0);
  });

  it('window-end deadline terminates the session and skips probing', async () => {
    let probeCalls = 0;
    const result = await runSessionWithAutoResume({
      spawnSession: () => makeSession({ resolveOnTerminate: true }),
      saveSession: async () => {},
      transcriptFile: '/fake/t.jsonl',
      windowEndTimeMs: Date.now() + 20,
      autoResume: true,
      deps: {
        probe: async () => { probeCalls++; return 'limited'; },
        wait: async () => ({ verdict: 'resume', reason: 'x' }),
        watch: noopWatch,
        terminate: (proc) => proc.exit(),
        log: () => {}
      }
    });
    assert.ok(result.timedOut);
    assert.equal(probeCalls, 0);
    assert.equal(result.autoResumeCount, 0);
  });

  it('plain run (no windowEndTimeMs) never arms a termination timer', async () => {
    let terminateCalls = 0;
    const result = await runSessionWithAutoResume({
      spawnSession: () => ({
        promise: new Promise(r => setTimeout(r, 50)),
        proc: { exit: () => {} }
      }),
      saveSession: async () => {},
      transcriptFile: '/fake/t.jsonl',
      autoResume: true,
      deps: {
        probe: async () => 'available',
        wait: async () => ({ verdict: 'resume', reason: 'x' }),
        watch: noopWatch,
        terminate: () => { terminateCalls++; },
        log: () => {}
      }
    });
    assert.equal(terminateCalls, 0);
    assert.ok(!result.timedOut);
  });

  it('probes on every non-deadline exit, even after a long session', async () => {
    let probeCalls = 0;
    let t = 0;
    const result = await runSessionWithAutoResume({
      spawnSession: () => ({
        // session consumes 10 hours of clock — no time budget exists to exhaust
        promise: Promise.resolve().then(() => { t += 36000000; }),
        proc: { exit: () => {} }
      }),
      saveSession: async () => {},
      transcriptFile: '/fake/t.jsonl',
      autoResume: true,
      deps: {
        now: () => t,
        probe: async () => { probeCalls++; return 'available'; },
        wait: async () => ({ verdict: 'resume', reason: 'x' }),
        watch: noopWatch,
        log: () => {}
      }
    });
    assert.equal(probeCalls, 1, 'exit probed despite 10h elapsed');
    assert.equal(result.autoResumeCount, 0);
  });
});
