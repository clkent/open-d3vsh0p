# Session Auto-Consolidation

## Purpose
Automatically consolidates the session branch to main via PR at session end, and audits the roadmap to ensure all merged requirements are properly marked complete.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/commands/run.js` — Consolidation call and post-consolidation audit
- `platform/orchestrator/src/git-ops.js` — `consolidateToMain()` method

## Requirements

### Requirement: Auto-Consolidate Session Branch
After a session completes with at least one completed requirement and `--no-consolidate` is not set, the system SHALL create a PR from the session branch to main and merge it.

#### Scenario: Successful consolidation
- **WHEN** a session completes with completed requirements
- **THEN** the system SHALL call `consolidateToMain()` and log success

#### Scenario: Consolidation skipped
- **WHEN** no requirements were completed or `--no-consolidate` is set
- **THEN** the system SHALL skip consolidation

### Requirement: Post-Consolidation Roadmap Audit
After the session branch is consolidated to main, the system SHALL audit the roadmap to ensure all merged requirements are marked complete.

The audit SHALL scan git commit messages on the consolidated session for the pattern `merge: <requirement-id>` to identify which requirements were merged during the session.

For each merged requirement ID that is still marked `[ ]` (pending) in the roadmap, the system SHALL mark it `[x]` (complete).

If any items were fixed, the system SHALL commit the roadmap changes to main with message `fix: mark N items complete in roadmap (post-consolidation audit)`.

#### Scenario: All items already marked correctly
- **WHEN** consolidation completes and all merged items are already `[x]` in the roadmap
- **THEN** the audit SHALL make no changes

#### Scenario: Unmarked items detected and fixed
- **WHEN** consolidation completes and 2 merged items are still marked `[ ]` in the roadmap
- **THEN** the audit SHALL mark both items `[x]`, commit the change to main, and log the fixed item IDs

#### Scenario: No merge commits found
- **WHEN** the session had no merge commits (e.g., all items were parked)
- **THEN** the audit SHALL skip without changes

#### Scenario: Audit runs only after successful consolidation
- **WHEN** `consolidateToMain()` fails or is skipped (no completed items, `--no-consolidate`)
- **THEN** the audit SHALL NOT run
