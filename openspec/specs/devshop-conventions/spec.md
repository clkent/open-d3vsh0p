# DevShop Conventions

## Purpose
Defines the coding conventions, patterns, and standards that apply to the DevShop platform itself. Ensures consistency across all source files in `platform/orchestrator/` whether authored by humans or agents. These conventions are the DevShop equivalent of the `conventions.md` files DevShop generates for managed projects.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/**/*.js` — all orchestrator source files must follow these conventions
- `platform/orchestrator/src/**/*.test.js` — all test files must follow these conventions
- `.githooks/pre-commit` — enforces test pass before commit
- `.githooks/pre-push` — blocks direct pushes to main

## Requirements

### Test Framework
The platform SHALL use `node:test` (describe/it/mock/beforeEach) as the sole test runner and `node:assert/strict` as the sole assertion library. No external test frameworks, assertion libraries, or test utilities (Jest, Mocha, Chai, Sinon, etc.) SHALL be installed or imported.

#### Scenario: Test file uses correct imports
- **GIVEN** a test file in `platform/orchestrator/src/`
- **WHEN** it imports test utilities
- **THEN** it SHALL only import from `node:test` and `node:assert/strict`

#### Scenario: Test file uses describe/it structure
- **GIVEN** a test file for a module
- **WHEN** tests are organized
- **THEN** they SHALL use `describe()` blocks for grouping and `it()` blocks for individual test cases

#### Scenario: Rejecting external test dependencies
- **WHEN** a change adds a test dependency to `package.json` (devDependencies or dependencies)
- **THEN** the change SHALL be rejected — all test infrastructure comes from Node.js stdlib

### Zero External Dependencies
The platform SHALL have zero external npm dependencies for production code. All functionality SHALL be implemented using Node.js standard library modules only. The `dependencies` field in `package.json` SHALL remain empty or absent.

#### Scenario: No production dependencies
- **GIVEN** the `platform/orchestrator/package.json` file
- **WHEN** the `dependencies` field is inspected
- **THEN** it SHALL be empty `{}` or absent

#### Scenario: Stdlib-only imports in source
- **GIVEN** any source file in `platform/orchestrator/src/`
- **WHEN** its `require()` calls are inspected
- **THEN** every import SHALL resolve to either a Node.js built-in module (e.g., `node:fs`, `node:path`, `node:child_process`) or a relative file path within the project

#### Scenario: New functionality without npm
- **WHEN** new functionality is needed (e.g., HTTP server, file watching, JSON parsing)
- **THEN** it SHALL be implemented using Node.js stdlib modules, not by adding an npm package

### Module Organization
Source files SHALL follow a one-class-per-file or one-concern-per-file organization with kebab-case filenames. All files SHALL use CommonJS (`require`/`module.exports`). Exports SHALL appear at the bottom of the file.

#### Scenario: File naming
- **GIVEN** a new source file is created
- **WHEN** it is named
- **THEN** it SHALL use kebab-case (e.g., `consumption-monitor.js`, `git-ops.js`, `session-utils.js`)

#### Scenario: One class per file
- **GIVEN** a file that exports a class
- **WHEN** its contents are inspected
- **THEN** it SHALL export exactly one class as its primary export

#### Scenario: CommonJS module format
- **GIVEN** any source file in the project
- **WHEN** its module system is inspected
- **THEN** it SHALL use `require()` for imports and `module.exports` for exports — not ES modules (`import`/`export`)

#### Scenario: Exports at bottom
- **GIVEN** a source file with exports
- **WHEN** the file layout is inspected
- **THEN** `module.exports` SHALL appear at the end of the file, after all class/function definitions

### Error Handling
Code SHALL throw descriptive errors with context about what went wrong. Silent catches (empty `catch` blocks or catches that swallow errors without logging) are prohibited. Agent-facing code (code whose errors surface to Claude agents) SHALL log the error before throwing to ensure it appears in session logs.

#### Scenario: Descriptive error messages
- **WHEN** an error is thrown
- **THEN** the error message SHALL describe what went wrong and include relevant context (e.g., file path, project ID, phase name)

#### Scenario: No silent catches
- **GIVEN** a `try/catch` block in any source file
- **WHEN** the `catch` block is inspected
- **THEN** it SHALL either rethrow, log the error, or handle it meaningfully — never silently swallow it with an empty block

#### Scenario: Agent-facing error logging
- **GIVEN** code in the orchestrator that spawns or communicates with agents
- **WHEN** an error occurs that will surface as an agent failure
- **THEN** the error SHALL be logged (via Logger) before being thrown or propagated

### Mock Patterns
Tests SHALL use the `node:test` mock module (`mock.fn()`, `mock.method()`) for all mocking needs. Mocks SHALL be applied at module boundaries (filesystem, child_process, network calls) not on internal functions. Mock assertions SHALL validate behavior — verifying call arguments and call counts, not merely that a mock exists.

#### Scenario: Mocking filesystem operations
- **GIVEN** a test for a module that reads/writes files
- **WHEN** mocks are set up
- **THEN** `fs.readFileSync`, `fs.writeFileSync`, etc. SHALL be mocked using `mock.method(fs, 'readFileSync', ...)`

#### Scenario: Mocking child_process
- **GIVEN** a test for a module that spawns processes (e.g., git, claude)
- **WHEN** mocks are set up
- **THEN** `child_process.execSync` or `child_process.spawn` SHALL be mocked, not the module's internal wrapper functions

#### Scenario: Mock assertions validate arguments
- **GIVEN** a test that mocks a function
- **WHEN** assertions are written for the mock
- **THEN** they SHALL verify the mock was called with specific expected arguments using `mock.calls[n].arguments`, not just `assert.ok(mockFn.mock.calls.length > 0)`

#### Scenario: Mock cleanup
- **GIVEN** a test suite with mocks
- **WHEN** the suite structure is inspected
- **THEN** mocks SHALL be restored in `afterEach` or `after` blocks, or use `mock.reset()` to prevent leakage between tests

### Git Hooks
The project SHALL use `.githooks/pre-commit` to run the test suite on orchestrator changes and `.githooks/pre-push` to block direct pushes to `main`. All development work SHALL flow through feature branches and pull requests per the workflow in `CLAUDE.md`.

#### Scenario: Pre-commit runs tests
- **GIVEN** a developer (or agent) commits changes to files under `platform/orchestrator/`
- **WHEN** the pre-commit hook fires
- **THEN** it SHALL run `npm test` in the orchestrator directory and block the commit if tests fail

#### Scenario: Pre-push blocks main
- **GIVEN** a push to the `main` branch is attempted
- **WHEN** the pre-push hook fires
- **THEN** it SHALL reject the push with a message directing the user to create a PR instead

#### Scenario: Feature branch workflow
- **WHEN** any change is made to the platform
- **THEN** it SHALL be on a feature branch with a type prefix (feat/, fix/, chore/, docs/, refactor/, test/) and merged via pull request

### Naming Conventions
The project SHALL use consistent naming across all source and test files: camelCase for variables and functions, PascalCase for class names, and UPPER_SNAKE_CASE for constants. Test files SHALL be named `<module>.test.js` and co-located with their source file in the same directory.

#### Scenario: Variable and function naming
- **GIVEN** any source file
- **WHEN** variable and function names are inspected
- **THEN** they SHALL use camelCase (e.g., `sessionId`, `parseRoadmap`, `getAgentConfig`)

#### Scenario: Class naming
- **GIVEN** a file that defines a class
- **WHEN** the class name is inspected
- **THEN** it SHALL use PascalCase (e.g., `ConsumptionMonitor`, `ParallelOrchestrator`, `GitOps`)

#### Scenario: Constant naming
- **GIVEN** a module-level constant (a value that never changes at runtime)
- **WHEN** its name is inspected
- **THEN** it SHALL use UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `DEFAULT_BUDGET_USD`, `PHASE_REGEX`)

#### Scenario: Test file co-location
- **GIVEN** a source file `platform/orchestrator/src/foo-bar.js`
- **WHEN** its test file is located
- **THEN** it SHALL be at `platform/orchestrator/src/foo-bar.test.js` in the same directory
