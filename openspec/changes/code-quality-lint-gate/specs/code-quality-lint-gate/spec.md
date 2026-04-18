## ADDED Requirements

### Requirement: Grep-based lint checker
The system SHALL provide a `lint-checker.js` module that runs configurable regex patterns against changed files to detect debug artifacts and development markers.

#### Scenario: Lint check with no violations
- **WHEN** `runLintCheck` is called with changed files that contain no matching patterns
- **THEN** it SHALL return `{ passed: true, violations: [] }`

#### Scenario: Lint check with violations found
- **WHEN** `runLintCheck` is called with files containing `console.log` in production code
- **THEN** it SHALL return `{ passed: false, violations: [{ rule: 'no-console-log', file, line, match }] }`

#### Scenario: Lint check scoped to changed files only
- **WHEN** `runLintCheck` is called with a list of changed files
- **THEN** it SHALL only check those files, not the entire codebase

### Requirement: Project-type-aware default rules
The lint checker SHALL select default rules based on the project type returned by `detectProjectType` from `health-checker.js`.

#### Scenario: Universal rules apply to all projects
- **WHEN** any project type is detected
- **THEN** the following rules SHALL be active by default: `no-debugger` (JS/TS), `no-bak-files`, `no-todo-hack`

#### Scenario: JS/TS rules for web and React Native projects
- **WHEN** project type is `web`, `react-native`, or `node`
- **THEN** the following additional rules SHALL be active: `no-console-log` (excluding test files), `no-debug-ui` (JSX/TSX only)

#### Scenario: Swift rules for iOS projects
- **WHEN** `detectProjectType` returns `platforms.ios: true`
- **THEN** the `no-swift-print` rule SHALL be active (excluding test files)

#### Scenario: Kotlin/Java rules for Android projects
- **WHEN** `detectProjectType` returns `platforms.android: true`
- **THEN** the `no-android-log` rule SHALL be active (excluding test files)

### Requirement: Test file exclusion
Lint rules that target debug patterns SHALL exclude test files, since debug logging in tests is legitimate.

#### Scenario: Console.log in test file not flagged
- **WHEN** a file matching `*.test.{js,ts,jsx,tsx}` or `*.spec.{js,ts,jsx,tsx}` contains `console.log`
- **THEN** `no-console-log` rule SHALL NOT produce a violation

#### Scenario: Console.log in production file flagged
- **WHEN** a file matching `*.{js,ts,jsx,tsx}` (not test/spec) contains `console.log`
- **THEN** `no-console-log` rule SHALL produce a violation

### Requirement: Configurable lint rules
Projects SHALL be able to customize lint rules via `healthCheck.lintRules` in project config.

#### Scenario: Disable a default rule
- **WHEN** project config has `healthCheck.lintRules.disable: ['no-todo-hack']`
- **THEN** the `no-todo-hack` rule SHALL not run

#### Scenario: Add a custom rule
- **WHEN** project config has `healthCheck.lintRules.custom: [{ id: 'no-fixme', pattern: 'FIXME', glob: '*.ts' }]`
- **THEN** the `no-fixme` rule SHALL run against matching files in addition to defaults

### Requirement: Lint integration at review stage
Lint violations SHALL be available to Morgan during code review as advisory findings.

#### Scenario: Lint violations included in review context
- **WHEN** Morgan reviews a merge request and lint violations exist in changed files
- **THEN** the review context SHALL include the lint violations as advisory findings that Morgan MAY flag in the review

### Requirement: Lint integration at phase gate
Lint violations SHALL be logged as warnings during the phase gate check.

#### Scenario: Phase gate logs lint warnings
- **WHEN** the phase gate runs and lint violations exist
- **THEN** the violations SHALL be logged at `warn` level with rule, file, and line details
- **AND** the phase gate SHALL NOT fail solely due to lint violations (build/test failures are still the blocking criteria)
