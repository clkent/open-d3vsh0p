# Roadmap Reconciliation

## Purpose
Detects pending roadmap items whose implementation already exists on main at session start, and marks them complete before agents begin work. Prevents wasting agent budget re-implementing features that were completed in a previous session but not reflected in the roadmap due to crashes or failed state updates.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/roadmap-reconciler.js` — Reconciliation logic

## Requirements

### Requirement: Detect Previously Merged Items
At session start, the reconciler SHALL scan the git log on main for merge commits matching the pattern `merge: <requirement-id>` to build a set of previously merged requirement IDs.

The reconciler SHALL compare this set against the roadmap's pending items to identify items that are pending in the roadmap but already merged on main.

#### Scenario: Pending item has merge commit on main
- **WHEN** the roadmap has `- [ ] \`calendar-navigation\`` and `git log --oneline main` contains a commit with `merge: calendar-navigation`
- **THEN** the reconciler SHALL identify `calendar-navigation` as needing reconciliation

#### Scenario: Pending item has no merge commit
- **WHEN** the roadmap has `- [ ] \`form-validation\`` and no commit on main mentions `merge: form-validation`
- **THEN** the reconciler SHALL leave `form-validation` as pending

#### Scenario: Completed item ignored
- **WHEN** the roadmap has `- [x] \`auth-system\`` and a merge commit for `auth-system` exists
- **THEN** the reconciler SHALL skip it (already marked complete)

### Requirement: Auto-Mark Reconciled Items Complete
For each item identified as needing reconciliation, the reconciler SHALL call `markItemComplete(id)` on the roadmap reader, update the session state to move the item from pending to completed, and log the reconciliation.

#### Scenario: Items reconciled and committed
- **WHEN** 2 items are identified as needing reconciliation
- **THEN** the reconciler SHALL mark both `[x]` in the roadmap, commit with message `fix: reconcile N items already completed on main`, and log `roadmap_reconciled` with the list of item IDs

#### Scenario: No items need reconciliation
- **WHEN** all pending roadmap items have no matching merge commits on main
- **THEN** the reconciler SHALL make no changes and return `{ reconciled: 0 }`

### Requirement: Reconciliation Runs on Fresh Sessions Only
The reconciler SHALL run on fresh sessions (not `--resume`) after the health check gate passes and before the phase loop begins.

The reconciler SHALL NOT run on resume sessions because resumed sessions already have their state from the previous run.

#### Scenario: Fresh session triggers reconciliation
- **WHEN** a session starts without `--resume`
- **THEN** the reconciler SHALL run after the health check and before `_runPhases()`

#### Scenario: Resume session skips reconciliation
- **WHEN** a session starts with `--resume`
- **THEN** the reconciler SHALL NOT run

### Requirement: Efficient Git Log Scanning
The reconciler SHALL use a single `git log` call to extract all merge commit requirement IDs, rather than one `git log --grep` call per pending item.

#### Scenario: Single git log call
- **WHEN** the roadmap has 15 pending items
- **THEN** the reconciler SHALL run one `git log --oneline main` command, parse all `merge: <id>` patterns, and set-intersect with the pending item IDs
