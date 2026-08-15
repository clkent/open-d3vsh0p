# Limit-Aware Resume — Delta

## MODIFIED Requirements

### Requirement: Early-Exit Limit Detection
When Morgan's process exits without having been terminated by a window-end deadline, the system SHALL run the availability probe once. If the probe returns `limited`, the system SHALL enter the limit wait loop. If the probe returns `available`, the system SHALL treat the exit as an intentional or normal session end and conclude the run without auto-resume.

Exits caused by the window-end deadline SIGTERM SHALL NOT trigger a probe. There is no session time budget: no minimum-remaining-time condition SHALL gate the probe.

#### Scenario: Early exit while limited
- **WHEN** Morgan exits (not via a window-end deadline) and the probe returns `limited`
- **THEN** the system SHALL enter the limit wait loop

#### Scenario: Intentional early exit
- **WHEN** Morgan exits (not via a window-end deadline) and the probe returns `available`
- **THEN** the system SHALL conclude the run normally (post-session health gate and consolidation) without auto-resume

#### Scenario: Exit at window end
- **WHEN** Morgan exits because the window-end deadline SIGTERM fired
- **THEN** the system SHALL NOT probe and SHALL conclude the run normally

### Requirement: Auto-Resume Respawn
When the wait loop exits with `available`, the system SHALL respawn Morgan through the existing resume path: `--resume <sessionId>` with the standard continuation prompt, restoring full conversation context. The resumed session SHALL NOT be armed with a time-limit timer; for windowed runs, the window-end deadline (`windowEndTimeMs`) SHALL continue to apply to the resumed session. The session ID SHALL be saved after every Morgan exit; the post-session health gate and consolidation SHALL run exactly once, after the final Morgan exit of the run.

#### Scenario: Resume restores context
- **WHEN** the system auto-resumes after a limit wait
- **THEN** it SHALL spawn `claude` with `--resume <sessionId>` and the standard continuation prompt

#### Scenario: Resumed session has no time limit
- **WHEN** Morgan is auto-resumed on a run without `--window`
- **THEN** no termination timer SHALL be armed for the resumed session

#### Scenario: Post-session steps run once
- **WHEN** a run includes one or more auto-resumes
- **THEN** the health gate and consolidation SHALL run only after the final Morgan exit
