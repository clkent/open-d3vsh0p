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
- Coverage priority: P1 commands, P2 core utils, P3 scheduler, P4 remaining
- Test integrity: every `it()` has assertions, no trivial assertions, assertions reference code under test
- Prohibited: empty test bodies, `assert.ok(true)`, commented-out assertions, weakening assertions to pass
- Mock assertions verify call arguments, not just call existence
- Tests exercise actual module exports, not reimplementations
- Failing tests → fix implementation, never weaken the assertion
- Quality: happy path + edge case + error case per function, descriptive names, test isolation
- Pre-commit hook enhanced to require test files for new source files

### REST API

- HTTP endpoints for project management, session control, status queries
- Authentication and authorization for API access

### Token Estimation

- Token-based session estimator replacing the removed dollar-based CostEstimator (stub at `platform/orchestrator/src/session/token-estimator.js`)
- Estimates in tokens, not dollars — clearer and model-price independent
- Data source: Claude Code session usage/transcripts (orchestrator-written summaries no longer exist)
- Re-enables: pre-run estimate in `run`, remaining-work estimate in `status`, and the disabled monthly cadence review

### Remote Operation

- Remote Control on every interactive session (`remoteControl.enabled` / `--remote-control`) so Riley and Morgan sessions appear in the Claude app, named per agent and project
- `devshop remote` control server: **deferred** (2026-09-08) — a phone-driven launcher was built and closed unmerged; revisit only with the control directory outside the repo and no pre-approved Bash rules
- Machine-level `config.local.json` overlay merged between defaults and per-project overrides
