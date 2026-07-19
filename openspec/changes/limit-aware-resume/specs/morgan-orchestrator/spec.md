# Morgan Orchestrator — Delta

## MODIFIED Requirements

### Requirement: Run Lifecycle Wrapper
The `run.js` command handler SHALL manage the session lifecycle around Morgan's CLI session: lock acquisition, session branch creation, Morgan spawn wrapped in the limit-aware resume loop, and post-session consolidation. Morgan's exit is not unconditionally terminal: when auto-resume is enabled and a usage-limit condition is detected (per the `limit-aware-resume` capability), the wrapper SHALL wait for the limit window to reset and respawn Morgan with `--resume`, within the bounds defined by that capability. The session ID SHALL be saved after every Morgan exit; the post-session health gate and consolidation SHALL run exactly once, after the final Morgan exit of the run.

#### Scenario: Pre-session setup
- **WHEN** the `run` command starts
- **THEN** the system SHALL acquire a run lock, create a session branch from main, and apply any window/schedule configuration before spawning Morgan

#### Scenario: Post-session consolidation
- **WHEN** the final Morgan CLI session of the run exits and completed items exist
- **THEN** the system SHALL consolidate the session branch to main via a PR (push, create PR, wait for CI, merge)

#### Scenario: Lock released on exit
- **WHEN** the run concludes (normally, via error, or after auto-resume cycles)
- **THEN** the system SHALL release the run lock in a finally block, held continuously across any limit waits and resumes

#### Scenario: Budget and time enforcement
- **WHEN** the configured `timeLimitMs` of active session time elapses during Morgan's session (time spent waiting on a usage limit excluded)
- **THEN** the system SHALL terminate the `claude` CLI process to enforce the time limit

#### Scenario: Limit-interrupted session resumes within one run
- **WHEN** auto-resume is enabled and a usage-limit condition interrupts Morgan
- **THEN** the wrapper SHALL keep the run open (lock held, session branch unchanged), wait per the limit wait loop, respawn Morgan with `--resume`, and defer the health gate and consolidation until the final exit
