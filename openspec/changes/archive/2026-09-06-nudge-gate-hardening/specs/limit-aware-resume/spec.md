## MODIFIED Requirements

### Requirement: Idle-With-Work Continuation
When Morgan's session goes idle without exiting — the transcript has stalled past the stall threshold and the availability probe returns `available` — the system SHALL continue the run rather than leave it waiting, provided unblocked roadmap work remains. An interactive Claude Code session does not exit at the end of a turn, so this is the only recovery path when Morgan stops voluntarily (for example after Claude Code injects its "usage limit approaching — checkpoint now" instruction).

To continue, the system SHALL terminate Morgan's process (SIGTERM, escalating to SIGKILL after the grace period) and respawn it with `--resume <sessionId>` and a continuation prompt that states the run is not finished and that a checkpoint is not a stopping point.

Unblocked roadmap work SHALL be defined as the set of pending item IDs that are not tagged `[HUMAN]` and belong to an actionable phase (every dependency resolves to a phase whose items are all complete or parked). The session loop SHALL obtain this set through a single `getUnblockedPendingIds` callback.

A continuation SHALL be issued only when all of the following hold: auto-resume is enabled, the unblocked set is non-empty, the probe verdict is `available` (never `unknown`), and — for windowed runs — the window end has not passed.

Continuations SHALL be bounded by a futile-continuation cap (default 3). The system SHALL record the unblocked set at run start and at each continuation. When Morgan next goes idle, the continuation just ended SHALL count as progress only if at least one ID from the previously recorded set is absent from the current set (the item was completed, parked, or otherwise resolved). Commits, completions outside the recorded set, and newly unblocked items SHALL NOT count as progress. Progress SHALL reset the counter; that many consecutive continuations without progress SHALL conclude the run.

The number of continuations SHALL be reported in the session summary.

#### Scenario: Idle session with pending work is continued
- **WHEN** the transcript stalls past the threshold, the probe returns `available`, and the unblocked set is non-empty
- **THEN** the system SHALL terminate Morgan and respawn with `--resume` and a continuation prompt

#### Scenario: Idle session with no remaining work concludes
- **WHEN** the transcript stalls, the probe returns `available`, and the unblocked set is empty
- **THEN** the system SHALL NOT continue and SHALL conclude the run normally

#### Scenario: Unknown verdict never triggers a continuation
- **WHEN** the transcript stalls and the probe returns `unknown`
- **THEN** the system SHALL keep re-probing and SHALL NOT continue the session

#### Scenario: Futile continuations are capped
- **WHEN** the configured number of consecutive continuations each end with every previously recorded target still pending
- **THEN** the system SHALL conclude the run instead of continuing again

#### Scenario: Side work does not count as progress
- **WHEN** a continuation ends with new commits and a newly unblocked item, but every previously recorded target is still pending
- **THEN** the futile-continuation counter SHALL increment

#### Scenario: Resolving a target resets the futile counter
- **WHEN** a continuation ends with one of the previously recorded targets complete or parked
- **THEN** the futile-continuation counter SHALL reset, allowing further continuations later in the run

#### Scenario: Opt-out disables continuation
- **WHEN** `run` is executed with `--no-auto-resume` and Morgan goes idle with work remaining
- **THEN** the system SHALL NOT continue the session
