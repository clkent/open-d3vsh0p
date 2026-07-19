# Logging and Observability

## Purpose
Provides structured logging for orchestrator sessions via JSONL run logs. Each log entry captures timestamp, level, and event type with contextual data. Console output gives operators real-time visibility with level-appropriate icons.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/infra/logger.js` -- Logger class with JSONL file logging and console output

## Requirements

### JSONL Run Logs
The system SHALL write structured log entries to a file named `{sessionId}.jsonl` inside the configured log directory. Each entry SHALL be a single JSON line containing at minimum `{ ts, level, event }` plus any additional data fields spread into the object.

#### Scenario: Log entry format
- **WHEN** `log('info', 'state_transition', { from: 'idle', to: 'implementing' })` is called
- **THEN** a line SHALL be appended to `{sessionId}.jsonl` containing `{ ts: <ISO8601>, level: "info", event: "state_transition", from: "idle", to: "implementing" }`

#### Scenario: Timestamp is ISO 8601
- **WHEN** any log entry is written
- **THEN** the `ts` field SHALL be a `new Date().toISOString()` value (e.g., "2025-01-15T10:30:00.000Z")

#### Scenario: Multiple entries append to same file
- **WHEN** three log calls are made in sequence
- **THEN** the JSONL file SHALL contain three newline-delimited JSON lines in order

### Console Output with Icons
The system SHALL print each log entry to the console with a level-appropriate icon prefix: `!` for error, `~` for warn, and `-` for info. The format SHALL be `  {icon} [{event}] {context}` where context is the pipe-separated concatenation of `agent`, `requirementId`, and `reason` fields (omitting absent fields).

#### Scenario: Info-level console output
- **WHEN** a log entry with level 'info', event 'state_transition', and no agent/requirementId/reason is written
- **THEN** the console output SHALL be `  - [state_transition]`

#### Scenario: Warn-level console output with context
- **WHEN** a log entry with level 'warn', event 'requirement_parked', requirementId 'user-auth', and reason 'max_retries' is written
- **THEN** the console output SHALL be `  ~ [requirement_parked] user-auth | max_retries`

#### Scenario: Error-level console output
- **WHEN** a log entry with level 'error' and event 'fatal_error' is written
- **THEN** the console output SHALL use the `!` icon prefix

### Log Directory Management
The system SHALL lazily initialize the log directory on first write. The `init()` method SHALL create the log directory recursively (using `mkdir` with `recursive: true`). If `log()` is called before explicit `init()`, it SHALL auto-initialize.

#### Scenario: First log call triggers directory creation
- **WHEN** `log()` is called and `initialized` is false
- **THEN** the logger SHALL call `init()` automatically before writing, creating the directory tree if needed

#### Scenario: Explicit init before logging
- **WHEN** `init()` is called before any logging
- **THEN** the log directory SHALL be created with `recursive: true` and `initialized` SHALL be set to true
