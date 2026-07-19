# Human Prerequisite Blocking

## Purpose
Ensures `[HUMAN]` roadmap items that are prerequisites for agent work are never attempted by agents and are surfaced to the developer for resolution, preventing wasted budget on tasks that will fail due to missing resources. Group Z user testing checkpoints remain non-blocking.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/roadmap/roadmap-reader.js` — `[HUMAN]` tag parsing
- `platform/orchestrator/src/roadmap/action-resolver.js` — analysis of incomplete `[HUMAN]` items for the action command
- `templates/agents/_shared/roadmap-execution-rules.md` — instructs Morgan to skip `[HUMAN]` items
- `templates/agents/_shared/roadmap-rules.md` — Group Z checkpoint convention (non-blocking `[HUMAN]` items)

## Requirements

### `[HUMAN]` Tag Parsing
The roadmap reader SHALL detect `[HUMAN]` tags in item descriptions and set an `isHuman` flag on the parsed item.

#### Scenario: HUMAN item detection
- **WHEN** a roadmap item has `[HUMAN]` in its description
- **THEN** the parsed item SHALL have `isHuman: true`

### Agents Skip `[HUMAN]` Items
Morgan's roadmap execution rules SHALL instruct him to skip items tagged `[HUMAN]` — these require manual action the developer must do. Parked `[!]` items SHALL be re-attempted only when they are not tagged `[HUMAN]`.

#### Scenario: Morgan skips a HUMAN prerequisite
- **WHEN** Morgan's run session reaches an item tagged `[HUMAN]`
- **THEN** Morgan SHALL leave it for the developer and move on rather than spending budget on it

### Dependent Phase Blocking
Phases that depend on a phase with unresolved blocking `[HUMAN]` items SHALL NOT begin execution until those items are completed. Morgan's roadmap execution rules SHALL instruct him to treat incomplete `[HUMAN]` prerequisites in a dependency phase as blocking, while Group Z user-testing checkpoints remain non-blocking.

#### Scenario: Dependent phase waits for blocking items
- **WHEN** Phase II depends on Phase I
- **AND** Phase I has an incomplete `[HUMAN]` prerequisite (non-Group-Z)
- **THEN** Morgan SHALL NOT start Phase II and SHALL surface the blocking item to the developer

#### Scenario: Group Z checkpoints do not block dependent phases
- **WHEN** Phase II depends on Phase I
- **AND** Phase I's only incomplete `[HUMAN]` items are Group Z user-testing checkpoints
- **THEN** Morgan SHALL treat Phase I as satisfied and proceed with Phase II

### Surfacing via the Action Command
The `action` command SHALL surface incomplete `[HUMAN]` items to the developer for interactive resolution. The action resolver SHALL analyze the roadmap, filter to incomplete items with `isHuman: true` in actionable phases, and classify each by action type (e.g., environment setup for API-key/credentials items).

#### Scenario: HUMAN items listed for resolution
- **WHEN** `./devshop action my-project` is executed and the roadmap contains pending or parked `[HUMAN]` items in actionable phases
- **THEN** the command SHALL list each item with its phase and guide the developer through resolving it

#### Scenario: Deferred HUMAN items counted
- **WHEN** `[HUMAN]` items exist in phases that are not yet actionable
- **THEN** the resolver SHALL exclude them from the actionable list and report them as deferred
