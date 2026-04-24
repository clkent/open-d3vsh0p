# Inline Watch Mode

## Purpose
Enables live agent activity display directly in the `run` command terminal via a `--watch` flag, eliminating the need for a separate `watch` terminal for common use cases.

## Status
PROPOSED

## Source Files
- `platform/orchestrator/src/parallel-orchestrator.js` — `_createAgentOnEvent()` gains inline console output path
- `platform/orchestrator/src/infra/format-events.js` — shared event formatting module (extracted from watch.js)

## Requirements

### Inline Agent Display
When the `--watch` flag is passed to the `run` command, the orchestrator SHALL print formatted agent events to the terminal inline alongside existing orchestrator output. When `--watch` is not set, agent events SHALL NOT be printed to the terminal (existing behavior preserved).

#### Scenario: Agent assistant text displayed inline
- **WHEN** `--watch` is enabled and an agent emits an `assistant` event
- **THEN** the terminal SHALL display `[persona] (requirementId) <text>` using the shared formatter
- **AND** the text SHALL be truncated to 200 characters with `...` appended if longer

#### Scenario: Agent result displayed inline
- **WHEN** `--watch` is enabled and an agent emits a `result` event
- **THEN** the terminal SHALL display `[persona] (requirementId) DONE` or `[persona] (requirementId) ERROR` based on `event.is_error`

#### Scenario: Watch disabled by default
- **WHEN** `run` is executed without `--watch`
- **THEN** no agent events SHALL be printed to the terminal
- **AND** existing orchestrator output (milestones, progress thoughts) SHALL continue to display as before

#### Scenario: Broadcast still receives events
- **WHEN** `--watch` is enabled
- **THEN** agent events SHALL still be broadcast to the WebSocket server for remote `watch` clients
- **AND** inline display SHALL be in addition to broadcasting, not a replacement

### Shared Event Formatting
Event formatting functions SHALL be extracted into a shared module at `platform/orchestrator/src/infra/format-events.js`. Both the `watch` command and the inline display SHALL use this module.

#### Scenario: Watch command uses shared formatter
- **WHEN** the `watch` command receives a broadcast event
- **THEN** it SHALL format the event using functions imported from `format-events.js`

#### Scenario: Inline display uses shared formatter
- **WHEN** `--watch` is enabled and the orchestrator receives an agent event via `onEvent`
- **THEN** it SHALL format the event using the same functions from `format-events.js`

#### Scenario: Formatting output is identical
- **WHEN** the same event is formatted by the `watch` command and the inline display
- **THEN** the output SHALL be identical

### Inline Display via onEvent Callback
The `_createAgentOnEvent()` method SHALL accept a `watchEnabled` parameter. When true, it SHALL call the shared `formatAgentEvent()` function to print agent events to the console in addition to broadcasting them.

#### Scenario: onEvent with watch enabled
- **WHEN** `_createAgentOnEvent()` is called with `watchEnabled: true`
- **THEN** the returned callback SHALL both broadcast the event AND print formatted output to the console

#### Scenario: onEvent with watch disabled
- **WHEN** `_createAgentOnEvent()` is called with `watchEnabled: false` or without the parameter
- **THEN** the returned callback SHALL only broadcast the event (existing behavior)

#### Scenario: onEvent without broadcast server
- **WHEN** `_createAgentOnEvent()` is called with `watchEnabled: true` but no broadcast server is running
- **THEN** the returned callback SHALL still print formatted output to the console
