# Microcycle Salvage Check

## Purpose
Detects and recovers completed work when an agent fails during a microcycle (e.g., context overflow). If tests pass and commits exist on the work branch, the work is salvaged and can be merged even if the microcycle returns parked.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/microcycle.js` — `_trySalvage()` method and salvage metadata in results
- `platform/orchestrator/src/parallel-orchestrator.js` — Salvage-merge path in `_executeGroup()`

## Requirements

### Requirement: Salvage Completed Work on Agent Failure
When an agent fails (e.g., context overflow) but has committed work that passes tests, the microcycle SHALL salvage the work by falling through to the TEST phase. The microcycle result SHALL include `salvaged: true` and the `workBranch` name when salvaged work exists, regardless of whether the microcycle ultimately returns `merged` or `parked`.

When the parallel orchestrator receives a `parked` result with `salvaged: true` and a valid `workBranch`, it SHALL attempt to merge the salvaged work branch into the session branch. If the merge succeeds and tests pass on the session branch afterward, the orchestrator SHALL mark the item as complete in the roadmap and update the session state accordingly, instead of parking it.

If the salvage-merge fails (merge conflict or tests fail), the item SHALL be parked normally.

#### Scenario: Salvaged work merged on park
- **WHEN** a microcycle returns `{ status: 'parked', salvaged: true, workBranch: 'devshop/work-.../item-id' }`
- **THEN** the orchestrator SHALL attempt to merge the work branch into the session branch
- **THEN** if merge succeeds and `npm test` passes, the item SHALL be marked `[x]` in the roadmap and added to `state.requirements.completed`

#### Scenario: Salvage metadata in microcycle result
- **WHEN** `_trySalvage()` returns `{ salvaged: true }` and the microcycle later returns `parked`
- **THEN** the result object SHALL include `salvaged: true` and `workBranch` set to the branch name where the salvaged commits exist

#### Scenario: Salvage-merge fails
- **WHEN** the orchestrator attempts to merge a salvaged work branch but git merge fails or tests fail afterward
- **THEN** the item SHALL be parked with the original error and a log entry `salvage_merge_failed` SHALL be emitted

#### Scenario: Salvage-merge logged as unreviewed
- **WHEN** a salvaged work branch is successfully merged without Morgan's review
- **THEN** the orchestrator SHALL log `salvage_merged_without_review` with the requirement ID so the work can be reviewed in a subsequent architecture check
