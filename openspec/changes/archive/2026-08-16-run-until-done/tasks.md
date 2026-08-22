# Tasks: run-until-done

## 1. Stall Watcher

- [x] 1.1 `watchForStall` gains `onIdleAvailable` (async, returns true when the caller is handling the idle by terminating): on an `available` verdict call it, stop watching when it returns true, otherwise keep re-probing; `limited` and `unknown` behavior unchanged

## 2. Session Loop

- [x] 2.1 `runSessionWithAutoResume` accepts `hasPendingWork`, `getProgressSignature`, and `maxFutileNudges` (default 3); wire `onIdleAvailable` to nudge only when auto-resume is on, work remains, and the window end hasn't passed
- [x] 2.2 On a nudge-terminated exit, respawn with `isResume: true` and `reason: 'nudge'`; track consecutive futile nudges via the progress signature and conclude the run at the cap
- [x] 2.3 Return `nudgeCount` (and `giveUpReason: 'futile_nudges'` where applicable)

## 3. Run Command

- [x] 3.1 Pass `hasPendingWork` (roadmap has a pending item not blocked by an incomplete `[HUMAN]` prerequisite) and `getProgressSignature` (completed count + git HEAD)
- [x] 3.2 Add a nudge continuation prompt distinct from the limit-resume prompt (names the stall, says a checkpoint is not a stopping point)
- [x] 3.3 Report `Continues: N` in the session summary

## 4. Tests and Docs

- [x] 4.1 Watcher tests: idle-available invokes the callback, stops when handled, keeps re-probing when not
- [x] 4.2 Session-loop tests: nudge respawn with resume, no nudge without pending work, no nudge on `unknown`, futile cap concludes, progress resets the counter, `--no-auto-resume` disables
- [x] 4.3 Full test suite passes
- [x] 4.4 README: document that runs self-continue through checkpoint stops; roadmap entry
