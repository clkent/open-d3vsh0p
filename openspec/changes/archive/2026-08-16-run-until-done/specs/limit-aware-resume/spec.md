# Limit-Aware Resume — Delta

## ADDED Requirements

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
