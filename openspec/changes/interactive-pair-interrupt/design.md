## Context

The orchestrator's main phase loop in `parallel-orchestrator.js` already checks `monitor.shouldStop()` at 4 safe checkpoints:
1. **Line 414** — After roadmap parse, before phase selection
2. **Line 536** — After phase execution (where `blocking_park` is handled)
3. **Line 784** — Before each spike item
4. **Line 923** — Before each requirement item in a group

The `blocking_park` flow at checkpoint 2 (lines 536-553) is the closest existing pattern: it pauses, pushes work, spawns Morgan for a fix, then optionally restarts. But it fully exits and restarts the orchestrator process via `{ restart: true }`.

Pair mode (`pair.js`) spawns Claude CLI with `stdio: 'inherit'` and `--dangerously-skip-permissions`. It builds context via `buildPairContext()` which reads session state, roadmap progress, and parked items from disk.

Stdin is completely unused during `devshop run` — no readline, no raw mode, no process.stdin listeners. This makes it safe to add a keypress listener.

## Goals / Non-Goals

**Goals:**
- Press `p` during `devshop run` to pause and enter pair mode with Morgan
- Orchestrator finishes current microcycle gracefully before pausing (no mid-work interruption)
- Morgan gets context about the current session: active phase, recent completions, failures
- On pair exit, orchestrator resumes the phase loop from where it paused — no process restart
- Existing Ctrl+C behavior (graceful shutdown) is preserved

**Non-Goals:**
- Pausing mid-microcycle (too complex, risk of corrupted state)
- Running pair mode concurrently with agents (stdin contention, confusing UX)
- Persisting pair session for later resume (pair is ephemeral debugging)

## Decisions

### 1. Keypress detection via raw stdin

**Choice:** Put `process.stdin` into raw mode and listen for `p` keypress. On detection, set `monitor.requestPause({ reason: 'pause_for_pair' })`.

**Why raw mode:** `readline` would require Enter after the key. Raw mode gives instant detection. We restore stdin state before spawning pair mode (which uses `stdio: 'inherit'`) and after pair exits.

**Implementation:**
```javascript
// In parallel-orchestrator.js, during run() setup
_installKeypressListener() {
  if (!process.stdin.isTTY) return; // Skip in CI/piped mode
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', this._onKeypress);
}

_onKeypress = (data) => {
  const key = data.toString();
  if (key === 'p' || key === 'P') {
    this.monitor.requestPause({ reason: 'pause_for_pair' });
    console.log('\n  Pausing for pair mode — finishing current work...');
  }
}
```

Remove listener and restore stdin before spawning pair and on session end.

### 2. Handle `pause_for_pair` at checkpoint 2 (after phase execution)

**Choice:** Add a new branch alongside the existing `blocking_park` check at line 536. When `reason === 'pause_for_pair'`, spawn pair inline and resume.

**Why checkpoint 2:** It's the natural boundary between phases/items. Work is committed, state is clean. Checkpoints 3 and 4 (before items) would also work but checkpoint 2 gives the cleanest pause point.

**Alternative considered:** Add handling at all checkpoints. Rejected — increases complexity and testing surface. Checkpoint 2 is sufficient; the worst-case wait is one microcycle (~2-5 minutes).

**Flow:**
```
Phase loop iteration:
  1. Execute phase (agents run, items complete/park)
  2. Check monitor.shouldStop()
  3. If reason === 'pause_for_pair':
     a. Tear down stdin listener
     b. Save current state
     c. Spawn pair mode with session context
     d. On pair exit: reinstall stdin listener, reset pause flag
     e. Continue phase loop (no restart)
```

### 3. Resume without restart (in-process)

**Choice:** After pair mode exits, the orchestrator continues the `while` loop in `run()`. No `{ restart: true }`, no `_completeSession()`, no new `ParallelOrchestrator` instance.

**Why:** The orchestrator's in-memory state (roadmap, state machine, monitor, logger) is still valid. The pair session may have changed files on disk (git commits), but the orchestrator re-reads the roadmap from disk at the top of each loop iteration (line 404: `current = await this.roadmapReader.parse()`). So any changes Morgan makes will be picked up automatically.

**Key detail:** Reset the monitor's pause state after pair exits so `shouldStop()` returns `false` again. Add `monitor.clearPause()` method.

### 4. Context injection for pair session

**Choice:** Reuse `buildPairContext()` from `pair.js` and add current-phase context (which agents were active, what just completed/failed this phase).

The pair prompt template already accepts a `REQUIREMENTS` variable with project state. We'll build a richer version that includes:
- Current phase label and number
- Items completed/parked this phase
- Active agents at time of pause
- Last few log entries (from in-memory logger buffer)

### 5. Session header hint

**Choice:** Add `Press p to pair with Morgan` to the run session header in `run.js`. Only shown when stdin is a TTY.

## Risks / Trade-offs

- **Stdin raw mode conflicts** — If another process expects stdin (shouldn't happen during `run`). Mitigation: only enable on TTY, restore before pair spawn.
- **State drift during pair** — Morgan might modify files that the orchestrator has in-memory assumptions about. Mitigation: roadmap is re-read from disk each loop iteration; state machine is on disk. Git state may change but the orchestrator uses its own session branch.
- **Pair session changes not on session branch** — Morgan works on whatever branch is checked out (likely the session branch). If Morgan creates commits, they'll be on the session branch, which is correct.

## Open Questions

- Should we also support item-level checkpoint pausing (checkpoints 3/4) for faster response to `p`? Could add later without changing the architecture.
