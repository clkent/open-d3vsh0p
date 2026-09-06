# Design: nudge-gate-hardening

## Context

`runSessionWithAutoResume` (limit-resume.js) decides whether to continue an idle Morgan by asking `run.js` `hasUnblockedPendingWork`, which relies on `RoadmapReader.getActionablePhaseNumbers`. Futility is judged by `progressSignature` = completed-item count + git HEAD. Field evidence from a managed project's run on 2026-09-06 (two stops, each nudged 10 to 14 minutes later) shows both the phase gate and the progress measure misfiring; running the reader over the roadmap as it stood at each nudge returns two untagged items from the final phase as unblocked, because that phase's depends comment carries a free-text note after the phase reference.

## Goals / Non-Goals

**Goals:**
- Never nudge on the strength of a dependency the reader could not resolve.
- Accept the `depends: Phase N; <note>` form Riley and Morgan already write.
- Make the futile cap bite when continuations produce side work but resolve none of the items that justified them.

**Non-Goals:**
- Reading transcripts to understand why Morgan stopped (the orchestrator treats transcript contents as opaque by design).
- Changing the stall threshold, probe cadence, or the cap of 3.
- Item-level blockers that are not expressed as `[HUMAN]` tags or phase dependencies.

## Decisions

### D1: Parse references, not the whole comment
`depends` becomes the list of `Phase <numeral>` matches (`/Phase\s+([IVXLC]+|[0-9]+)\b/g`) in the comment. Free text is ignored. No matches means no dependencies, which preserves today's behavior for `depends: none` (previously an unresolvable name that happened to count as satisfied). The validator's "depends on Phase X which does not exist" check keeps working on the parsed list.

Alternative: reject notes in the comment and require a clean list. Rejected because the note form is useful and already in use; the reader should be lenient while the gate is strict.

### D2: Unknown dependency blocks
In `getActionablePhaseNumbers`, a dependency that resolves to no phase makes the phase non-actionable. This is the conservative direction for the nudge gate (a missed nudge costs an idle wait; a false nudge costs an unwanted interruption and invented work). Morgan's own reading of the roadmap is unaffected.

### D3: Progress means a target item was resolved
`runSessionWithAutoResume` takes `getUnblockedPendingIds: () => Promise<string[]>` in place of `hasPendingWork` and `getProgressSignature`. It captures the set at run start and at each continuation. When the next idle arrives, the continuation just ended counts as progress only if some ID from the previous set is absent from the current set (completed, parked, or otherwise no longer pending). Otherwise `futileNudges` increments; the cap concludes the run as before. Newly unblocked items appearing do not count as progress. An empty current set means no continuation. This removes git HEAD from the decision entirely: side commits made under pressure no longer keep the loop alive.

Alternative: keep the HEAD signature and add the target check. Rejected: HEAD movement is exactly the false signal observed.

### D4: Keep the cap at 3
With the initial set captured at start, an unfixable phantom (like the field case) yields two continuations and then a conclusion, matching the existing tests' expectations.

## Risks / Trade-offs

- [A roadmap that legitimately says `depends: Phase 3` while phases are numbered in Roman numerals now blocks instead of silently passing] → The validator already flags it; the run summary will show `Continues: 0` and Morgan's own summary explains the stop.
- [Morgan completes a large target across more than three stops] → Each stop mid-item without a completion is the wedged pattern the cap exists for; unchanged from today's intent.
- [API change for `runSessionWithAutoResume`] → Internal; only `run.js` and tests call it.

## Migration Plan

Single PR; no data migration. Existing runs pick up the change on their next launch.

## Open Questions

- Whether to warn at run start when any phase has an unresolvable dependency. Left out; the validator covers kickoff and plan, and the run summary makes a blocked roadmap visible.
