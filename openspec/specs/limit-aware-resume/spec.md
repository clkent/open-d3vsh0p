# Limit-Aware Resume

## Purpose
When the account's Claude usage limit stops Morgan mid-run — freezing the interactive session or causing an early exit — the `run` command detects it, waits out the limit window within strict bounds, and resumes Morgan with full conversation context instead of silently wasting the rest of the run. The same machinery continues an idle Morgan who ended a turn while unblocked roadmap work remains, so an unattended run doesn't sit waiting for input that never comes.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/commands/limit-resume.js` — probe, stall watcher, wait loop, session loop
- `platform/orchestrator/src/commands/run.js` — integration into the run lifecycle, pending-work and progress callbacks
- `platform/orchestrator/src/commands/cli-spawn.js` — session-ID validation on load

## Requirements

### Requirement: Availability Probe
The system SHALL provide an availability probe that runs a minimal headless `claude -p` call with piped stdio and a bounded timeout (~60 seconds), and classifies the result as one of: `available` (exit code 0), `limited` (non-zero exit with combined stdout+stderr matching a case-insensitive usage-limit pattern covering at least `hit your … limit`, `reached your … limit`, `usage limit`, `limit reached`, and `resets`), or `unknown` (any other failure, including timeout and network errors).

The probe SHALL run with the same model Morgan's session is configured to use, passing `--model` only when Morgan's config specifies one (so an unconfigured probe uses the account default, matching Morgan). The probe SHALL capture both stdout and stderr for classification and SHALL NOT echo either stream to the orchestrator's output.

The probe SHALL NOT attempt to parse a reset timestamp from CLI output.

#### Scenario: Probe classifies available
- **WHEN** the probe subprocess exits with code 0
- **THEN** the probe SHALL return `available`

#### Scenario: Probe classifies limited from either stream
- **WHEN** the probe subprocess exits non-zero and the limit pattern appears on stdout or stderr
- **THEN** the probe SHALL return `limited`

#### Scenario: Probe mirrors Morgan's model
- **WHEN** Morgan's session is configured with a specific model
- **THEN** the probe SHALL pass that model via `--model`, and SHALL omit `--model` when Morgan has no configured model

#### Scenario: Probe classifies unknown
- **WHEN** the probe subprocess exits non-zero without a matching pattern on either stream, or times out
- **THEN** the probe SHALL return `unknown`, and the caller SHALL NOT treat this as confirmation of either availability or limitation

### Requirement: Frozen-Session Stall Detection
While Morgan's CLI session is running, the system SHALL watch the project's transcript directory (`~/.claude/projects/<sanitized-projectDir>/`, where non-alphanumeric characters in the project path are replaced with `-`) by polling approximately once per minute for the maximum mtime across `*.jsonl` files. Tracking the directory's newest transcript (rather than one fixed session file) keeps detection working after `--resume` creates a new session transcript. The system SHALL only stat file mtimes and SHALL NOT parse transcript contents.

When the newest mtime has not advanced for the stall threshold (default 10 minutes), the system SHALL run the availability probe. If the probe returns `limited`, the system SHALL terminate Morgan's process (SIGTERM, escalating to SIGKILL after a grace period) and enter the limit wait loop. If the probe returns `available` or `unknown`, the system SHALL keep watching and SHALL re-probe on a re-probe interval (default 15 minutes) for as long as the stall persists; fresh transcript activity resets the stall cycle. A non-`limited` probe SHALL NOT permanently disable detection. An `available` verdict additionally offers the run loop the chance to continue an idle session (see Idle-With-Work Continuation); when the loop takes over, the watcher stops.

If no transcript files can be found after session start (three consecutive failed checks), the system SHALL disable stall detection for the run, log a warning, and rely on early-exit detection only.

#### Scenario: Stall confirmed as limit
- **WHEN** the newest transcript mtime has not advanced for the stall threshold and the probe returns `limited`
- **THEN** the system SHALL terminate Morgan's process and enter the limit wait loop

#### Scenario: Misclassified probe self-heals
- **WHEN** a stall probe returns `available` or `unknown` and the transcript remains stalled
- **THEN** the system SHALL re-probe after the re-probe interval, and SHALL detect the limit on a later probe that returns `limited`

#### Scenario: Detection survives resume
- **WHEN** Morgan is respawned with `--resume` and Claude Code writes a new transcript file in the project's transcript directory
- **THEN** the watcher SHALL track the new file's activity via the directory's newest mtime without reconfiguration

#### Scenario: Transcript directory missing
- **WHEN** no transcript files exist after Morgan's session starts (three consecutive checks)
- **THEN** the system SHALL log a warning, disable stall detection for the run, and keep only early-exit detection active

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

### Requirement: Idle-With-Work Continuation
When Morgan's session goes idle without exiting — the transcript has stalled past the stall threshold and the availability probe returns `available` — the system SHALL continue the run rather than leave it waiting, provided unblocked roadmap work remains. An interactive Claude Code session does not exit at the end of a turn, so this is the only recovery path when Morgan stops voluntarily (for example after Claude Code injects its "usage limit approaching — checkpoint now" instruction).

To continue, the system SHALL terminate Morgan's process (SIGTERM, escalating to SIGKILL after the grace period) and respawn it with `--resume <sessionId>` and a continuation prompt that states the run is not finished and that a checkpoint is not a stopping point.

A continuation SHALL be issued only when all of the following hold: auto-resume is enabled, the roadmap has at least one pending item that is not blocked by an incomplete `[HUMAN]` prerequisite, the probe verdict is `available` (never `unknown`), and — for windowed runs — the window end has not passed.

Continuations SHALL be bounded by a futile-nudge cap (default 3): if that many consecutive continuations produce no change in the run's progress signature (roadmap completed-item count and git HEAD), the system SHALL conclude the run. Any observed progress SHALL reset the counter.

The number of continuations SHALL be reported in the session summary.

#### Scenario: Idle session with pending work is continued
- **WHEN** the transcript stalls past the threshold, the probe returns `available`, and unblocked pending roadmap items remain
- **THEN** the system SHALL terminate Morgan and respawn with `--resume` and a continuation prompt

#### Scenario: Idle session with no remaining work concludes
- **WHEN** the transcript stalls, the probe returns `available`, and every remaining item is complete, parked, or `[HUMAN]`-blocked
- **THEN** the system SHALL NOT continue and SHALL conclude the run normally

#### Scenario: Unknown verdict never triggers a continuation
- **WHEN** the transcript stalls and the probe returns `unknown`
- **THEN** the system SHALL keep re-probing and SHALL NOT continue the session

#### Scenario: Futile continuations are capped
- **WHEN** the configured number of consecutive continuations produce no change in the progress signature
- **THEN** the system SHALL conclude the run instead of continuing again

#### Scenario: Progress resets the futile counter
- **WHEN** a continuation is followed by a change in the progress signature
- **THEN** the futile-continuation counter SHALL reset, allowing further continuations later in the run

#### Scenario: Opt-out disables continuation
- **WHEN** `run` is executed with `--no-auto-resume` and Morgan goes idle with work remaining
- **THEN** the system SHALL NOT continue the session

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

### Requirement: Auto-Resume Opt-Out
Auto-resume SHALL be enabled by default. When the run is started with `--no-auto-resume`, the system SHALL disable stall detection, early-exit limit detection, and idle-with-work continuation, restoring pre-feature behavior.

#### Scenario: Opt-out disables detection
- **WHEN** `run` is executed with `--no-auto-resume` and Morgan exits early or stalls
- **THEN** the system SHALL NOT probe availability, SHALL NOT enter the wait loop, and SHALL NOT continue an idle session
