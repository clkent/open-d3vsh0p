# Tasks: remove-run-time-limit

## 1. Session Loop (limit-resume.js)

- [x] 1.1 Remove `timeLimitMs` from `runSessionWithAutoResume`: drop the param, the per-spawn `remainingMs` timer arithmetic, `activeElapsedMs` accounting, and the min-remaining resume guard; return value loses `activeElapsedMs`
- [x] 1.2 Arm the termination timer from `windowEndTimeMs` (absolute deadline) when set; no timer when null; keep the `timedOut` flag meaning "window deadline fired"
- [x] 1.3 Early-exit probe now runs on every non-deadline exit (no time-budget condition); keep `MIN_REMAINING_MS` only as the window-end guard in `waitForLimitReset`
- [x] 1.4 Update `limit-resume.test.js`: remove time-budget tests, add window-deadline timer tests and probe-on-every-exit tests

## 2. CLI and Config (index.js, config.js, defaults.json)

- [x] 2.1 Remove `--time-limit` from `parseArgs`, `timeLimitMs` from the run config assembly, and `budgetLimitUsd` from the run config; keep `--budget` parsing for the `security` command only
- [x] 2.2 Update `--help` text: delete `--time-limit`, document `--budget` under the security command, fix examples (`./devshop run my-app --budget 10 --time-limit 4` → plain run)
- [x] 2.3 Remove `budgetLimitUsd` and `timeLimitMs` from `config/defaults.json` and the special-case CLI override block in `infra/config.js`; tolerate legacy keys in project override files
- [x] 2.4 Remove the `budgetLimitUsd` line from `infra/logger.js` session summary rendering
- [x] 2.5 Update config and index tests for removed flags/fields

## 3. Run Command (run.js)

- [x] 3.1 Remove window `budgetUsd`/`timeLimitHours` override application; keep `computeWindowEndTimeMs` and pass `windowEndTimeMs` through to the session loop
- [x] 3.2 Remove Budget and Time-limit lines from the session header; remove `budgetUsd`/`timeLimitHours` locals
- [x] 3.3 Remove `BUDGET_USD`/`TIME_LIMIT_HOURS` template vars; reword autonomous-mode text ("until you run out of budget/time" → "until everything is complete or blocked")
- [x] 3.4 Update "Stop reason: time_limit" reporting to reflect window-end-only termination (plain runs never report it)
- [x] 3.5 Update `run.test.js` for header, template vars, and window handling (no changes needed — it never asserted on the removed fields; 30/30 pass)

## 4. Scheduler and Templates

- [x] 4.1 Remove `budgetUsd`/`timeLimitHours` from `scheduler/window-config.js` resolution (ignore legacy keys without error) and update its tests
- [x] 4.2 Update `templates/agents/principal-engineer/run-prompt.md`: remove Budget and Time-limit constraint lines and the "running low on time... stop gracefully" guidance; keep commit/roadmap hygiene

## 5. Docs and Spec Sync

- [x] 5.1 Update `README.md`: remove `--time-limit`/run-budget references, defaults, and examples
- [x] 5.2 Verify no stray references remain: `grep -rn "time.limit\|timeLimit\|TIME_LIMIT\|budgetLimitUsd\|BUDGET_USD" platform/ templates/ README.md` (security scan budget and repair time cap are expected survivors) — also caught and fixed strays beyond the task list: REST API passed `--time-limit`/`--budget` to the run CLI (would crash on the removed flag), and `_shared/roadmap-execution-rules.md` told agents to stop on budget/time
- [x] 5.3 Full test suite passes (orchestrator 573/573, pm 6/6)
