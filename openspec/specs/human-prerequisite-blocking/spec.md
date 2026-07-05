# Human Prerequisite Blocking

## Purpose
Ensures `[HUMAN]` roadmap items that are prerequisites for agent work are never attempted by agents and are surfaced to the developer for resolution, preventing wasted budget on tasks that will fail due to missing resources. Group Z user testing checkpoints remain non-blocking.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/roadmap/roadmap-reader.js` — `[HUMAN]` tag parsing and phase dependency resolution with blocking items
- `platform/orchestrator/src/roadmap/action-resolver.js` — analysis of incomplete `[HUMAN]` items for the action command
- `templates/agents/_shared/roadmap-execution-rules.md` — instructs Morgan to skip `[HUMAN]` items
- `templates/agents/_shared/roadmap-rules.md` — Group Z checkpoint convention (non-blocking `[HUMAN]` items)

## Requirements

### `[HUMAN]` Tag Parsing
The roadmap reader SHALL detect `[HUMAN]` tags in item descriptions and set an `isHuman` flag on the parsed item. Human items SHALL be preserved when parked items are reset (unless explicitly included), and the reader SHALL support annotating a parked item with a `[HUMAN]` marker.

#### Scenario: HUMAN item detection
- **WHEN** a roadmap item has `[HUMAN]` in its description
- **THEN** the parsed item SHALL have `isHuman: true`

#### Scenario: Reset preserves HUMAN items
- **WHEN** parked items are reset to pending without `includeHuman`
- **THEN** parked items tagged `[HUMAN]` SHALL remain parked

### Agents Skip `[HUMAN]` Items
Morgan's roadmap execution rules SHALL instruct him to skip items tagged `[HUMAN]` — these require manual action the developer must do. Parked `[!]` items SHALL be re-attempted only when they are not tagged `[HUMAN]`.

#### Scenario: Morgan skips a HUMAN prerequisite
- **WHEN** Morgan's run session reaches an item tagged `[HUMAN]`
- **THEN** Morgan SHALL leave it for the developer and move on rather than spending budget on it

### Dependent Phase Blocking
Phases that depend on a phase with unresolved blocking items SHALL NOT begin execution until those items are completed. The roadmap reader's `getNextPhase(roadmap, blockingParkedIds)` SHALL treat parked items whose IDs are in `blockingParkedIds` as unsatisfied dependencies.

#### Scenario: Dependent phase waits for blocking items
- **WHEN** Phase II depends on Phase I
- **AND** Phase I has parked items listed in `blockingParkedIds`
- **THEN** `getNextPhase` SHALL NOT return Phase II

#### Scenario: Non-blocking parked items do not block dependent phases
- **WHEN** Phase II depends on Phase I
- **AND** Phase I's parked items are not in `blockingParkedIds` (e.g., Group Z checkpoints)
- **THEN** `getNextPhase` SHALL consider Phase I satisfied and return Phase II

### Surfacing via the Action Command
The `action` command SHALL surface incomplete `[HUMAN]` items to the developer for interactive resolution. The action resolver SHALL analyze the roadmap, filter to incomplete items with `isHuman: true` in actionable phases, and classify each by action type (e.g., environment setup for API-key/credentials items).

#### Scenario: HUMAN items listed for resolution
- **WHEN** `./devshop action my-project` is executed and the roadmap contains pending or parked `[HUMAN]` items in actionable phases
- **THEN** the command SHALL list each item with its phase and guide the developer through resolving it

#### Scenario: Deferred HUMAN items counted
- **WHEN** `[HUMAN]` items exist in phases that are not yet actionable
- **THEN** the resolver SHALL exclude them from the actionable list and report them as deferred
