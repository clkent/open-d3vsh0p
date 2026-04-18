# Consumption Monitoring

## Purpose
Tracks resource usage across three dimensions -- budget (USD), wall-clock time, and agent invocations -- so the orchestrator can enforce hard limits and warn operators before limits are reached. Also provides per-cycle cost tracking for microcycle-level accounting and state persistence for session resume.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/consumption-monitor.js` -- ConsumptionMonitor class with gauges, thresholds, and persistence

## Requirements

### Three Resource Gauges
The system SHALL enforce three independent resource gauges: budget in USD (default $30), wall-clock time in milliseconds (default 25,200,000 ms / 7 hours), and agent invocations (default 50). Each gauge SHALL be configurable via the constructor's `config` parameter (`budgetLimitUsd`, `timeLimitMs`, `maxAgentInvocations`).

#### Scenario: Default gauge values when no config overrides provided
- **WHEN** a ConsumptionMonitor is constructed with an empty config `{}`
- **THEN** budgetLimitUsd SHALL be 20, timeLimitMs SHALL be 25,200,000, and maxAgentInvocations SHALL be 50

#### Scenario: Custom gauge values from config
- **WHEN** a ConsumptionMonitor is constructed with `{ budgetLimitUsd: 10, timeLimitMs: 3600000, maxAgentInvocations: 25 }`
- **THEN** the monitor SHALL use those values as the respective limits

#### Scenario: Initial state restoration on resume
- **WHEN** a ConsumptionMonitor is constructed with an `initialState` containing `totalCostUsd: 5`, `totalDurationMs: 1000`, and `agentInvocations: 3`
- **THEN** the monitor SHALL resume accumulation from those values rather than zero

### Stop Check
The system SHALL provide a `shouldStop()` method that returns an object `{ stop: boolean, reason?: string }`. It SHALL be checked before each orchestrator state transition.

#### Scenario: Budget exhausted
- **WHEN** `totalCostUsd` is greater than or equal to `budgetLimitUsd`
- **THEN** shouldStop() SHALL return `{ stop: true, reason: 'budget_exhausted' }`

#### Scenario: Time limit reached
- **WHEN** the elapsed time since `sessionStartTime` is greater than or equal to `timeLimitMs`
- **THEN** shouldStop() SHALL return `{ stop: true, reason: 'time_limit' }`

#### Scenario: Invocation limit reached
- **WHEN** `agentInvocations` is greater than or equal to `maxAgentInvocations`
- **THEN** shouldStop() SHALL return `{ stop: true, reason: 'invocation_limit' }`

#### Scenario: All gauges within limits
- **WHEN** totalCostUsd is below budgetLimitUsd, elapsed time is below timeLimitMs, and agentInvocations is below maxAgentInvocations
- **THEN** shouldStop() SHALL return `{ stop: false }` with no reason property

### Warning Threshold
The system SHALL provide a `shouldWarn()` method that returns true when the budget gauge reaches or exceeds the warning threshold percentage. The default warning threshold SHALL be 80%.

#### Scenario: Below warning threshold
- **WHEN** totalCostUsd is $15.99 and budgetLimitUsd is $20.00 (79.95%)
- **THEN** shouldWarn() SHALL return false

#### Scenario: At warning threshold
- **WHEN** totalCostUsd is $16.00 and budgetLimitUsd is $20.00 (80%)
- **THEN** shouldWarn() SHALL return true

#### Scenario: Custom warning threshold
- **WHEN** `warningThresholdPct` is set to 90 and cost is at 85% of budget
- **THEN** shouldWarn() SHALL return false

### Invocation Recording
The system SHALL provide a `recordInvocation(costUsd, durationMs)` method that accumulates cost, duration, and invocation count. Each call SHALL increment `agentInvocations` by 1, add `costUsd` to `totalCostUsd`, add `durationMs` to `totalDurationMs`, and add `costUsd` to `cycleCostUsd`.

#### Scenario: Recording a successful invocation
- **WHEN** recordInvocation(0.50, 12000) is called
- **THEN** totalCostUsd SHALL increase by 0.50, totalDurationMs SHALL increase by 12000, agentInvocations SHALL increase by 1, and cycleCostUsd SHALL increase by 0.50

#### Scenario: Recording with null/undefined cost
- **WHEN** recordInvocation(null, undefined) is called
- **THEN** totalCostUsd and totalDurationMs SHALL increase by 0 (falsy values coerced to 0), and agentInvocations SHALL still increase by 1

#### Scenario: Multiple invocations accumulate
- **WHEN** recordInvocation(1.00, 5000) is called three times
- **THEN** totalCostUsd SHALL be 3.00, totalDurationMs SHALL be 15000, and agentInvocations SHALL be 3

### Per-Cycle Cost Tracking
The system SHALL provide `resetCycleCost()` and `getCycleCost()` methods for tracking cost within a single orchestrator microcycle. `resetCycleCost()` SHALL return the cycle cost accumulated so far and reset the cycle counter to 0. `getCycleCost()` SHALL return the current cycle cost without resetting.

#### Scenario: Cycle cost accumulation and reset
- **WHEN** two invocations of $0.30 each are recorded, then resetCycleCost() is called
- **THEN** resetCycleCost() SHALL return 0.60 and subsequent getCycleCost() SHALL return 0

#### Scenario: Cycle cost independent of total cost
- **WHEN** resetCycleCost() is called after recording $1.00
- **THEN** totalCostUsd SHALL remain unchanged at $1.00, only cycleCostUsd resets to 0

### State Persistence
The system SHALL provide `getStateForPersistence()` returning `{ totalCostUsd, totalDurationMs, agentInvocations }` for saving session state to disk. It SHALL also provide `getSnapshot()` returning an enriched view with `budgetRemainingUsd`, `budgetUsedPct`, and `elapsedMs` for display and logging.

#### Scenario: Persistence state structure
- **WHEN** getStateForPersistence() is called after recording two invocations totaling $1.50 and 20000ms
- **THEN** the returned object SHALL contain `{ totalCostUsd: 1.5, totalDurationMs: 20000, agentInvocations: 2 }`

#### Scenario: Snapshot with computed fields
- **WHEN** getSnapshot() is called with totalCostUsd at $5.00 and budgetLimitUsd at $20.00
- **THEN** the snapshot SHALL include `budgetRemainingUsd: 15.00`, `budgetUsedPct: "25.0"`, and the current `elapsedMs`

#### Scenario: Snapshot rounds cost to two decimal places
- **WHEN** totalCostUsd is 1.005 from floating-point accumulation
- **THEN** getSnapshot() SHALL return totalCostUsd rounded to 1.01 (via `Math.round(x * 100) / 100`)

### Window End Check
The system SHALL support an optional `windowEndTimeMs` parameter for time-boxed sessions (e.g. night work windows). If set, `shouldStop()` SHALL check whether the current time has passed the window end.

#### Scenario: Window end reached
- **WHEN** `windowEndTimeMs` is set and `Date.now() >= windowEndTimeMs`
- **THEN** shouldStop() SHALL return `{ stop: true, reason: 'window_end' }`

#### Scenario: No window configured
- **WHEN** `windowEndTimeMs` is null (default)
- **THEN** the window check SHALL be skipped

### Graceful Pause Integration
The system SHALL integrate with signal-based pause requests via `requestPause()` and `pauseRequested`. The `user_paused` check SHALL be evaluated FIRST in `shouldStop()`, taking priority over all other stop conditions.

#### Scenario: Pause takes priority over budget
- **WHEN** a pause is requested AND the budget is also exhausted
- **THEN** shouldStop() SHALL return `reason: 'user_paused'` because pause is checked first

### Graceful Shutdown Behavior
The system SHALL evaluate stop conditions in priority order: user pause first, then budget, then time, then invocations, then window end. When any condition triggers a stop, the orchestrator SHALL use the returned reason to determine the shutdown message and log the stop cause.

#### Scenario: Budget check takes priority over time
- **WHEN** both budget and time limits are exceeded simultaneously (and no pause requested)
- **THEN** shouldStop() SHALL return `reason: 'budget_exhausted'` because budget is checked before time

#### Scenario: Session start time defaults to construction time
- **WHEN** no `sessionStartTime` is provided in initialState
- **THEN** the monitor SHALL use `Date.now()` at construction time as the session start
