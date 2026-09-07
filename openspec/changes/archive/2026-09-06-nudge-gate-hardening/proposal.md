# Proposal: nudge-gate-hardening

## Why

On 2026-09-06 a run on a managed project nudged Morgan twice ("You stopped with pending roadmap work remaining…") after he had stopped, correctly, because every remaining item was gated on a `[HUMAN]` step. The pending-work gate was wrong for two independent reasons. First, the roadmap's last phase carried a depends comment with a trailing note (`<!-- depends: Phase N; blocked on a vendor account -->`); the parser turned the whole remainder into a dependency name that matches no phase, and `getActionablePhaseNumbers` treats an unresolvable dependency as satisfied, so that phase's two untagged items counted as unblocked work. Second, the futile-continuation cap resets on any commit or completed-count change, and each nudge pushed Morgan to find something to commit out of HUMAN-tagged items, so the counter reset every time and the loop could never conclude.

## What Changes

- **Dependency parsing extracts phase references only.** A depends comment yields the `Phase <numeral>` references it contains; any other text is treated as a note for Morgan. `Phase III; blocked on a vendor account` becomes `["III"]`. A comment with no references (for example `depends: none`) yields no dependencies.
- **Unresolvable dependencies fail closed.** A dependency that names a phase not in the roadmap blocks the phase instead of satisfying it. The format validator already reports such references as errors; the reader now agrees with it at run time.
- **Continuation progress is measured against the items that justified it.** The session loop records the unblocked pending item IDs when it continues Morgan. The next time he goes idle, the continuation counts as progress only if at least one of those items is no longer pending (complete or parked). Commits or completions elsewhere do not reset the futile counter. The `hasPendingWork` and `getProgressSignature` callbacks are replaced by a single `getUnblockedPendingIds` callback.

The stall threshold, probe, and futile cap (3) are unchanged.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `parallel-execution`: Phase Dependencies parsing extracts phase references and ignores trailing notes; actionable-phase resolution treats unknown dependencies as blocking.
- `limit-aware-resume`: Idle-With-Work Continuation measures progress as resolution of the continuation's target items rather than a commit/count signature.

## Impact

- `platform/orchestrator/src/roadmap/roadmap-reader.js`: depends parsing, `getActionablePhaseNumbers`.
- `platform/orchestrator/src/commands/limit-resume.js`: `runSessionWithAutoResume` API and futile accounting.
- `platform/orchestrator/src/commands/run.js`: `unblockedPendingIds` replaces `hasUnblockedPendingWork` and `progressSignature`.
- Tests for all three; README wording on continuations; roadmap entry.
- The affected project needs no roadmap edit; its existing comment now parses as intended.
