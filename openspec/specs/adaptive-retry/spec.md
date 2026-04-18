# Adaptive Retry

## Purpose
Improves the retry mechanism so agents change strategy when the same approach keeps failing, instead of retrying with slightly different code. The current retry prompt says "fix what's broken" which can lead to the same approach being attempted repeatedly. Adaptive retry explicitly instructs agents to try different strategies on subsequent attempts and injects the full history of what was already tried.

Addresses: **Infinite Loops (#4)**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/microcycle.js` -- Attempt history tracking, `_analyzeFailurePattern()`, enriched parking errors
- `platform/orchestrator/src/openspec-reader.js` -- `buildRetryPrompt` with strategy-shift instructions and attempt history section

## Requirements

### Strategy-Shift Instructions on Retry
The retry prompt SHALL include explicit instructions to change approach when a previous attempt failed, not just fix surface-level issues.

#### Scenario: Second implementation attempt after test failure
- **GIVEN** attempt 1 failed with test errors
- **WHEN** the retry prompt is built for attempt 2
- **THEN** the prompt SHALL include: "Your previous approach didn't work. Before fixing the same code, consider whether a fundamentally different strategy would be more appropriate. If you're retrying the same approach, explain why you believe it will work this time."

#### Scenario: Third implementation attempt (last chance)
- **GIVEN** attempts 1 and 2 both failed
- **WHEN** the retry prompt is built for attempt 3 (the last attempt before parking)
- **THEN** the prompt SHALL include: "This is your final attempt. Previous approaches have failed twice. You MUST try a significantly different strategy. Review the failure history below and identify the root pattern -- don't just tweak the same code."

### Attempt History Tracking
The microcycle SHALL maintain a history of each attempt's approach and failure reason, passing the full history to subsequent attempts.

#### Scenario: History accumulates across attempts
- **GIVEN** attempt 1 failed with "TypeError: Cannot read property 'id' of undefined" and attempt 2 failed with "Test timeout after 5000ms"
- **WHEN** the retry prompt is built for attempt 3
- **THEN** the prompt SHALL include a section:
  ```
  ## Attempt History
  - Attempt 1: TypeError: Cannot read property 'id' of undefined
  - Attempt 2: Test timeout after 5000ms

  These are different failure modes. Identify the underlying pattern.
  ```

#### Scenario: Review feedback history is separate from error history
- **GIVEN** attempt 1 passed tests but Morgan requested changes ("missing error handling on API calls")
- **WHEN** the retry prompt is built for attempt 2
- **THEN** the prompt SHALL include both the review feedback AND an instruction to address the specific issues without introducing new problems

### Failure Pattern Detection
When all retry attempts are exhausted, the parking reason SHALL include a summary of the failure pattern to help future diagnostic agents.

#### Scenario: Consistent failure mode
- **GIVEN** all 3 attempts failed with variations of the same error (e.g., all TypeErrors)
- **WHEN** the requirement is parked
- **THEN** the parking reason SHALL note: "All 3 attempts failed with similar errors (TypeError). This likely indicates a systemic issue rather than an implementation bug."

#### Scenario: Different failure modes each attempt
- **GIVEN** attempt 1 failed with a build error, attempt 2 with a test error, and attempt 3 with a review rejection
- **WHEN** the requirement is parked
- **THEN** the parking reason SHALL note: "Attempts showed different failure modes (build, test, review) -- no consistent pattern."
