# Proposal: morgan-continue-until-blocked

## Why

Morgan pauses mid-run at phase boundaries: he reaches a Group Z user-testing checkpoint, prints "Checkpoint reached" with a summary of remaining work, and ends his turn. Nothing re-prompts an interactive CLI session, so the run sits idle indefinitely — even though unblocked roadmap work remains. The prompts invite this: the interactive initial prompt says "I can interact with you as you work," and the stop rules never state that a checkpoint or phase boundary is not a stopping point.

## What Changes

- Reframe the shared "When to Stop" execution rules from a list of stop conditions to a continue-by-default rule: keep working while any remaining item can be completed as valuable work; stop only when continuing would produce work that isn't valuable (everything complete or parked, or every remaining item is blocked by an incomplete `[HUMAN]` prerequisite or depends on parked work).
- State explicitly that phase boundaries and Group Z user-testing checkpoints are not stopping points — note the checkpoint for the developer and continue into the next phase.
- Forbid ending a turn with a status summary while unblocked pending items remain.
- Align Morgan's run prompt ("Session Hygiene") and the interactive initial prompt in `run.js` with the same rule: interaction is available, but Morgan must not pause to wait for input.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `morgan-orchestrator`: add a Continuous Execution requirement covering Morgan's stop discipline (continue-by-default, checkpoint non-stopping, blocked-only stops) across the shared execution rules, the run prompt, and the interactive initial prompt.

## Impact

- `templates/agents/_shared/roadmap-execution-rules.md` — "When to Stop" section
- `templates/agents/principal-engineer/run-prompt.md` — "Session Hygiene" section
- `platform/orchestrator/src/commands/run.js` — interactive initial prompt string
- Prompt-only change plus one string in `run.js`; no orchestrator logic changes. Builds on `remove-run-time-limit` (PR #44) and is branched from it.
