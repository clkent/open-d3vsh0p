# Tasks: human-prerequisite-blocking

1. [x] Modify HUMAN auto-parking in `parallel-orchestrator.js` (`_executePhase`, ~line 610) to classify by group: Group Z → `non_blocking`, all other groups → `blocking`
2. [x] Add pause trigger when a phase consists entirely of blocking HUMAN items — orchestrator should stop with a clear message identifying the items and instructing the human to complete them and restart
3. [x] Verify `getNextPhase()` in `roadmap-reader.js` correctly blocks dependent phases when blocking HUMAN items are parked — existing `blockingParkedIds` mechanism handles this with no code changes needed
4. [x] Surface blocking HUMAN items in `devshop action` output with actionable instructions — already handled by existing action-resolver.js which finds all HUMAN-tagged parked items
5. [x] Add tests: HUMAN item in Group A is classified as blocking; HUMAN item in Group Z is classified as non-blocking
6. [x] Add tests: phase with only blocking HUMAN items triggers orchestrator pause
7. [x] Add tests: dependent phase does not start until blocking HUMAN items in prerequisite phase are resolved — covered by existing `getNextPhase with blockingParkedIds` test suite
8. [x] Run full test suite — 1221 tests pass, no regressions
