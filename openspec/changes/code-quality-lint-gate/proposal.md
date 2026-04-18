## Why

Agents leave debug artifacts in production code — `console.log` statements, `// TODO` comments, red debug UI text, `.bak` files — that pass all tests but degrade code quality and ship to users. These are caught only when a human reviews the code manually. A lightweight grep-based lint gate can catch these patterns automatically as part of the existing quality pipeline.

## What Changes

- **Add a code quality lint checker**: A new module that runs configurable grep patterns against changed files, detecting debug artifacts, leftover development markers, and code hygiene issues.
- **Project-type-aware lint rules**: Different project types get different default rules. React Native projects check for both JS debug patterns (`console.log` in non-test files) and iOS patterns (debug `print()` in Swift, `#if DEBUG` blocks left open). Web projects check for JS patterns only. Rules use the shared `detectProjectType` from `health-checker.js`.
- **Integration at review and phase gate**: Run lint checks as part of Morgan's review pass (pre-merge) and as part of the phase gate (post-phase). Lint failures in review context are advisory (Morgan flags them); in phase gate context they're logged as warnings.
- **Configurable rules**: Projects can add custom lint rules or disable defaults via `healthCheck.lintRules` in project config.

## Capabilities

### New Capabilities

- `code-quality-lint-gate`: Grep-based code quality checks that detect debug artifacts, development markers, and hygiene issues with project-type-aware default rules

### Modified Capabilities

- `integration-quality-gates`: Add lint gate as an additional quality checkpoint at review and phase gate stages

## Impact

- `platform/orchestrator/src/quality/lint-checker.js` — new module with configurable grep-based lint rules
- `platform/orchestrator/src/quality/lint-checker.test.js` — tests for lint detection
- `platform/orchestrator/src/quality/health-gate.js` — integrate lint checks into phase gate
- `templates/agents/principal-engineer/` — add lint check instructions to Morgan's review prompt
- Default rules detect: `console.log` (non-test JS/TS), `print()` (non-test Swift), `.bak` files, `// TODO` and `// HACK` comments, inline debug UI (e.g. `DEBUG:` text in JSX), `debugger` statements
