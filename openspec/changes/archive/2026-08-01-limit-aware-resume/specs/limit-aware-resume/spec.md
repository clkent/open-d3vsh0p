# Limit-Aware Resume

## ADDED Requirements

### Requirement: Availability Probe
The system SHALL provide an availability probe that runs a minimal headless `claude -p` call with a cheap model, piped stdio, and a bounded timeout (~60 seconds), and classifies the result as one of: `available` (exit code 0), `limited` (non-zero exit with stderr matching a case-insensitive usage-limit pattern such as `/hit your (session|weekly)? ?limit|resets /i`), or `unknown` (any other failure, including timeout and network errors).

The probe SHALL NOT attempt to parse a reset timestamp from CLI output.

#### Scenario: Probe classifies available
- **WHEN** the probe subprocess exits with code 0
- **THEN** the probe SHALL return `available`

#### Scenario: Probe classifies limited
- **WHEN** the probe subprocess exits non-zero and stderr matches the usage-limit pattern
- **THEN** the probe SHALL return `limited`

#### Scenario: Probe classifies unknown
- **WHEN** the probe subprocess exits non-zero without a matching stderr pattern, or times out
- **THEN** the probe SHALL return `unknown`, and the caller SHALL NOT treat this as confirmation of either availability or limitation

### Requirement: Frozen-Session Stall Detection
While Morgan's CLI session is running, the system SHALL watch the session transcript file (`~/.claude/projects/<sanitized-projectDir>/<sessionId>.jsonl`, where non-alphanumeric characters in the project path are replaced with `-`) by polling its mtime approximately once per minute. The system SHALL only stat the file's mtime and SHALL NOT parse its contents.

When the mtime has not advanced for the stall threshold (default 10 minutes), the system SHALL run the availability probe. If the probe returns `limited`, the system SHALL terminate Morgan's process (SIGTERM, escalating to SIGKILL after a grace period) and enter the limit wait loop. If the probe returns `available`, the system SHALL take no action and SHALL NOT re-probe until the transcript mtime advances again and a new stall occurs.

If the transcript file cannot be found after session start, the system SHALL disable stall detection for the run, log a warning, and rely on early-exit detection only.

#### Scenario: Stall confirmed as limit
- **WHEN** the transcript mtime has not advanced for the stall threshold and the probe returns `limited`
- **THEN** the system SHALL terminate Morgan's process and enter the limit wait loop

#### Scenario: Stall is benign idle
- **WHEN** the transcript mtime has not advanced for the stall threshold and the probe returns `available`
- **THEN** the system SHALL take no action and SHALL NOT probe again until new transcript activity is followed by another stall

#### Scenario: Transcript file missing
- **WHEN** the transcript file does not exist after Morgan's session starts
- **THEN** the system SHALL log a warning, disable stall detection for the run, and keep only early-exit detection active

### Requirement: Early-Exit Limit Detection
When Morgan's process exits with more than 15 minutes of session time budget remaining, the system SHALL run the availability probe once. If the probe returns `limited`, the system SHALL enter the limit wait loop. If the probe returns `available`, the system SHALL treat the exit as an intentional or normal session end and conclude the run without auto-resume.

Exits at or after the time limit SHALL NOT trigger a probe.

#### Scenario: Early exit while limited
- **WHEN** Morgan exits with more than 15 minutes of session time remaining and the probe returns `limited`
- **THEN** the system SHALL enter the limit wait loop

#### Scenario: Intentional early exit
- **WHEN** Morgan exits with more than 15 minutes of session time remaining and the probe returns `available`
- **THEN** the system SHALL conclude the run normally (post-session health gate and consolidation) without auto-resume

#### Scenario: Exit at time limit
- **WHEN** Morgan exits because the time limit SIGTERM fired
- **THEN** the system SHALL NOT probe and SHALL conclude the run normally

### Requirement: Limit Wait Loop
While the account is limited, the system SHALL poll the availability probe on a fixed interval (default 15 minutes), printing a waiting-state line with the next probe time and a Ctrl+C hint before each sleep. The loop SHALL exit and conclude the run (without resuming) when any bound is reached: total wait exceeds the maximum wait (default 5.5 hours), the auto-resume count would exceed the per-run maximum (default 2), or — for scheduled window runs — the projected resume time is past `windowEndTimeMs` or leaves fewer than 15 minutes of window. The loop SHALL exit and resume Morgan when a probe returns `available`. A probe returning `unknown` SHALL continue the loop.

During the wait, a SIGINT handler SHALL cancel the wait and fall through to the normal post-session sequence rather than terminating the orchestrator process abruptly.

#### Scenario: Limit lifts
- **WHEN** a wait-loop probe returns `available`
- **THEN** the system SHALL exit the loop and auto-resume Morgan

#### Scenario: Wait bound reached
- **WHEN** the total wait time exceeds the maximum wait, or the auto-resume cap would be exceeded
- **THEN** the system SHALL conclude the run without resuming

#### Scenario: Window would be exceeded
- **WHEN** the run has `windowEndTimeMs` set and resuming would start past the window end or leave fewer than 15 minutes of window
- **THEN** the system SHALL conclude the run without resuming

#### Scenario: Operator cancels the wait
- **WHEN** SIGINT is received during the wait
- **THEN** the system SHALL cancel the wait and proceed to the post-session health gate and consolidation

### Requirement: Auto-Resume Respawn
When the wait loop exits with `available`, the system SHALL respawn Morgan through the existing resume path: `--resume <sessionId>` with the standard continuation prompt, restoring full conversation context. The session time budget SHALL count active session time only: the SIGTERM timer for the resumed session SHALL be armed with `timeLimitMs` minus active time already consumed, excluding time spent waiting. The session ID SHALL be saved after every Morgan exit; the post-session health gate and consolidation SHALL run exactly once, after the final Morgan exit of the run.

#### Scenario: Resume restores context
- **WHEN** the system auto-resumes after a limit wait
- **THEN** it SHALL spawn `claude` with `--resume <sessionId>` and the standard continuation prompt

#### Scenario: Time budget excludes wait time
- **WHEN** Morgan consumed 2 hours of a 7-hour limit before a limit stop and is auto-resumed
- **THEN** the resumed session's termination timer SHALL be armed with 5 hours, regardless of how long the wait lasted

#### Scenario: Post-session steps run once
- **WHEN** a run includes one or more auto-resumes
- **THEN** the health gate and consolidation SHALL run only after the final Morgan exit

### Requirement: Auto-Resume Opt-Out
Auto-resume SHALL be enabled by default. When the run is started with `--no-auto-resume`, the system SHALL disable both stall detection and early-exit limit detection, restoring pre-feature behavior.

#### Scenario: Opt-out disables detection
- **WHEN** `run` is executed with `--no-auto-resume` and Morgan exits early or stalls
- **THEN** the system SHALL NOT probe availability and SHALL NOT enter the wait loop
