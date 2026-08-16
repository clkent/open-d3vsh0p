# Design: morgan-continue-until-blocked

## Context

Morgan is an interactive Claude Code CLI session. When the model ends its turn, the session waits for keyboard input forever; the orchestrator's stall watcher deliberately ignores benign idle (it only intervenes on usage limits). After `remove-run-time-limit`, the orchestrator is willing to run indefinitely — but Morgan still ends his turn at natural milestones, particularly Group Z user-testing checkpoints that end every roadmap phase. The result: overnight runs stall with unblocked work remaining.

## Goals / Non-Goals

**Goals:**
- Morgan continues through phase boundaries and Group Z checkpoints without pausing.
- Stopping becomes a reasoned decision: stop only when no remaining item can be completed as valuable work.
- Interactive runs stay interactive (the user can interject) without Morgan waiting on input.

**Non-Goals:**
- No orchestrator respawn-until-done loop (deferred; revisit if prompt hardening proves insufficient).
- No change to `[HUMAN]`-blocking semantics: incomplete non-Group-Z `[HUMAN]` prerequisites still block dependent phases.
- No change to parking rules or the autonomous-mode wrapper.

## Decisions

1. **Define "blocked" in terms of work value, not item status.** The stop rule is: end the session only when every remaining pending item either (a) requires an incomplete `[HUMAN]` prerequisite, or (b) depends on parked work — i.e., continuing would produce work that can't be validated or would likely be redone. This gives Morgan a test to apply rather than a list to pattern-match, which is what "non-blocking" as a buried exception failed to do.
   *Alternative:* enumerate stop conditions exhaustively — rejected; the current bug exists because Morgan improvised outside an enumerated list.

2. **Make the checkpoint rule explicit and its action concrete.** "Reaching a Group Z checkpoint is not a reason to stop — note it and continue into the next phase" plus "never end your turn with a status summary while unblocked pending items remain." The second clause targets the exact observed failure (summary-then-yield).

3. **Fix the invitation in the interactive initial prompt.** "I can interact with you as you work" becomes an explicit non-waiting contract: the user may interject, but Morgan must not pause or wait for input. Same rule added to the run prompt's Session Hygiene so it survives context compaction (the initial prompt is the first thing summarized away in long sessions; the system prompt persists).

4. **Spec as an ADDED requirement, not MODIFIED.** The pending `remove-run-time-limit` change (PR #44) already carries MODIFIED blocks for the adjacent morgan-orchestrator requirements. Adding a new "Continuous Execution" requirement avoids two unarchived changes carrying conflicting MODIFIED copies of the same requirement.

## Risks / Trade-offs

- [Prompt guidance can still be ignored in very long sessions] → Session Hygiene lives in the system prompt (persists across compaction). If stalls recur, escalate to the orchestrator respawn-until-done loop.
- [Morgan might now plow past a checkpoint a user genuinely wanted to gate on] → Group Z checkpoints were already spec'd as non-blocking for the orchestrator; users who want a hard gate use non-Group-Z `[HUMAN]` items, which still block.
