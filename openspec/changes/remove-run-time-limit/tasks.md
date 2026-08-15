# Tasks: remove-run-time-limit

## 1. Session Loop (limit-resume.js)

- [ ] 1.1 Remove `timeLimitMs` from `runSessionWithAutoResume`: drop the param, the per-spawn `remainingMs` timer arithmetic, `activeElapsedMs` accounting, and the min-remaining resume guard; return value loses `activeElapsedMs`
- [ ] 1.2 Arm the termination timer from `windowEndTimeMs` (absolute deadline) when set; no timer when null; keep the `timedOut` flag meaning "window deadline fired"
- [ ] 1.3 Early-exit probe now runs on every non-deadline exit (no time-budget condition); keep `MIN_REMAINING_MS` only as the window-end guard in `waitForLimitReset`
- [ ] 1.4 Update `limit-resume.test.js`: remove time-budget tests, add window-deadline timer tests and probe-on-every-exit tests

## 2. CLI and Config (index.js, config.js, defaults.json)

- [ ] 2.1 Remove `--time-limit` from `parseArgs`, `timeLimitMs` from the run config assembly, and `budgetLimitUsd` from the run config; keep `--budget` parsing for the `security` command only
- [ ] 2.2 Update `--help` text: delete `--time-limit`, document `--budget` under the security command, fix examples (`./devshop run my-app --budget 10 --time-limit 4` → plain run)
- [ ] 2.3 Remove `budgetLimitUsd` and `timeLimitMs` from `config/defaults.json` and the special-case CLI override block in `infra/config.js`; tolerate legacy keys in project override files
- [ ] 2.4 Remove the `budgetLimitUsd` line from `infra/logger.js` session summary rendering
- [ ] 2.5 Update config and index tests for removed flags/fields

## 3. Run Command (run.js)

- [ ] 3.1 Remove window `budgetUsd`/`timeLimitHours` override application; keep `computeWindowEndTimeMs` and pass `windowEndTimeMs` through to the session loop
- [ ] 3.2 Remove Budget and Time-limit lines from the session header; remove `budgetUsd`/`timeLimitHours` locals
- [ ] 3.3 Remove `BUDGET_USD`/`TIME_LIMIT_HOURS` template vars; reword autonomous-mode text ("until you run out of budget/time" → "until everything is complete or blocked")
- [ ] 3.4 Update "Stop reason: time_limit" reporting to reflect window-end-only termination (plain runs never report it)
- [ ] 3.5 Update `run.test.js` for header, template vars, and window handling

## 4. Scheduler and Templates

- [ ] 4.1 Remove `budgetUsd`/`timeLimitHours` from `scheduler/window-config.js` resolution (ignore legacy keys without error) and update its tests
- [ ] 4.2 Update `templates/agents/principal-engineer/run-prompt.md`: remove Budget and Time-limit constraint lines and the "running low on time... stop gracefully" guidance; keep commit/roadmap hygiene

## 5. Docs and Spec Sync

- [ ] 5.1 Update `README.md`: remove `--time-limit`/run-budget references, defaults, and examples
- [ ] 5.2 Verify no stray references remain: `grep -rn "time.limit\|timeLimit\|TIME_LIMIT\|budgetLimitUsd\|BUDGET_USD" platform/ templates/ README.md` (security scan budget and repair time cap are expected survivors)
- [ ] 5.3 Full test suite passes
