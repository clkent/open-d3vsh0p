## 1. Reader

- [x] 1.1 `getActionablePhaseNumbers` ignores pending items in Group Z when judging dependency satisfaction; unresolvable dependencies still block
- [x] 1.2 Tests: Group Z checkpoint does not block, non-Group-Z HUMAN item blocks, Group Z in the evaluated phase itself is unaffected

## 2. Consumers and Docs

- [x] 2.1 Full suite passes (run gate and action resolver pick up the change without code edits)
- [x] 2.2 README continuation wording mentions the Group Z exception; roadmap entry under Phase XVIII Group B
