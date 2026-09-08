# Proposal: group-z-nonblocking-gate

## Why

The roadmap reader's actionable-phase check treats every pending item in a dependency phase as blocking, including the Group Z user-testing checkpoint that every finished phase leaves open for the developer. Morgan's execution rules and the `human-prerequisite-blocking` spec both say Group Z checkpoints are non-blocking, so Morgan proceeds into the next phase while the orchestrator's idle-continuation gate reports no unblocked work. A field test on 2026-09-07 showed the consequence: Morgan was deliberately stopped with two workable items in the next phase, and the run never continued him because the previous phase's test checkpoint was pending. In practice this disables idle continuation on nearly every in-flight project, and it also hides those phases from `devshop action`.

## What Changes

- **Group Z never blocks a dependent phase.** When judging whether a dependency phase is satisfied, the reader ignores pending items in Group Z. Non-Group-Z `[HUMAN]` items and ordinary pending items still block, exactly as before.
- No change to Morgan's prompts; the reader now agrees with them.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `parallel-execution`: Phase Dependencies actionable rule excludes Group Z items from the satisfied check.
- `human-prerequisite-blocking`: Dependent Phase Blocking gains a reader-level requirement mirroring the Morgan-level rule, so `run`'s continuation gate and `action` honor it.

## Impact

- `platform/orchestrator/src/roadmap/roadmap-reader.js` (`getActionablePhaseNumbers`) and its tests.
- Consumers gain phases that were wrongly hidden: `run.js` `unblockedPendingIds` (idle continuation fires when the next phase has work) and `action-resolver.js` (lists HUMAN items in those phases).
- README wording; roadmap entry.
