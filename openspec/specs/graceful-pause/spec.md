# Graceful Pause

## Purpose
Allows operators to pause the orchestrator cleanly mid-session using Ctrl+C (SIGINT) or SIGTERM, finishing the current work item before stopping. A second signal force-exits immediately.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/consumption-monitor.js` — signal handler installation/removal, pause flag, `shouldStop()` integration
- `platform/orchestrator/src/parallel-orchestrator.js` — installs signal handlers before phase loop, removes after
- `platform/orchestrator/src/orchestrator.js` — installs signal handlers before main loop, removes after

## Requirements

### Signal Handler Installation
The ConsumptionMonitor SHALL provide `installSignalHandlers()` and `removeSignalHandlers()` methods for registering and cleaning up SIGINT and SIGTERM handlers.

Signal handlers SHALL be installed before the main phase/microcycle loop and removed after it completes.

#### Scenario: Installing signal handlers
- **WHEN** `installSignalHandlers()` is called
- **THEN** the monitor SHALL register handlers for both SIGINT and SIGTERM
- **AND** subsequent signals SHALL set the pause flag instead of killing the process

#### Scenario: Double-install prevention
- **WHEN** `installSignalHandlers()` is called while handlers are already installed
- **THEN** the method SHALL return immediately without registering duplicate handlers

#### Scenario: Removing signal handlers
- **WHEN** `removeSignalHandlers()` is called after handlers were installed
- **THEN** both SIGINT and SIGTERM handlers SHALL be removed, restoring default signal behavior

#### Scenario: Remove without install
- **WHEN** `removeSignalHandlers()` is called but no handlers were installed
- **THEN** the method SHALL return immediately without error

### First Signal — Graceful Pause
The first SIGINT or SIGTERM SHALL set a pause flag that causes `shouldStop()` to return `{ stop: true, reason: 'user_paused' }` at the next check point.

The orchestrator checks `shouldStop()` between items and between phases, so the current item finishes before the session stops.

A programmatic pause via `requestPause()` SHALL behave identically to a signal-triggered pause, except the reason MAY differ (e.g., `blocking_park` instead of `user_paused`).

#### Scenario: First Ctrl+C during execution
- **WHEN** the operator presses Ctrl+C (SIGINT) for the first time during a session
- **THEN** `_pauseRequested` SHALL be set to true
- **AND** the console SHALL display "Pause requested — finishing current work, then stopping cleanly."
- **AND** the current item SHALL continue to completion

#### Scenario: shouldStop returns user_paused
- **WHEN** `shouldStop()` is called after a signal-triggered pause
- **THEN** it SHALL return `{ stop: true, reason: 'user_paused' }`

#### Scenario: shouldStop returns blocking_park
- **WHEN** `shouldStop()` is called after a `requestPause({ reason: 'blocking_park' })` call
- **THEN** it SHALL return `{ stop: true, reason: 'blocking_park', blockingItem: { id, error } }`

#### Scenario: user_paused takes priority over budget
- **WHEN** a pause is requested AND the budget is also exhausted
- **THEN** `shouldStop()` SHALL return `reason: 'user_paused'` because the pause check is evaluated first

### Second Signal — Force Exit
The second SIGINT or SIGTERM SHALL force-exit the process immediately with exit code 1.

#### Scenario: Second Ctrl+C
- **WHEN** Ctrl+C is pressed a second time while the pause flag is already set
- **THEN** the process SHALL display "Force stopping — work in progress may be lost." and call `process.exit(1)`

### Blocking Park Pause Reason
The `requestPause()` method SHALL accept an optional `reason` parameter that is stored alongside the pause flag. When called with `reason: 'blocking_park'` and a `blockingItem` object, the monitor SHALL store both for retrieval by `shouldStop()`.

#### Scenario: Pause with blocking_park reason
- **WHEN** `requestPause({ reason: 'blocking_park', blockingItem: { id, error } })` is called
- **THEN** `pauseRequested` SHALL return true
- **AND** `shouldStop()` SHALL return `{ stop: true, reason: 'blocking_park', blockingItem: { id, error } }`

#### Scenario: Pause without reason (backward compatible)
- **WHEN** `requestPause()` is called without arguments
- **THEN** `shouldStop()` SHALL return `{ stop: true, reason: 'user_paused' }` as before

#### Scenario: Blocking park reason distinguishes from user pause
- **WHEN** the orchestrator receives `shouldStop()` result with `reason: 'blocking_park'`
- **THEN** the orchestrator SHALL enter the blocking-park response flow instead of ending the session

### Programmatic Pause
The ConsumptionMonitor SHALL provide a `requestPause()` method for programmatically requesting a pause, and a `pauseRequested` getter for checking the flag.

The `requestPause()` method SHALL accept an optional options object with `reason` (string) and `blockingItem` (object) fields. When no options are provided, the reason SHALL default to `'user_paused'`.

#### Scenario: Programmatic pause request without options
- **WHEN** `requestPause()` is called without arguments
- **THEN** `pauseRequested` SHALL return true
- **AND** the next `shouldStop()` call SHALL return `{ stop: true, reason: 'user_paused' }`

#### Scenario: Programmatic pause request with blocking_park
- **WHEN** `requestPause({ reason: 'blocking_park', blockingItem: { id: 'REQ-1', error: 'missing component' } })` is called
- **THEN** `pauseRequested` SHALL return true
- **AND** the next `shouldStop()` call SHALL return `{ stop: true, reason: 'blocking_park', blockingItem: { id: 'REQ-1', error: 'missing component' } }`

#### Scenario: Default state
- **WHEN** no pause has been requested
- **THEN** `pauseRequested` SHALL return false

### Orchestrator Integration
Both the parallel orchestrator and sequential orchestrator SHALL install signal handlers before their main loops and remove them after.

#### Scenario: Parallel orchestrator
- **WHEN** the parallel orchestrator starts its phase loop
- **THEN** `monitor.installSignalHandlers()` SHALL be called before `_runPhases()`
- **AND** `monitor.removeSignalHandlers()` SHALL be called after `_runPhases()` completes

#### Scenario: Sequential orchestrator
- **WHEN** the sequential orchestrator starts its microcycle loop
- **THEN** `monitor.installSignalHandlers()` SHALL be called before the loop
- **AND** `monitor.removeSignalHandlers()` SHALL be called after the loop completes

### Session State on Pause
When the session stops due to a pause, the orchestrator SHALL transition to SESSION_COMPLETE with consumption state persisted. The session can be resumed later with `--resume`.

#### Scenario: Pause triggers graceful shutdown
- **WHEN** `shouldStop()` returns `user_paused` during the phase loop
- **THEN** the orchestrator SHALL log `graceful_shutdown` with reason `user_paused`, transition to SESSION_COMPLETE, push the session branch, and write the summary
