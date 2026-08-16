# Morgan Orchestrator — Delta

## ADDED Requirements

### Requirement: Run Continues Through Voluntary Stops
The `run` command SHALL treat Morgan going idle as a recoverable condition rather than the end of the run. When Morgan ends a turn without exiting (for example after Claude Code's "usage limit approaching — checkpoint now" injection, or any other voluntary wrap-up) and unblocked roadmap work remains, the wrapper SHALL continue Morgan per the `limit-aware-resume` capability's idle-with-work continuation, keeping the run lock held and the session branch unchanged.

The post-session health gate and consolidation SHALL run exactly once, after the final Morgan exit of the run, regardless of how many continuations occurred.

#### Scenario: Checkpoint stop is continued, not terminal
- **WHEN** Morgan wraps up mid-run at a checkpoint and goes idle while unblocked pending items remain
- **THEN** the run SHALL continue Morgan with `--resume` and defer the health gate and consolidation until the final exit

#### Scenario: Continuations reported to the operator
- **WHEN** a run included one or more idle continuations
- **THEN** the session summary SHALL report how many continuations occurred
