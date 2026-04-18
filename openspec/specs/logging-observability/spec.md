# Logging and Observability

## Purpose
Provides structured logging for orchestrator sessions via JSONL run logs and JSON session summaries. Each log entry captures timestamp, level, and event type with contextual data. Console output gives operators real-time visibility with level-appropriate icons.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/logger.js` -- Logger class with JSONL file logging, structured event methods, console output, and session summary generation

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

### Structured Log Events
The system SHALL provide dedicated methods for common orchestrator events: `logStateTransition(from, to, requirement)`, `logAgentRun(agentType, result)`, `logTestRun(testResult)`, `logCommit(sha, message)`, `logMerge(requirementId, branch)`, `logParked(requirementId, reason)`, and `logConsumptionWarning(snapshot)`.

#### Scenario: State transition logging
- **WHEN** `logStateTransition('implementing', 'testing', 'user-auth')` is called
- **THEN** a log entry SHALL be written at level 'info' with event 'state_transition', `from: 'implementing'`, `to: 'testing'`, and `requirementId: 'user-auth'`

#### Scenario: Agent run logging with success
- **WHEN** `logAgentRun('implementation', { success: true, cost: 0.50, duration: 30000, sessionId: 'abc123' })` is called
- **THEN** a log entry SHALL be written at level 'info' with event 'agent_completed', including `agent: 'implementation'`, `success: true`, `costUsd: 0.50`, `durationMs: 30000`, and `claudeSessionId: 'abc123'`

#### Scenario: Agent run logging with failure
- **WHEN** `logAgentRun('implementation', { success: false, error: 'timeout' })` is called
- **THEN** a log entry SHALL be written at level 'warn' with event 'agent_completed', `success: false`, and `error: 'timeout'`

#### Scenario: Test run logging
- **WHEN** `logTestRun({ passed: false, summary: '3 of 5 passed', exitCode: 1 })` is called
- **THEN** a log entry SHALL be written at level 'warn' with event 'tests_completed', `passed: false`, `summary: '3 of 5 passed'`, and `exitCode: 1`

#### Scenario: Parked requirement logging
- **WHEN** `logParked('payment-flow', 'max_retries_exceeded')` is called
- **THEN** a log entry SHALL be written at level 'warn' with event 'requirement_parked', `requirementId: 'payment-flow'`, and `reason: 'max_retries_exceeded'`

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

### Session Summary JSON
The system SHALL provide a `writeSummary(state)` method that writes a `{sessionId}-summary.json` file containing session metadata: `sessionId`, `projectId`, `startedAt`, `completedAt` (current time), `stopReason`, `totalCostUsd`, `totalDurationMs`, `agentInvocations`, `sessionBranch`, `results` (with `completed`, `parked`, `remaining` arrays), and `completedMicrocycles`.

#### Scenario: Summary on successful completion
- **WHEN** writeSummary is called with state where pending is empty and inProgress is null
- **THEN** the stopReason SHALL be 'all_requirements_processed' and the summary file SHALL be written as pretty-printed JSON (2-space indent)

#### Scenario: Summary on interrupted session
- **WHEN** writeSummary is called with state where pending still has items
- **THEN** the stopReason SHALL be 'session_ended'

#### Scenario: Summary file path returned
- **WHEN** writeSummary completes
- **THEN** it SHALL return the absolute path to the written summary file

### Log Directory Management
The system SHALL lazily initialize the log directory on first write. The `init()` method SHALL create the log directory recursively (using `mkdir` with `recursive: true`). If `log()` is called before explicit `init()`, it SHALL auto-initialize.

#### Scenario: First log call triggers directory creation
- **WHEN** `log()` is called and `initialized` is false
- **THEN** the logger SHALL call `init()` automatically before writing, creating the directory tree if needed

#### Scenario: Explicit init before logging
- **WHEN** `init()` is called before any logging
- **THEN** the log directory SHALL be created with `recursive: true` and `initialized` SHALL be set to true

#### Scenario: writeSummary auto-initializes
- **WHEN** `writeSummary()` is called before any prior init
- **THEN** it SHALL call `init()` first to ensure the directory exists

### Post-Session DevShop Commit
After a session completes, changes to DevShop files (project-registry.json, session logs) SHALL be committed to the DevShop repo with a descriptive PR that identifies the project and summarizes what was accomplished.

The PR title SHALL follow the format: `chore(<projectId>): session <sessionId> — <summary>`.

The PR body SHALL include: project name and ID, session ID, list of completed requirement IDs with phase name, count of parked requirements, and total cost. This data SHALL be sourced from the session summary JSON at `active-agents/<projectId>/orchestrator/logs/<sessionId>-summary.json`.

#### Scenario: Session completes with all requirements merged
- **WHEN** a session completes with stopReason 'all_requirements_processed' and 3 completed requirements
- **THEN** the DevShop PR body SHALL list all 3 requirement IDs under "Completed" and show "Parked: none"

#### Scenario: Session completes with parked requirements
- **WHEN** a session completes with 2 completed and 1 parked requirement
- **THEN** the DevShop PR body SHALL list the 2 completed IDs and show "Parked: 1"

#### Scenario: PR links to session summary
- **WHEN** the DevShop commit includes changes to `active-agents/`
- **THEN** the PR body SHALL reference the session summary log path so the full details can be reviewed

### Broadcast Emitter Integration
The Logger SHALL accept an optional `broadcastFn` during construction or via a `setBroadcast(fn)` method.

When `broadcastFn` is set, every `log()` call SHALL invoke `broadcastFn` with a structured event containing the log level, event type, and data — in addition to writing to the JSONL file and console.

The broadcast call SHALL be fire-and-forget (non-blocking, errors silently caught) so that broadcast failures never affect logging.

#### Scenario: Logger emits to broadcast on log()
- **WHEN** `log('info', 'phase_started', { phase: 'Phase 1' })` is called and a broadcastFn is set
- **THEN** the broadcastFn SHALL be called with `{ level: 'info', eventType: 'phase_started', data: { phase: 'Phase 1' } }` and the JSONL file SHALL still be written normally

#### Scenario: Broadcast not configured
- **WHEN** `log()` is called and no broadcastFn has been set
- **THEN** the logger SHALL write to JSONL and console as normal with no broadcast call

#### Scenario: Broadcast error is non-fatal
- **WHEN** broadcastFn throws an error during a log() call
- **THEN** the JSONL write and console output SHALL still complete successfully

### Milestone Logging
The Logger SHALL provide a `logMilestone(data)` method that logs a milestone event at level `info` with event type `milestone`. The data object SHALL include `requirementId`, `result`, `persona`, `group`, `attempts`, `costUsd`, `diffStat`, `reviewSummary`, `previewAvailable`, and `progress` fields. The milestone event SHALL be broadcast via the broadcastFn if configured. Console output for milestone events SHALL use a distinct format: `  * [milestone] <requirementId> <result>` using `*` as the icon to distinguish milestones from regular log entries.

#### Scenario: Milestone logged for merged requirement
- **WHEN** `logMilestone({ requirementId: 'user-auth', result: 'merged', persona: 'Taylor', attempts: 2, costUsd: 3.50, progress: { completed: 3, total: 7, parked: 0 } })` is called
- **THEN** a JSONL entry SHALL be written with `{ level: 'info', event: 'milestone', requirementId: 'user-auth', result: 'merged', ... }` and the console SHALL output `  * [milestone] user-auth merged`

#### Scenario: Milestone logged for parked requirement
- **WHEN** `logMilestone({ requirementId: 'payment-flow', result: 'parked', ... })` is called
- **THEN** the JSONL entry SHALL have `level: 'warn'` (parked is a warning) and the console SHALL output `  ~ [milestone] payment-flow parked`

#### Scenario: Milestone broadcast
- **WHEN** `logMilestone()` is called with a broadcastFn configured
- **THEN** the broadcastFn SHALL be called with `{ level, eventType: 'milestone', data }` which the broadcast server wraps in a standard envelope

### Progress Logging
The Logger SHALL provide a `logProgress(data)` method that logs a progress event at level `info` with event type `progress`. The data object SHALL include `phase`, `completed`, `total`, `parked`, `budgetUsedUsd`, `budgetLimitUsd`, `elapsedMinutes`, and `activeAgents`. Console output for progress events SHALL use the format: `  [progress] <phase> | <completed>/<total> | $<used>/$<limit> | <elapsed>m`.

#### Scenario: Progress event logged
- **WHEN** `logProgress({ phase: 'Phase 2: UI', completed: 2, total: 5, budgetUsedUsd: 6.30, budgetLimitUsd: 30, elapsedMinutes: 12 })` is called
- **THEN** a JSONL entry SHALL be written with event `progress` and the console SHALL output `  [progress] Phase 2: UI | 2/5 | $6.30/$30.00 | 12m`

#### Scenario: Progress broadcast
- **WHEN** `logProgress()` is called with a broadcastFn configured
- **THEN** the broadcastFn SHALL be called with `{ level: 'info', eventType: 'progress', data }` for broadcast to WebSocket clients

### Go-Look Logging
The Logger SHALL provide a `logGoLook(data)` method that logs a go_look event at level `info` with event type `go_look`. The data object SHALL include `requirementId`, `previewCommand`, `previewPort`, and `message`. Console output for go_look events SHALL use a prominent format: `  >>> <message>` matching the watch command's display.

#### Scenario: Go-look event logged
- **WHEN** `logGoLook({ requirementId: 'nav-bar', previewPort: 3000, message: 'nav-bar merged — refresh localhost:3000' })` is called
- **THEN** a JSONL entry SHALL be written with event `go_look` and the console SHALL output `  >>> nav-bar merged — refresh localhost:3000`

#### Scenario: Go-look broadcast
- **WHEN** `logGoLook()` is called with a broadcastFn configured
- **THEN** the broadcastFn SHALL be called with `{ level: 'info', eventType: 'go_look', data }` for broadcast to WebSocket clients
