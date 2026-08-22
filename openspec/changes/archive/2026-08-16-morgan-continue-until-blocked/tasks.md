# Tasks: morgan-continue-until-blocked

## 1. Prompt Templates

- [x] 1.1 Rewrite "When to Stop" in `templates/agents/_shared/roadmap-execution-rules.md` as continue-by-default: stop only when all items are complete/parked or every remaining item is blocked ([HUMAN] prerequisite or parked dependency); checkpoints/phase boundaries are not stopping points; never end a turn with a status summary while unblocked work remains
- [x] 1.2 Strengthen "Session Hygiene" in `templates/agents/principal-engineer/run-prompt.md` with the same continue-until-blocked rule and the checkpoint non-stopping rule

## 2. Run Command

- [x] 2.1 Update the interactive initial prompt in `run.js`: user may interject, but do not pause or wait for input; work continuously until done or blocked (continuation prompt updated too, so resumed sessions don't re-stall)

## 3. Verification and Docs

- [x] 3.1 Full test suite passes (573/573)
- [x] 3.2 Add roadmap entry (Phase XIX Group A, after `remove-run-time-limit`)
