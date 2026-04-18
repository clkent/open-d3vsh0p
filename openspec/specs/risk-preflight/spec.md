# Risk Preflight

## Purpose
Adds a lightweight pre-implementation planning step where agents must reason about their approach before writing code. The agent outputs a brief plan that identifies files to modify, potential risks, and integration concerns. This catches bad approaches early -- before burning $5 of agent budget on the wrong strategy.

Addresses: **No Risk Assessment (#1)**, **Overconfidence (#3)**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/microcycle.js` -- Updated to run preflight step before `_implement`
- `platform/orchestrator/src/openspec-reader.js` -- New `buildPreflightPrompt` method
- `templates/agents/_shared/risk-preflight.md` -- Instructions for the preflight step

## Requirements

### Preflight Step in Microcycle
The microcycle SHALL run a brief preflight step before the first implementation attempt of each requirement. The preflight is a short agent invocation (low budget, short timeout) that asks the agent to plan before coding.

#### Scenario: Preflight runs before first implementation
- **GIVEN** a new requirement "user-authentication" entering the microcycle
- **WHEN** the microcycle starts attempt 1
- **THEN** the orchestrator SHALL invoke a preflight prompt before the implementation prompt
- **AND** the preflight SHALL use the same agent persona assigned to the requirement

#### Scenario: Preflight is skipped on retry attempts
- **GIVEN** an implementation that failed tests and is being retried
- **WHEN** the microcycle starts attempt 2+
- **THEN** the preflight step SHALL be skipped (the agent already has context from the error)

#### Scenario: Preflight budget is capped
- **WHEN** the preflight agent is invoked
- **THEN** it SHALL use a max budget of $0.50 and a timeout of 60 seconds
- **AND** it SHALL NOT have access to Write or Edit tools (read-only)

### Preflight Prompt Content
The preflight prompt SHALL ask the agent to output a structured plan:

```
Before implementing, analyze the requirement and output a brief plan:

1. **Files to modify/create** -- List specific file paths
2. **Files to read first** -- What existing code do you need to understand?
3. **Risks** -- What could go wrong? (dependencies, breaking changes, edge cases)
4. **Approach** -- 2-3 sentence description of your implementation strategy

Keep this brief (under 200 words). This is thinking time, not implementation time.
```

#### Scenario: Preflight output is passed to implementation
- **WHEN** the preflight agent returns a plan
- **THEN** the plan text SHALL be included in the implementation prompt under a section `## Your Pre-Implementation Plan`
- **AND** the implementation prompt SHALL include: "Follow the plan above. If you discover the plan was wrong, adjust -- but explain why."

#### Scenario: Preflight failure is non-fatal
- **WHEN** the preflight agent fails (timeout, error, or empty output)
- **THEN** the microcycle SHALL proceed to implementation without a plan
- **AND** the failure SHALL be logged as a warning

### Preflight Cost Tracking
The preflight cost SHALL be included in the microcycle's total cost accounting.

#### Scenario: Preflight cost added to requirement total
- **GIVEN** a preflight that costs $0.15 and an implementation that costs $2.00
- **WHEN** the requirement completes
- **THEN** the total cost reported SHALL be $2.15
