# Design: remove-run-time-limit

## Context

`./devshop run` currently arms a SIGTERM timer from `config.timeLimitMs` (default 7h via `--time-limit`) inside `runSessionWithAutoResume`, tracks active session time across auto-resumes, and refuses to resume with under 15 minutes of time budget left. A `$30` default budget (`--budget`) is threaded into the config, session header, and Morgan's prompt but is never enforced in code. Windowed runs (`--window`) override both from window config (`budgetUsd`, `timeLimitHours`) and separately compute `windowEndTimeMs`.

The operator wants runs to continue until the project is done or they stop them. The time-limit and run-budget concepts are being removed entirely; usage-limit auto-resume behavior and window boundaries stay.

## Goals / Non-Goals

**Goals:**
- A plain `./devshop run <project>` never self-terminates on elapsed time; it ends only when Morgan exits (and auto-resume declines to respawn) or the operator stops it.
- Remove the run budget everywhere it appears (flag semantics for run, config, header, prompt, defaults).
- Windowed runs still stop at their window end.

**Non-Goals:**
- No changes to usage-limit auto-resume bounds (2-resume cap, 5.5h max wait, stall detection, probe).
- No changes to the post-session repair time cap (15 min) or repair attempt cap.
- No changes to the security scan budget (`devshop security --budget` remains an enforced cap).
- No respawn-until-roadmap-done loop; Morgan ending the session normally still ends the run.

## Decisions

1. **Window end becomes the only session deadline, enforced directly from `windowEndTimeMs`.**
   `runSessionWithAutoResume` loses `timeLimitMs` and instead accepts the existing `windowEndTimeMs` as an absolute deadline: a timer armed with `windowEndTimeMs - now` terminates Morgan at window end. Interactive runs pass `null` → no timer at all.
   *Alternative considered:* keep `timeLimitMs` computed from `endHour` for windows only — rejected because it preserves the time-limit plumbing this change exists to delete; an absolute deadline is simpler and equivalent.

2. **`--budget` stays in `parseArgs` but is consumed only by `security`.**
   `security` uses `--budget` as an enforced `maxBudgetUsd` override. Removing the flag would break that command. Run stops reading it: `budgetLimitUsd` leaves the run config assembly, and help text documents `--budget` under the security command only.
   *Alternative considered:* rename to `--scan-budget` — rejected as an unnecessary breaking change to an unrelated command.

3. **Active-time accounting is deleted, not repurposed.**
   `activeElapsedMs` existed to arm the resumed session's timer with remaining time and to gate resumes (min-remaining guard). With no time budget, both consumers disappear. Early-exit probing now runs on every exit that wasn't a window-deadline termination. `MIN_REMAINING_MS` survives only as the window-end guard inside `waitForLimitReset` (don't resume into a nearly-closed window).

4. **Prompt loses its stopping pressure.**
   `BUDGET_USD` and `TIME_LIMIT_HOURS` template variables are removed from `run-prompt.md` along with the "if you're running low on time... stop gracefully" line. The autonomous-mode block's "until you run out of budget/time" becomes "until everything is complete or blocked". Commit/mark-roadmap hygiene instructions stay.

5. **Exit-code semantics follow the code, not the stale spec.**
   The cli-interface spec still says "1 if terminated by timeout"; the implementation returns 1 when parked items remain. The delta spec records the parked-items rule and drops the timeout clause.

## Risks / Trade-offs

- [A hung interactive run can sit forever] → The stall watcher still probes on transcript stalls; a benign-idle stall takes no action, so a genuinely wedged-but-writing session is the operator's to notice. Accepted: this is the requested behavior ("runs until I stop it").
- [Windowed runs previously had two stopping layers (timeLimitHours and endHour)] → Now only the endHour deadline. Window `timeLimitHours`/`budgetUsd` config keys become dead; scheduler config parsing must tolerate their presence in existing files (ignore, don't error).
- [`logger.js` renders `budgetLimitUsd` in session summaries] → It already null-guards (`?? '0.00'`); clean up the field rather than leaving a permanent `0.00`.

## Migration Plan

Single PR. Existing `active-agents/*/orchestrator/config.json` overrides containing `budgetLimitUsd`/`timeLimitMs` are silently ignored after the deep merge stops consuming them — no data migration needed. README, CLI help, and the six affected specs update in the same PR.
