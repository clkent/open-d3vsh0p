# Proposal: limit-aware-resume

## Why

When a Morgan session hits the account's 5-hour Claude usage limit, the `claude` process stops working and the run ends silently — `run.js` discards the exit outcome, and hours of remaining window time are wasted until the operator notices and manually reruns with `--resume`. Session persistence and `--resume` already restore full context, so the only missing piece is detecting the limit-caused stop and relaunching automatically once the limit window resets.

## What Changes

- `devshop run` gains a limit-aware resume loop around the Morgan spawn: when Morgan exits well before the configured time limit, the orchestrator probes API availability with a minimal `claude -p` call (cheap model) to distinguish a usage-limit stop from a normal early finish.
- While the limit is in effect, the orchestrator polls availability on an interval (order of 15–30 minutes) instead of exiting; when a probe succeeds, it respawns Morgan with the saved session ID (`--resume`), restoring full conversation context.
- Intentional exits are never auto-resumed: if the probe succeeds right after Morgan exits (account not limited — e.g. the operator quit the session), the run concludes normally. During the waiting state the orchestrator prints the next probe time and a single Ctrl+C aborts the wait entirely, covering the case where the operator cancels a session while the limit is in effect and does not want it to return.
- The loop respects existing guardrails: it never resumes past `timeLimitMs` (or the window end for scheduled runs), caps the number of auto-resumes per run, and reuses the existing run lock so no concurrent session can start.
- New `--no-auto-resume` flag on `run` disables the behavior (auto-resume is on by default); waiting state is surfaced in terminal output (e.g. "usage limit hit — next probe at HH:MM").
- Post-session steps (health gate, consolidation) run once, after the final Morgan exit — not between limit-caused interruptions.

## Capabilities

### New Capabilities
- `limit-aware-resume`: Detection of usage-limit-caused Morgan exits, availability probing, and the poll-and-resume loop that relaunches Morgan with restored context once the limit window resets.

### Modified Capabilities
- `cli-interface`: Add `--no-auto-resume` boolean flag to `run` option parsing and config assembly.
- `morgan-orchestrator`: Run Lifecycle Wrapper requirement changes — Morgan's exit is no longer unconditionally terminal; post-session steps (session save is per-exit, health gate/consolidation are per-run) are sequenced around the resume loop.

## Impact

- `platform/orchestrator/src/commands/run.js` — wrap the Morgan spawn/await in the resume loop; sequence health gate and consolidation after the loop concludes.
- `platform/orchestrator/src/commands/cli-spawn.js` — expose exit code/timing (currently discarded); add the availability probe helper.
- `platform/orchestrator/src/index.js` — parse `--no-auto-resume`, update `--help` text.
- Docs: `README.md` run usage; roadmap entry (new item under a Phase XVII group or a new phase depending on placement).
- No new dependencies; probe calls consume negligible budget. Scheduled windows benefit automatically once `scheduled-terminal-run` lands, since the loop honors `windowEndTimeMs`.
