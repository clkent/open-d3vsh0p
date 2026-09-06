## 1. Roadmap Reader

- [x] 1.1 Parse depends comments by extracting `Phase <numeral>` references; ignore other text; no references yields `[]`
- [x] 1.2 `getActionablePhaseNumbers` treats an unresolvable dependency as blocking
- [x] 1.3 Tests: trailing note, multiple references with text between, `none`, unknown dependency blocks; existing tests still pass

## 2. Session Loop

- [x] 2.1 Replace `hasPendingWork` and `getProgressSignature` with `getUnblockedPendingIds` in `runSessionWithAutoResume`; capture the set at start and at each continuation
- [x] 2.2 Judge each continuation by whether a previously recorded target left the set; increment or reset `futileNudges`; keep the cap and give-up reason
- [x] 2.3 Update existing continuation tests to the new callback; add tests for side work not counting and for a resolved target resetting the counter

## 3. Run Command

- [x] 3.1 Replace `hasUnblockedPendingWork` and `progressSignature` with `unblockedPendingIds` (sorted IDs of pending, non-HUMAN items in actionable phases) and pass it to the session loop
- [x] 3.2 Full orchestrator test suite passes

## 4. Docs

- [x] 4.1 README: continuation progress wording
- [x] 4.2 Roadmap entry under Phase XVIII Group B; sync main specs on archive
