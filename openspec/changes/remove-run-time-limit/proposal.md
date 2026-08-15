# Proposal: remove-run-time-limit

## Why

`./devshop run` sessions are killed by a default 7-hour time limit (SIGTERM timer), which stopped an overnight run that still had roadmap work pending. The time limit and the advisory session budget add stopping pressure without providing real protection — the budget is never enforced in code, and the operator can always stop a run with Ctrl+C. Runs should continue until the project is done or the operator stops them.

## What Changes

- **BREAKING** Remove the `--time-limit` CLI flag, its 7-hour default, and `config.timeLimitMs` for the `run` command.
- **BREAKING** Remove the session budget concept from `run`: the `--budget` flag no longer applies to run sessions, and `budgetLimitUsd` leaves the run config, session header, and defaults. (`--budget` remains for `devshop security`, where it is an enforced scan cap.)
- Remove the time-limit SIGTERM timer and the active-session-time accounting (`timeLimitMs`, min-remaining guard) from `runSessionWithAutoResume`.
- Remove `budgetUsd` and `timeLimitHours` window overrides from daily scheduling. Windowed runs keep their end-of-window boundary, now enforced directly from `windowEndTimeMs` (both as the wait-loop give-up check and as the session termination deadline).
- Remove `BUDGET_USD` and `TIME_LIMIT_HOURS` template variables and the "stop gracefully when running low on time" guidance from Morgan's run prompt; reword autonomous-mode text that references running out of budget/time.
- Remove `budgetLimitUsd` and `timeLimitMs` from `defaults.json` and the config merge rules.

**Explicitly unchanged:** usage-limit auto-resume behavior (2-resume cap, 5.5-hour max wait, stall detection), the post-session repair time cap, the security scan budget, and Morgan's own decision to end a session.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-interface`: `--time-limit` removed; `--budget` no longer part of run config; run config object and session header lose budget/time fields.
- `configuration-system`: `defaults.json` and merge rules lose `budgetLimitUsd` and `timeLimitMs`.
- `morgan-orchestrator`: time-limit termination requirement removed; prompt template variables lose `BUDGET_USD`/`TIME_LIMIT_HOURS`.
- `daily-scheduling`: window config loses `budgetUsd`/`timeLimitHours`; window end boundary enforced from `windowEndTimeMs`.
- `limit-aware-resume`: session time budget accounting removed; resume decisions no longer consider remaining session time (window-end guard remains).
- `rest-api`: session start endpoint no longer takes budget/time limits.

## Impact

- `platform/orchestrator/src/index.js` — CLI parsing, help text, config assembly
- `platform/orchestrator/src/commands/run.js` — window overrides, session header, template vars, spawn call
- `platform/orchestrator/src/commands/limit-resume.js` — `runSessionWithAutoResume` signature and loop
- `platform/orchestrator/src/infra/config.js` + `defaults.json` — defaults and merge
- `platform/orchestrator/src/scheduler/window-config.js` — window override fields
- `templates/agents/principal-engineer/run-prompt.md` — budget/time lines
- `README.md` — usage examples and defaults
- Tests across `run.test.js`, `limit-resume.test.js`, config tests
