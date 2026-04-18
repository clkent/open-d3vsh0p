# d3vsh0p Agent Platform

## Overview

d3vsh0p is an agent orchestration platform that spawns Claude Agent SDK agents to build software projects autonomously. It uses OpenSpec for spec-driven development, manages multiple concurrent projects in isolated repositories, and provides structured cycles for implementation, review, and maintenance.

## Tech Stack

- Node.js (v24+), zero external dependencies (stdlib only)
- Claude Agent SDK for agent execution
- OpenSpec for requirements and change management
- Git for version control and branch-based workflows

## Specs

Comprehensive capability specs are in `openspec/specs/<capability>/spec.md`.
The roadmap at `openspec/roadmap.md` tracks completion status across all phases.

## Requirements

_Only pending (unimplemented) requirements are listed here. See `openspec/specs/` for complete specs including implemented capabilities._

### Codebase Grounding

- Pre-scan key project files (package.json, entry points, existing tests, config) before each implementation
- Inject scanned file contents into implementation prompt under "Existing Code Context"
- Keyword-match requirement bullets to discover relevant existing source files
- Truncate large files (first 100 + last 50 lines) and enforce 8000-char context budget
- Add codebase-grounding.md shared partial to all implementation agents

### Risk Preflight

- Lightweight read-only planning step before first implementation attempt
- Agent outputs brief plan: files to modify, files to read, risks, approach
- Plan is passed into the implementation prompt as context
- Capped at $0.50 budget, 60-second timeout, no write/edit tools
- Skipped on retry attempts (agent already has error context)

### Adaptive Retry

- Strategy-shift instructions on retry: "try a different approach" not just "fix what's broken"
- Escalating urgency on final attempt: "This is your last chance, fundamentally change strategy"
- Track full attempt history (approach + failure reason) and pass to subsequent attempts
- Failure pattern summary in parking reason (consistent vs. varied failure modes)

### Parallel Agent Coordination

- Inject peer context into parallel agents: what other agents are building simultaneously
- Identify likely shared files based on keyword overlap in requirement bullets
- Make phaseContext (already-merged requirements) available to implementation agents, not just Morgan
- Add parallel-awareness.md shared partial with conflict-avoidance guidance

### Automated Convention Check

- Parse conventions.md to extract machine-checkable rules (test framework, styling, ORM, framework)
- Run zero-cost grep-based compliance check on changed files after implementation
- Treat violations as implementation failures with clear error messages
- Runs before Morgan's review to avoid wasting a $2 review invocation on convention violations

### Import Verification

- Extract all import/require statements from changed files
- Verify relative imports resolve to real files (with extension inference)
- Skip third-party package imports (handled by npm)
- Run before tests for clearer error messages than "module not found"
- Zero agent cost, under 500ms execution time

### Context Refresh

- Periodic re-injection of key context during long interactive sessions (talk, plan, pair)
- Refresh every 5 turns (configurable) with persona, project, and condensed conventions
- Prevents context rot from accumulated conversation history pushing out instructions

### DevShop Conventions

- Test framework: `node:test` (describe/it/mock/beforeEach) + `node:assert/strict`, no external test libs
- Zero external dependencies: stdlib only, no npm packages for production code
- Module organization: one class per file, kebab-case filenames, CommonJS, exports at bottom
- Error handling: descriptive errors, no silent catches, log before throwing for agent-facing code
- Mock patterns: `node:test` mock module, mock at boundaries, validate call arguments not just existence
- Git hooks: pre-commit runs tests, pre-push blocks main, all work via feature branches + PRs
- Naming: camelCase vars/functions, PascalCase classes, UPPER_SNAKE constants, `<module>.test.js` co-located

### Test Coverage Integrity

- Every source file in `platform/orchestrator/src/` shall have a corresponding `.test.js` file
- Coverage priority: P0 parallel-orchestrator, P1 commands, P2 core utils, P3 scheduler, P4 remaining
- Test integrity: every `it()` has assertions, no trivial assertions, assertions reference code under test
- Prohibited: empty test bodies, `assert.ok(true)`, commented-out assertions, weakening assertions to pass
- Mock assertions verify call arguments, not just call existence
- Tests exercise actual module exports, not reimplementations
- Failing tests → fix implementation, never weaken the assertion
- Quality: happy path + edge case + error case per function, descriptive names, test isolation
- parallel-orchestrator.js: dependency injection, method isolation, state transitions, error paths, parking/salvage
- Pre-commit hook enhanced to require test files for new source files

### REST API

- HTTP endpoints for project management, session control, status queries
- Authentication and authorization for API access

### Realtime Updates

- WebSocket server for live agent activity streaming
- Web dashboard for project monitoring
