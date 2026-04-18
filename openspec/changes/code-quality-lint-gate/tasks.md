## Tasks

- [ ] Create `platform/orchestrator/src/quality/lint-checker.js` with `runLintCheck(projectDir, changedFiles, config)` function that runs regex patterns against file contents and returns `{ passed, violations }`. Use `detectProjectType` from `health-checker.js` for project-type-aware default rules
- [ ] Define default lint rules: `no-debugger` (JS/TS `\bdebugger\b`), `no-bak-files` (file existence check), `no-todo-hack` (`//\s*(TODO|HACK|FIXME)`), `no-console-log` (JS/TS non-test), `no-debug-ui` (JSX/TSX `DEBUG:`), `no-swift-print` (Swift non-test), `no-android-log` (Kotlin/Java non-test)
- [ ] Implement test file exclusion logic: skip files matching `*.test.*`, `*.spec.*`, and `__tests__/` directory for debug-pattern rules
- [ ] Add `healthCheck.lintRules` config support: `disable` array to turn off defaults, `custom` array to add project-specific rules
- [ ] Integrate lint check into `runPhaseGate` in `health-gate.js`: run after build/test checks, log violations as warnings (non-blocking)
- [ ] Add lint context to Morgan's review: pass violations as advisory findings in the review prompt when reviewing merge requests
- [ ] Create `platform/orchestrator/src/quality/lint-checker.test.js` with tests for: each default rule detection, test file exclusion, project-type rule selection, custom rule addition, rule disabling, no violations case
- [ ] Add phase gate integration test: lint warnings logged but gate passes when builds/tests pass
