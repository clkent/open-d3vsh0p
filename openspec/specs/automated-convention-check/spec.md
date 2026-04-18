# Automated Convention Check

## Purpose
Adds a fast, automated check between implementation and review that verifies the agent used the correct frameworks, test runners, and patterns specified in the project's conventions. Currently, convention compliance is only checked by Morgan during review -- which costs ~$2 per invocation. A simple grep-based pre-check can catch the most common violations (wrong test framework, wrong styling library, wrong ORM) for free before burning a review invocation.

Addresses: **Ignoring Constraints (#6)**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/convention-checker.js` -- ConventionChecker class that parses conventions.md and verifies compliance
- `platform/orchestrator/src/microcycle.js` -- Updated to run convention check before review

## Requirements

### Convention Parsing
The ConventionChecker SHALL parse the project's `openspec/conventions.md` to extract machine-checkable rules. It SHALL look for patterns in the conventions text that can be verified automatically.

#### Scenario: Conventions specify a test framework
- **GIVEN** conventions.md contains "Use Vitest for testing" or "Test framework: Jest"
- **WHEN** the checker parses conventions
- **THEN** it SHALL extract a rule: `{ type: 'test_framework', expected: 'vitest' }` (or 'jest')

#### Scenario: Conventions specify a CSS/styling approach
- **GIVEN** conventions.md contains "Use Tailwind CSS" or "Styling: CSS Modules"
- **WHEN** the checker parses conventions
- **THEN** it SHALL extract a rule: `{ type: 'styling', expected: 'tailwind' }` (or 'css-modules')

#### Scenario: No machine-checkable conventions found
- **GIVEN** conventions.md only contains prose guidelines without specific framework names
- **WHEN** the checker parses conventions
- **THEN** it SHALL return an empty rules array and the check SHALL pass by default

### Automated Compliance Check
After implementation and testing but before review, the microcycle SHALL run a fast compliance check against the changed files.

#### Scenario: Agent used wrong test framework
- **GIVEN** conventions specify Vitest, but the agent wrote tests importing from `@jest/globals` or using `describe` from `jest`
- **WHEN** the convention check runs on the diff
- **THEN** it SHALL return a failure: "Convention violation: tests use Jest but conventions specify Vitest"
- **AND** the microcycle SHALL treat this as a test failure and retry implementation with the violation as error context

#### Scenario: Agent used correct framework
- **GIVEN** conventions specify React with TypeScript, and the agent wrote `.tsx` files importing from `react`
- **WHEN** the convention check runs
- **THEN** it SHALL pass

#### Scenario: Check runs on changed files only
- **WHEN** the convention check runs
- **THEN** it SHALL only examine files in the git diff (not the entire codebase) to keep it fast

### Check Rules

The checker SHALL support these rule types:

| Rule Type | How Checked |
|-----------|-------------|
| `test_framework` | Scan test files for import/require patterns (jest, vitest, mocha, etc.) |
| `styling` | Scan source files for import patterns (tailwind, styled-components, css modules) |
| `orm` | Scan source files for import patterns (prisma, drizzle, typeorm, sequelize) |
| `framework` | Check package.json dependencies for the expected framework |

#### Scenario: Multiple violations in one check
- **GIVEN** the agent used Jest instead of Vitest AND used styled-components instead of Tailwind
- **WHEN** the convention check runs
- **THEN** it SHALL report ALL violations in a single failure message

### Convention Check Cost
The convention check SHALL be a pure code operation (grep + file reads) with zero agent cost. It does not invoke Claude.

#### Scenario: Check speed
- **WHEN** the convention check runs on a typical diff (10-30 files)
- **THEN** it SHALL complete in under 1 second
