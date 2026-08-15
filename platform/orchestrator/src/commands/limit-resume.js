const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

/** No transcript writes for this long → suspect a frozen (limit-stopped) session. */
const STALL_THRESHOLD_MS = 10 * 60 * 1000;
/** How often the wait loop re-probes availability while limited. */
const PROBE_INTERVAL_MS = 15 * 60 * 1000;
/** Give up waiting after one full reset window plus slack (covers weekly-limit exhaustion). */
const MAX_WAIT_MS = 5.5 * 3600 * 1000;
/** Max auto-resumes per run. */
const MAX_AUTO_RESUMES = 2;
/** Don't resume when less than this much of the scheduled window remains. */
const MIN_REMAINING_MS = 15 * 60 * 1000;
/** How often the stall watcher stats the transcript file. */
const TRANSCRIPT_POLL_MS = 60 * 1000;
/** Probe subprocess hard timeout. */
const PROBE_TIMEOUT_MS = 60 * 1000;
/** SIGTERM → SIGKILL escalation grace. */
const KILL_GRACE_MS = 10 * 1000;

/** Cheapest model tier — the probe's answer is discarded, only its success matters. */
const PROBE_MODEL = 'haiku';

const LIMIT_PATTERN = /hit your (session|weekly)? ?limit|resets /i;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionId(id) {
  return typeof id === 'string' && UUID_PATTERN.test(id);
}

/**
 * Path of the live session transcript Claude Code writes for a session.
 * Only ever stat'd for mtime — the JSONL content is internal to Claude Code
 * and must not be parsed.
 */
function transcriptPath(projectDir, sessionId) {
  const sanitized = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', sanitized, `${sessionId}.jsonl`);
}

/**
 * Check whether the account can currently make Claude requests.
 *
 * Spawns a minimal headless probe (argument array, never a shell) and
 * classifies the outcome. The probe's stderr is inspected for the limit
 * pattern but never echoed — subprocess output can carry ANSI escapes.
 *
 * @returns {Promise<'available'|'limited'|'unknown'>}
 */
function probeAvailability({ spawnFn = spawn, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (verdict) => {
      if (!settled) {
        settled = true;
        resolve(verdict);
      }
    };

    let proc;
    try {
      proc = spawnFn('claude', ['-p', 'ok', '--model', PROBE_MODEL], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      return done('unknown');
    }

    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      if (stderr.length < 8192) stderr += chunk.toString();
    });
    proc.stdout?.resume(); // drain and discard

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      done('unknown');
    }, timeoutMs);

    proc.on('error', () => {
      clearTimeout(timer);
      done('unknown');
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) return done('available');
      done(LIMIT_PATTERN.test(stderr) ? 'limited' : 'unknown');
    });
  });
}

/** SIGTERM a process, escalating to SIGKILL after a grace period. */
function terminateWithGrace(proc, graceMs = KILL_GRACE_MS) {
  try { proc.kill('SIGTERM'); } catch { return; }
  const killer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
  }, graceMs);
  killer.unref?.();
  proc.once('exit', () => clearTimeout(killer));
}

/**
 * Watch a session transcript for a stall that indicates a frozen,
 * limit-stopped session. On a confirmed limit, calls onLimitDetected once
 * and stops. A stall with the account still available is benign idle —
 * the watcher backs off until new transcript activity precedes a fresh stall.
 *
 * Returns { stop, done }. done resolves when the watcher exits.
 */
function watchForStall({ transcriptFile, onLimitDetected, deps = {} }) {
  const {
    statFn = (p) => fs.stat(p),
    probe = probeAvailability,
    now = Date.now,
    log = console.log,
    pollMs = TRANSCRIPT_POLL_MS,
    stallThresholdMs = STALL_THRESHOLD_MS
  } = deps;

  let stopped = false;
  let cancelSleep = () => {};
  // Deliberately NOT unref'd: during a limit wait this timer can be the only
  // handle keeping the orchestrator process alive.
  const sleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    cancelSleep = () => { clearTimeout(t); resolve(); };
  });

  const done = (async () => {
    let lastMtime = null;
    let lastChangeAt = now();
    let armed = true;
    let missingChecks = 0;

    while (!stopped) {
      await sleep(pollMs);
      if (stopped) break;

      let st;
      try {
        st = await statFn(transcriptFile);
      } catch {
        missingChecks++;
        if (missingChecks >= 3) {
          log('  ~ [limit-watch] Session transcript not found — stall detection disabled for this run.');
          return;
        }
        continue;
      }
      missingChecks = 0;

      if (lastMtime === null || st.mtimeMs !== lastMtime) {
        lastMtime = st.mtimeMs;
        lastChangeAt = now();
        armed = true;
        continue;
      }

      if (armed && now() - lastChangeAt >= stallThresholdMs) {
        const verdict = await probe();
        if (stopped) break;
        if (verdict === 'limited') {
          onLimitDetected();
          return;
        }
        // Benign idle (or unknown — never treated as confirmation):
        // don't probe again until activity resumes and a fresh stall occurs.
        armed = false;
      }
    }
  })();

  return {
    stop() {
      stopped = true;
      cancelSleep();
    },
    done
  };
}

/**
 * Poll availability until the limit window resets or a bound is hit.
 * A single Ctrl+C during the wait cancels it (the run then concludes
 * through the normal post-session sequence).
 *
 * @returns {Promise<{verdict: 'resume'|'giveUp', reason: string}>}
 */
async function waitForLimitReset({ resumeCount = 0, windowEndTimeMs = null, deps = {} } = {}) {
  const {
    probe = probeAvailability,
    now = Date.now,
    log = console.log,
    intervalMs = PROBE_INTERVAL_MS,
    maxWaitMs = MAX_WAIT_MS,
    maxResumes = MAX_AUTO_RESUMES,
    minWindowRemainingMs = MIN_REMAINING_MS
  } = deps;

  if (resumeCount >= maxResumes) {
    return { verdict: 'giveUp', reason: 'resume_cap' };
  }

  const startedAt = now();
  let cancelled = false;
  let cancelSleep = () => {};
  // Deliberately NOT unref'd: while waiting out the limit window, this timer
  // is the only handle keeping the orchestrator process alive.
  const sleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    cancelSleep = () => { clearTimeout(t); resolve(); };
  });
  const onSigint = () => {
    cancelled = true;
    cancelSleep();
  };
  process.on('SIGINT', onSigint);

  try {
    while (true) {
      if (now() - startedAt >= maxWaitMs) {
        return { verdict: 'giveUp', reason: 'max_wait' };
      }
      const nextProbeAt = now() + intervalMs;
      if (windowEndTimeMs && nextProbeAt > windowEndTimeMs - minWindowRemainingMs) {
        return { verdict: 'giveUp', reason: 'window_end' };
      }

      const at = new Date(nextProbeAt);
      log(`  usage limit hit — next probe at ${at.toLocaleTimeString()} (Ctrl+C to stop)`);
      await sleep(intervalMs);
      if (cancelled) {
        return { verdict: 'giveUp', reason: 'cancelled' };
      }

      const verdict = await probe();
      if (cancelled) {
        return { verdict: 'giveUp', reason: 'cancelled' };
      }
      if (verdict === 'available') {
        return { verdict: 'resume', reason: 'limit_lifted' };
      }
      // 'limited' and 'unknown' both keep waiting.
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

/**
 * Run a Morgan CLI session with limit-aware auto-resume.
 *
 * Owns the spawn loop: window-end deadline enforcement (windowed runs only —
 * plain runs have no time bound), frozen-session stall detection, early-exit
 * probing, the bounded wait loop, and respawn via the caller's spawnSession.
 *
 * @param {object} opts
 * @param {function} opts.spawnSession - ({ isResume }) => { promise, proc }
 * @param {function} opts.saveSession - async, called after every exit
 * @param {string|null} opts.transcriptFile - transcript to watch (null disables stall detection)
 * @param {number|null} opts.windowEndTimeMs - absolute deadline (scheduled windows); null = unbounded
 * @param {boolean} opts.autoResume
 * @returns {Promise<{timedOut: boolean, autoResumeCount: number, giveUpReason: string|null}>}
 */
async function runSessionWithAutoResume({
  spawnSession,
  saveSession,
  transcriptFile = null,
  windowEndTimeMs = null,
  autoResume = true,
  deps = {}
}) {
  const {
    probe = probeAvailability,
    now = Date.now,
    log = console.log,
    terminate = terminateWithGrace,
    watch = watchForStall,
    wait = waitForLimitReset,
    maxResumes = MAX_AUTO_RESUMES
  } = deps;

  let timedOut = false;
  let autoResumeCount = 0;
  let giveUpReason = null;
  let isResume = false;

  while (true) {
    const deadlineMs = windowEndTimeMs ? Math.max(windowEndTimeMs - now(), 1) : null;
    const { promise, proc } = spawnSession({ isResume });

    const timer = deadlineMs ? setTimeout(() => {
      timedOut = true;
      log('');
      log('  === Window end reached — stopping Morgan ===');
      log('');
      terminate(proc);
    }, deadlineMs) : null;

    let limitDetected = false;
    const watcher = (autoResume && transcriptFile) ? watch({
      transcriptFile,
      deps,
      onLimitDetected: () => {
        limitDetected = true;
        log('');
        log('  === Usage limit detected — stopping Morgan to wait for the reset ===');
        terminate(proc);
      }
    }) : null;

    await promise;
    if (timer) clearTimeout(timer);
    watcher?.stop();
    await saveSession();

    if (!autoResume || timedOut) break;

    if (!limitDetected) {
      // Early exit with budget left: probe once. Only a confirmed limit
      // waits — 'available' means an intentional/normal end, and 'unknown'
      // fails safe to concluding the run.
      const verdict = await probe();
      if (verdict !== 'limited') break;
    }

    const outcome = await wait({ resumeCount: autoResumeCount, windowEndTimeMs, deps });
    if (outcome.verdict !== 'resume') {
      giveUpReason = outcome.reason;
      break;
    }

    autoResumeCount++;
    isResume = true;
    log('');
    log(`  === Usage limit lifted — resuming Morgan (auto-resume ${autoResumeCount}/${maxResumes}) ===`);
    log('');
  }

  return { timedOut, autoResumeCount, giveUpReason };
}

module.exports = {
  STALL_THRESHOLD_MS,
  PROBE_INTERVAL_MS,
  MAX_WAIT_MS,
  MAX_AUTO_RESUMES,
  MIN_REMAINING_MS,
  TRANSCRIPT_POLL_MS,
  PROBE_TIMEOUT_MS,
  KILL_GRACE_MS,
  PROBE_MODEL,
  LIMIT_PATTERN,
  isValidSessionId,
  transcriptPath,
  probeAvailability,
  terminateWithGrace,
  watchForStall,
  waitForLimitReset,
  runSessionWithAutoResume
};
