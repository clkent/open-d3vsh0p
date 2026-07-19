# Spike Phases

## Purpose
Provides a structured mechanism for investigating technical unknowns before committing to full implementation. When Riley identifies genuine uncertainty during kickoff (unfamiliar APIs, novel algorithms, architectural bets), she creates `[SPIKE]` items in a dedicated first phase. Morgan investigates spikes himself during his run session and records findings before implementation phases begin.

## Status
IMPLEMENTED

## Requirements

### Spike Detection in Roadmap
The system SHALL detect `[SPIKE]` tags in roadmap item descriptions and set an `isSpike` flag on the parsed item, mirroring the existing `[HUMAN]` tag detection pattern.

#### Scenario: Spike item detection
- **WHEN** a roadmap item has `[SPIKE]` in its description
- **THEN** the parsed item SHALL have `isSpike: true`

#### Scenario: Non-spike item
- **WHEN** a roadmap item does not have `[SPIKE]` in its description
- **THEN** the parsed item SHALL have `isSpike: false`

### Spike Investigation by Morgan
Spike items SHALL be investigated by Morgan (principal engineer) directly within his run session — not delegated to implementation sub-agents. The shared roadmap rules SHALL state that `[SPIKE]` items are investigated by Morgan.

#### Scenario: Morgan investigates a spike
- **WHEN** Morgan's run session reaches a `[SPIKE]` item
- **THEN** Morgan SHALL investigate the technical question in-session and record findings before marking the item complete

### PM Spike Guidance
Riley's roadmap-authoring guidance (shared `roadmap-rules.md` partial) SHALL include when to create spike items and the `[SPIKE]` tag format.

#### Scenario: Spike creation criteria
- **WHEN** Riley evaluates project features for uncertainty
- **THEN** she SHALL create `[SPIKE]` items only for genuine unknowns: unfamiliar APIs, novel algorithms, architectural bets requiring prototyping

#### Scenario: Spike limits
- **WHEN** Riley creates spike items
- **THEN** there SHALL be no more than 3 spike items per project, and they SHALL be placed in the first phase
