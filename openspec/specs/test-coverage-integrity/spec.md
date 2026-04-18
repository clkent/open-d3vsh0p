# Test Coverage Integrity

## Purpose
Ensures every source file in the DevShop orchestrator has meaningful, behavior-verifying tests. Establishes guardrails that prevent agents from writing trivially-passing tests that game coverage metrics without actually validating code behavior. Prioritizes coverage by module criticality and provides a dedicated test strategy for the 1,362-line parallel-orchestrator.js.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/**/*.js` — all source files requiring test coverage
- `platform/orchestrator/src/**/*.test.js` — all test files subject to integrity rules
- `.githooks/pre-commit` — enhanced to verify test file existence for new source files

## Requirements

### Coverage Targets
Every source file in `platform/orchestrator/src/` SHALL have a corresponding `.test.js` file co-located in the same directory. Coverage SHALL be implemented in priority order based on module criticality and risk.

#### Scenario: P0 — parallel-orchestrator.js
- **GIVEN** the file `platform/orchestrator/src/parallel-orchestrator.js` (1,362 lines, the orchestration brain)
- **WHEN** test coverage is assessed
- **THEN** it SHALL have a comprehensive `parallel-orchestrator.test.js` covering state transitions, error paths, and parking/salvage logic as described in the Parallel Orchestrator Test Strategy requirement

#### Scenario: P1 — Command files
- **GIVEN** the command files in `platform/orchestrator/src/commands/`
- **WHEN** test coverage is assessed
- **THEN** each command file SHALL have a corresponding `.test.js` file: `run.test.js`, `kickoff.test.js`, `talk.test.js`, `schedule.test.js`, `status.test.js`, `cadence.test.js`, `watch.test.js`, `report.test.js`

#### Scenario: P2 — Core utilities
- **GIVEN** the core utility files: `exec-utils.js`, `logger.js`, `health-gate.js`, `registry.js`, `session-utils.js`, `session-aggregator.js`, `path-utils.js`
- **WHEN** test coverage is assessed
- **THEN** each SHALL have a corresponding `.test.js` file testing all exported functions/methods

#### Scenario: P3 — Scheduler modules
- **GIVEN** the scheduler files: `launchd.js`, `plist-template.js`, `window-config.js`
- **WHEN** test coverage is assessed
- **THEN** each SHALL have a corresponding `.test.js` file

#### Scenario: P4 — Remaining modules
- **GIVEN** the remaining untested files: `github-notifier.js`, `tech-debt-runner.js`
- **WHEN** test coverage is assessed
- **THEN** each SHALL have a corresponding `.test.js` file

#### Scenario: New source file requires test file
- **WHEN** a new `.js` source file (not a test file) is added to `platform/orchestrator/src/`
- **THEN** a corresponding `.test.js` file SHALL be created in the same commit or PR

### Test Integrity Rules
Tests SHALL contain meaningful assertions that verify actual code behavior. Trivially-passing tests, assertion-free tests, and tests that assert on hardcoded values rather than code output are prohibited. When a test fails, the implementation SHALL be fixed — NOT the test assertion weakened.

#### Scenario: Every it() block contains assertions
- **GIVEN** any test file in the project
- **WHEN** its `it()` blocks are inspected
- **THEN** every `it()` block SHALL contain at least one `assert.*` call — empty test bodies are prohibited

#### Scenario: No trivial assertions
- **GIVEN** an `it()` block in a test file
- **WHEN** its assertions are inspected
- **THEN** it SHALL NOT contain `assert.ok(true)`, `assert.equal(1, 1)`, `assert.strictEqual('a', 'a')`, or any assertion where both sides are hardcoded literals unrelated to the code under test

#### Scenario: Assertions reference code under test
- **GIVEN** an `it()` block testing a module
- **WHEN** its assertions are inspected
- **THEN** at least one assertion SHALL reference a value produced by calling the module's actual exports (functions, methods, or class instances)

#### Scenario: Mock assertions verify arguments
- **GIVEN** a test that sets up mock functions
- **WHEN** mock behavior is asserted
- **THEN** the test SHALL verify mocks were called with specific expected arguments (e.g., `assert.deepEqual(mock.calls[0].arguments, [expected])`) — not just that the mock was called at all

#### Scenario: Tests exercise actual exports
- **GIVEN** a test file for module `foo-bar.js`
- **WHEN** the test is inspected
- **THEN** it SHALL `require('./foo-bar')` and test the actual exported functions/classes — not reimplementations or copies of the logic

#### Scenario: Failing test triggers implementation fix
- **WHEN** a test fails during development
- **THEN** the developer/agent SHALL fix the implementation code to satisfy the test — NOT weaken the assertion, increase tolerance, or change expected values to match broken output

#### Scenario: Prohibited test patterns
- **GIVEN** any test file
- **WHEN** its contents are inspected
- **THEN** it SHALL NOT contain:
  - Empty `it()` bodies (no statements between braces)
  - Commented-out assertions (`// assert.equal(...)`)
  - `assert.ok(result)` as the sole assertion without checking the result's shape or value
  - `assert.ok(typeof result !== 'undefined')` as a substitute for value checking
  - `it.skip()` or `it.todo()` counted as passing coverage

### Test Quality Standards
Tests SHALL follow structural patterns that ensure thorough behavior verification: multiple scenarios per function, proper object comparison, error path testing, descriptive names, and test isolation.

#### Scenario: Minimum test scenarios per function
- **GIVEN** a public method or exported function
- **WHEN** its test coverage is assessed
- **THEN** it SHALL have at minimum: one happy-path test, one edge-case test, and one error-case test (where applicable — pure functions without error paths may omit error cases)

#### Scenario: Object comparison with deepEqual
- **GIVEN** a test that asserts on an object or array return value
- **WHEN** the assertion is inspected
- **THEN** it SHALL use `assert.deepEqual()` or `assert.deepStrictEqual()` to verify the full structure — NOT `assert.ok(obj)` or `assert.equal(obj.oneField, expected)`

#### Scenario: Error path testing with assert.throws
- **GIVEN** a function that throws errors under certain conditions
- **WHEN** its error behavior is tested
- **THEN** the test SHALL use `assert.throws()` with a matcher for the error message or type — NOT a try/catch with `assert.ok(caught)`

#### Scenario: Descriptive test names
- **GIVEN** an `it()` block
- **WHEN** its description string is inspected
- **THEN** it SHALL describe the expected behavior in plain English (e.g., `'returns empty array when no sessions exist'`, `'throws when project directory is missing'`) — NOT generic names like `'test1'`, `'works'`, or `'should work correctly'`

#### Scenario: Test isolation
- **GIVEN** a `describe()` block with multiple `it()` blocks
- **WHEN** the tests are inspected for shared state
- **THEN** no mutable state SHALL be shared between `it()` blocks — each test SHALL set up its own state in the test body or in `beforeEach` hooks

#### Scenario: No test interdependence
- **GIVEN** a test suite
- **WHEN** any single `it()` block is run in isolation
- **THEN** it SHALL pass or fail independently of whether other tests in the suite ran before it

### Parallel Orchestrator Test Strategy
The `parallel-orchestrator.js` file (1,362 lines) SHALL be tested through dependency injection of all external collaborators, with coverage of state transitions, error paths, and salvage logic.

#### Scenario: Dependency injection for testability
- **GIVEN** the ParallelOrchestrator class
- **WHEN** tests instantiate it
- **THEN** all external dependencies (GitOps, AgentRunner, Logger, ConsumptionMonitor, ReviewParser, HealthGate, etc.) SHALL be injected as constructor parameters or method parameters, enabling mock substitution without monkey-patching globals

#### Scenario: Method-level isolation
- **GIVEN** the public and significant private methods of ParallelOrchestrator
- **WHEN** tests are written
- **THEN** each method SHALL be tested in isolation with mocked collaborators, not only through end-to-end orchestration runs

#### Scenario: State transition coverage
- **GIVEN** the orchestrator's phase/group lifecycle (pending → in_progress → completed/parked)
- **WHEN** state transition tests are written
- **THEN** they SHALL cover: successful phase completion, group concurrency within a phase, phase dependency ordering, and multi-phase sequential execution

#### Scenario: Error path coverage
- **GIVEN** the orchestrator handles various failure modes
- **WHEN** error path tests are written
- **THEN** they SHALL cover: merge conflict during consolidation, agent crash mid-implementation, agent context overflow, budget exhaustion mid-phase, review failure exceeding max retries, and health gate failure

#### Scenario: Parking and salvage logic
- **GIVEN** the orchestrator parks work items and salvages partial progress
- **WHEN** parking/salvage tests are written
- **THEN** they SHALL verify: items are parked with descriptive reasons, salvageable work (tests pass + commits exist) is retained, non-salvageable work is cleanly abandoned, and parking updates the roadmap when applicable

#### Scenario: Mock all external processes
- **GIVEN** ParallelOrchestrator spawns Claude CLI agents and runs git operations
- **WHEN** tests mock these operations
- **THEN** no test SHALL spawn a real process, touch the filesystem (except temp dirs), or make network calls — all external interactions SHALL be mocked

### Pre-Commit Hook Enhancement
The existing `.githooks/pre-commit` hook SHALL be enhanced to verify that new source files have corresponding test files. This check runs alongside the existing `npm test` execution.

#### Scenario: New source file without test file blocks commit
- **GIVEN** a commit that adds `platform/orchestrator/src/new-module.js`
- **WHEN** the pre-commit hook runs
- **AND** `platform/orchestrator/src/new-module.test.js` does not exist
- **THEN** the commit SHALL be blocked with a message: "Missing test file for new-module.js — create new-module.test.js"

#### Scenario: New source file with test file passes
- **GIVEN** a commit that adds both `platform/orchestrator/src/new-module.js` and `platform/orchestrator/src/new-module.test.js`
- **WHEN** the pre-commit hook runs
- **THEN** the test file existence check SHALL pass

#### Scenario: Existing source files without tests are not blocked
- **GIVEN** a commit that modifies an existing source file that predates this requirement
- **WHEN** the pre-commit hook runs
- **THEN** the test file existence check SHALL only apply to newly added files (git status `A`), not modified files (`M`)

#### Scenario: Non-source files are excluded
- **GIVEN** a commit that adds files outside `platform/orchestrator/src/` (e.g., specs, docs, templates)
- **WHEN** the pre-commit hook runs
- **THEN** the test file existence check SHALL not apply to those files

#### Scenario: Test files themselves are excluded
- **GIVEN** a commit that adds a new `.test.js` file without a corresponding source file (e.g., integration tests)
- **WHEN** the pre-commit hook runs
- **THEN** the check SHALL not require a "source file for the test file" — the check is one-directional (source → test)
