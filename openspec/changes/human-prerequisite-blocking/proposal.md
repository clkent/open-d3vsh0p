## Why

Currently all `[HUMAN]` items are auto-parked as `non_blocking` — the orchestrator continues past them regardless of whether the human has completed them. This is correct for Group Z user testing checkpoints (advisory "go verify this when you can"), but wrong for prerequisite HUMAN items like "obtain API keys" or "provision cloud infrastructure." When prerequisite HUMAN items are non-blocking, the orchestrator starts agent work that depends on resources that don't exist yet, wasting budget on guaranteed failures.

## What Changes

- **Position-based blocking classification**: `[HUMAN]` items in any group *except* Group Z are classified as `blocking` instead of `non_blocking`. Group Z items remain non-blocking.
- **Phase-level blocking**: When all pending items in a phase are blocking `[HUMAN]` items (i.e., a pure Human Prerequisites phase), the orchestrator pauses execution, surfaces the items to the human, and waits for restart.
- **Action command integration**: Blocking HUMAN items are surfaced via `devshop action` with clear instructions ("complete these items and restart the orchestrator").

## Capabilities

### New Capabilities
- `human-prerequisite-blocking`: Orchestrator blocks on `[HUMAN]` items outside Group Z, pausing for human action before proceeding to dependent phases

### Modified Capabilities
- `parallel-execution`: Phase dependency resolution respects blocking HUMAN items — a phase with unresolved blocking HUMAN items prevents dependent phases from starting

## Impact

### Code Changes
- `platform/orchestrator/src/parallel-orchestrator.js` — Modify auto-parking logic (lines 610-627) to classify HUMAN items by group position: Group Z → `non_blocking`, all other groups → `blocking`. Add pause trigger when a phase contains only blocking HUMAN items.
- `platform/orchestrator/src/roadmap/roadmap-reader.js` — `getNextPhase()` already respects `blockingParkedIds`; may need minor adjustment to ensure blocking HUMAN items are included in the blocking set.
- `platform/orchestrator/src/runners/item-triage.js` — No changes needed; triage classification is already set during auto-parking, not by the triage agent.

### Risk
Medium. Changes the core phase progression logic. Existing projects with HUMAN items in non-Z groups will now block where they previously continued. This is the desired behavior but needs thorough testing.
