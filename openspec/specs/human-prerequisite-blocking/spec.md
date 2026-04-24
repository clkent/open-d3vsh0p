# Human Prerequisite Blocking

## Purpose
Ensures the orchestrator blocks on `[HUMAN]` roadmap items that are prerequisites for agent work, preventing wasted budget on tasks that will fail due to missing resources. Group Z user testing checkpoints remain non-blocking.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/parallel-orchestrator.js` — auto-parking classification and phase pause logic
- `platform/orchestrator/src/roadmap/roadmap-reader.js` — phase dependency resolution with blocking items

## Requirements

### Position-Based Blocking Classification
The orchestrator SHALL classify `[HUMAN]` items as `blocking` or `non_blocking` based on their group position. Items in Group Z SHALL be classified as `non_blocking`. Items in any other group (A, B, C, etc.) SHALL be classified as `blocking`.

#### Scenario: HUMAN item in Group A is blocking
- **WHEN** the orchestrator auto-parks a `[HUMAN]` item in Group A
- **THEN** the item SHALL be classified as `blocking`

#### Scenario: HUMAN item in Group Z is non-blocking
- **WHEN** the orchestrator auto-parks a `[HUMAN]` item in Group Z
- **THEN** the item SHALL be classified as `non_blocking`

### Phase Pause on Blocking HUMAN Items
When a phase contains only blocking `[HUMAN]` items (no agent-executable work), the orchestrator SHALL pause execution, surface the items to the human, and wait for restart.

#### Scenario: Pure human prerequisites phase triggers pause
- **WHEN** the orchestrator begins a phase where all pending items are blocking `[HUMAN]` items
- **THEN** the orchestrator SHALL pause with a message identifying each item and instructing the human to complete them and restart

#### Scenario: Mixed phase with blocking HUMAN items
- **WHEN** a phase contains both blocking `[HUMAN]` items and agent-executable items
- **THEN** agent-executable items SHALL proceed normally
- **AND** blocking `[HUMAN]` items SHALL be parked as `blocking`
- **AND** dependent phases SHALL NOT start until the blocking items are resolved

### Dependent Phase Blocking
Phases that depend on a phase with unresolved blocking `[HUMAN]` items SHALL NOT begin execution until those items are completed.

#### Scenario: Dependent phase waits for blocking HUMAN items
- **WHEN** Phase II depends on Phase I
- **AND** Phase I has unresolved blocking `[HUMAN]` items
- **THEN** Phase II SHALL NOT begin execution

#### Scenario: Non-blocking items do not block dependent phases
- **WHEN** Phase II depends on Phase I
- **AND** Phase I has only `non_blocking` parked items (Group Z checkpoints)
- **THEN** Phase II SHALL begin execution normally
