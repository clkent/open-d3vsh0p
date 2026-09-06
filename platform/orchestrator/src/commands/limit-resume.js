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

/** While a stall persists after a non-limited probe, re-probe this often. */
const REPROBE_INTERVAL_MS = 15 * 60 * 1000;
/** Consecutive idle continuations with no progress before concluding the run. */
const MAX_FUTILE_NUDGES = 3;

// Matches known limit wordings across CLI versions and both output streams.
// Over-matching (e.g. a transient rate-limit error) is benign: the wait loop
// re-probes every 15 minutes and resumes on the first `available`.
const LIMIT_PATTERN = /(hit|reached) your .{0,30}limit|usage limit|limit reached|resets /i;

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
 * Build an mtime source over the project's whole transcript directory: the
 * max mtime across `*.jsonl` files, or null when none can be read. Tracking
 * the newest transcript (not one fixed session file) keeps stall detection
 * alive after `--resume`, which forks the conversation into a NEW session
 * file — the old one never advances again. Only mtimes are read, never
 * transcript contents.
 *
 * @param {string} projectDir
 * @returns {() => Promise<number|null>}
 */
function latestTranscriptMtime(projectDir) {
  const sanitized = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-');
  const dir = path.join(os.homedir(), '.claude', 'projects', sanitized);
  return async () => {
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      return null;
    }
    let max = null;
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const st = await fs.stat(path.join(dir, f));
        if (max === null || st.mtimeMs > max) max = st.mtimeMs;
      } catch { /* file vanished between readdir and stat */ }
    }
    return max;
  };
}

/**
 * Check whether Morgan's model can currently take Claude requests.
 *
 * Spawns a minimal headless probe (argument array, never a shell) with the
 * same model Morgan is configured to use — limits can be model-specific, so
 * probing a different (cheaper) model can report `available` while Morgan is
 * actually capped. Both stdout and stderr are inspected for the limit
 * pattern (headless output routing varies across CLI versions) but never
 * echoed — subprocess output can carry ANSI escapes.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.model] - Morgan's configured model; omitted → account default
 * @returns {Promise<'available'|'limited'|'unknown'>}
 */
function probeAvailability({ spawnFn = spawn, timeoutMs = PROBE_TIMEOUT_MS, model = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (verdict) => {
      if (!settled) {
        settled = true;
        resolve(verdict);
      }
    };

    const args = ['-p', 'ok'];
    if (model) args.push('--model', model);

    let proc;
    try {
      proc = spawnFn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      return done('unknown');
    }

    let output = '';
    const collect = (chunk) => {
      if (output.length < 16384) output += chunk.toString();
    };
    proc.stderr?.on('data', collect);
    proc.stdout?.on('data', collect);

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
      done(LIMIT_PATTERN.test(output) ? 'limited' : 'unknown');
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
 * Watch the session transcripts for a stall — either a frozen limit-stopped
 * session, or an idle one that ended its turn and is waiting for input
 * (an interactive `claude` never exits at end of turn).
 *
 * On a confirmed limit, calls onLimitDetected once and stops. On a stall
 * with the model still AVAILABLE, calls onIdleAvailable: the run loop
 * decides whether unfinished roadmap work justifies nudging Morgan onward;
 * it returns true when it is handling the idle (terminating the process),
 * which stops the watcher. Otherwise the watcher keeps re-probing on an
 * interval, so a misclassified probe (wording drift, transient network
 * error, wrong stream) delays detection instead of killing it. Fresh
 * transcript activity resets the cycle.
 *
 * @param {object} opts
 * @param {() => Promise<number|null>} opts.getMtime - newest transcript mtime, null when unreadable
 * @param {() => Promise<boolean>} [opts.onIdleAvailable] - returns true when handling the idle
 * Returns { stop, done }. done resolves when the watcher exits.
 */
function watchForStall({ getMtime, onLimitDetected, onIdleAvailable = null, deps = {} }) {
  const {
    probe = probeAvailability,
    now = Date.now,
    log = console.log,
    pollMs = TRANSCRIPT_POLL_MS,
    stallThresholdMs = STALL_THRESHOLD_MS,
    reprobeIntervalMs = REPROBE_INTERVAL_MS
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
    let lastProbeAt = null;
    let missingChecks = 0;

    while (!stopped) {
      await sleep(pollMs);
      if (stopped) break;

      const mtime = await getMtime();
      if (mtime === null) {
        missingChecks++;
        if (missingChecks >= 3) {
          log('  ~ [limit-watch] Session transcript not found — stall detection disabled for this run.');
          return;
        }
        continue;
      }
      missingChecks = 0;

      if (lastMtime === null || mtime !== lastMtime) {
        lastMtime = mtime;
        lastChangeAt = now();
        lastProbeAt = null;
        continue;
      }

      const stalled = now() - lastChangeAt >= stallThresholdMs;
      const probeDue = lastProbeAt === null || now() - lastProbeAt >= reprobeIntervalMs;
      if (stalled && probeDue) {
        lastProbeAt = now();
        const verdict = await probe();
        if (stopped) break;
        if (verdict === 'limited') {
          onLimitDetected();
          return;
        }
        if (verdict === 'available' && onIdleAvailable) {
          // Idle, not limited: Morgan ended his turn (e.g. Claude Code's
          // "usage limit approaching — checkpoint now" injection) and the
          // process is waiting for input that will never come.
          const handled = await onIdleAvailable();
          if (stopped) break;
          if (handled) return;
        }
        // Not handled: keep watching; re-probe after reprobeIntervalMs for
        // as long as the stall persists.
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
 * @param {function} opts.spawnSession - ({ isResume, reason }) => { promise, proc }
 * @param {function} opts.saveSession - async, called after every exit
 * @param {(() => Promise<number|null>)|null} opts.getTranscriptMtime - newest transcript mtime source (null disables stall detection)
 * @param {string|null} opts.model - Morgan's configured model; the probe mirrors it
 * @param {(() => Promise<string[]>)|null} opts.getUnblockedPendingIds - IDs of pending roadmap items not blocked by a [HUMAN] prerequisite (null disables nudging)
 * @param {number|null} opts.windowEndTimeMs - absolute deadline (scheduled windows); null = unbounded
 * @param {boolean} opts.autoResume
 * @returns {Promise<{timedOut: boolean, autoResumeCount: number, nudgeCount: number, giveUpReason: string|null}>}
 */
/** Read the unblocked pending IDs; null when the roadmap can't be read. */
async function readPendingIds(getUnblockedPendingIds) {
  try {
    const ids = await getUnblockedPendingIds();
    return Array.isArray(ids) ? ids : null;
  } catch {
    return null;
  }
}

async function runSessionWithAutoResume({
  spawnSession,
  saveSession,
  getTranscriptMtime = null,
  model = null,
  getUnblockedPendingIds = null,
  windowEndTimeMs = null,
  autoResume = true,
  deps = {}
}) {
  // Every probe (stall watcher, early-exit check, wait loop) asks the same
  // question — "can Morgan continue?" — so all of them use Morgan's model.
  deps = { probe: () => probeAvailability({ model }), ...deps };
  const {
    probe,
    now = Date.now,
    log = console.log,
    terminate = terminateWithGrace,
    watch = watchForStall,
    wait = waitForLimitReset,
    maxResumes = MAX_AUTO_RESUMES,
    maxFutileNudges = MAX_FUTILE_NUDGES
  } = deps;

  let timedOut = false;
  let autoResumeCount = 0;
  let nudgeCount = 0;
  let futileNudges = 0;
  // The unblocked pending IDs that justified the last continuation (or the
  // set at run start). A continuation only counts as progress if it resolves
  // one of these — commits on the side don't keep the loop alive.
  let nudgeTargets = getUnblockedPendingIds ? await readPendingIds(getUnblockedPendingIds) : null;
  let giveUpReason = null;
  let isResume = false;
  let spawnReason = 'start';

  while (true) {
    const deadlineMs = windowEndTimeMs ? Math.max(windowEndTimeMs - now(), 1) : null;
    const { promise, proc } = spawnSession({ isResume, reason: spawnReason });

    const timer = deadlineMs ? setTimeout(() => {
      timedOut = true;
      log('');
      log('  === Window end reached — stopping Morgan ===');
      log('');
      terminate(proc);
    }, deadlineMs) : null;

    let limitDetected = false;
    let nudgeRequested = false;
    let pendingAtIdle = null;
    const watcher = (autoResume && getTranscriptMtime) ? watch({
      getMtime: getTranscriptMtime,
      deps,
      onLimitDetected: () => {
        limitDetected = true;
        log('');
        log('  === Usage limit detected — stopping Morgan to wait for the reset ===');
        terminate(proc);
      },
      // Morgan ended his turn but the process waits for input forever.
      // Continue him while unblocked roadmap work remains.
      onIdleAvailable: async () => {
        if (!getUnblockedPendingIds) return false;
        if (windowEndTimeMs && now() >= windowEndTimeMs) return false;
        if (futileNudges >= maxFutileNudges) return false;
        const pending = await readPendingIds(getUnblockedPendingIds);
        if (!pending || pending.length === 0) return false; // nothing to do, or can't tell → leave the run alone
        pendingAtIdle = pending;
        nudgeRequested = true;
        log('');
        log('  === Morgan went idle with work remaining — continuing the run ===');
        terminate(proc);
        return true;
      }
    }) : null;

    await promise;
    if (timer) clearTimeout(timer);
    watcher?.stop();
    await saveSession();

    if (!autoResume || timedOut) break;

    if (nudgeRequested) {
      // Track whether continuations are actually producing work; a wedged
      // Morgan must not be respawned forever. Progress = one of the items
      // that justified the previous continuation is no longer pending.
      if (nudgeTargets) {
        const resolved = nudgeTargets.some(id => !pendingAtIdle.includes(id));
        futileNudges = resolved ? 0 : futileNudges + 1;
      }
      nudgeTargets = pendingAtIdle;
      if (futileNudges >= maxFutileNudges) {
        giveUpReason = 'futile_nudges';
        log('');
        log(`  === ${futileNudges} continuations produced no progress — concluding the run ===`);
        log('');
        break;
      }
      nudgeCount++;
      isResume = true;
      spawnReason = 'nudge';
      log('');
      log(`  === Continuing Morgan (continuation ${nudgeCount}) ===`);
      log('');
      continue;
    }

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
    spawnReason = 'limit_resume';
    log('');
    log(`  === Usage limit lifted — resuming Morgan (auto-resume ${autoResumeCount}/${maxResumes}) ===`);
    log('');
  }

  return { timedOut, autoResumeCount, nudgeCount, giveUpReason };
}

module.exports = {
  STALL_THRESHOLD_MS,
  PROBE_INTERVAL_MS,
  REPROBE_INTERVAL_MS,
  MAX_FUTILE_NUDGES,
  MAX_WAIT_MS,
  MAX_AUTO_RESUMES,
  MIN_REMAINING_MS,
  TRANSCRIPT_POLL_MS,
  PROBE_TIMEOUT_MS,
  KILL_GRACE_MS,
  LIMIT_PATTERN,
  isValidSessionId,
  transcriptPath,
  latestTranscriptMtime,
  probeAvailability,
  terminateWithGrace,
  watchForStall,
  waitForLimitReset,
  runSessionWithAutoResume
};
