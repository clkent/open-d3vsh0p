# Tasks: interactive-pair-interrupt

## 1. Monitor support

- [x] Add `clearPause()` method to `consumption-monitor.js` — resets `_pauseRequested` and `_pauseReason` without affecting budget/time checks
- [x] Add test: `clearPause()` resets pause state, `shouldStop()` returns false after clear
- [x] Add test: `clearPause()` does not clear budget/time exhaustion — those still trigger stop

## 2. Keypress listener

- [x] Add `_installKeypressListener()` to `parallel-orchestrator.js` — sets stdin to raw mode, listens for `p`/`P`, calls `monitor.requestPause({ reason: 'pause_for_pair' })`
- [x] Add `_removeKeypressListener()` — restores stdin state (exit raw mode, pause stdin, remove listener)
- [x] Guard with `process.stdin.isTTY` check — skip in non-TTY environments
- [x] Call `_installKeypressListener()` at start of `run()` method, `_removeKeypressListener()` in `_completeSession()`

## 3. Pause-for-pair handling in phase loop

- [x] Add `pause_for_pair` branch after phase execution (alongside existing `blocking_park` check at ~line 536): tear down listener → spawn pair → reinstall listener → clear pause → continue loop
- [x] Build pair context from current orchestrator state: phase label, completed items, parked items, active agents
- [x] Import and use `buildPairContext` and `spawnClaudeTerminal` from `pair.js`
- [x] After pair exits: call `monitor.clearPause()`, re-read roadmap (already happens at loop top)

## 4. Also handle at item-level checkpoint

- [x] Add `pause_for_pair` check at item-level checkpoint (~line 923) — same flow: pause, pair, resume. This gives faster response to keypress without waiting for full phase to complete

## 5. Session header hint

- [x] In `run.js` session header: add "Press p to pair with Morgan" line, guarded by `process.stdin.isTTY`

## 6. Tests

- [x] Test: `_installKeypressListener` skips on non-TTY stdin
- [x] Test: keypress `p` triggers `monitor.requestPause` with reason `pause_for_pair`
- [x] Test: `_removeKeypressListener` clears handler reference
- [x] Test: non-TTY environment does not install listener

## 7. Verify

- [x] Run full test suite — 1243 tests pass, no regressions
- [ ] Manual test: run orchestrator, press `p`, confirm pair session opens, exit pair, confirm orchestrator resumes
