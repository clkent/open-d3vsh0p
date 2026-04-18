# PM Workflow

## Purpose
Provides interactive conversation sessions between the developer and Riley (the PM agent) for two modes: brain dump planning (turning raw ideas into specs and roadmaps) and mid-project talk (discussing progress, updating specs, and adjusting roadmaps). Sessions are persisted for continuity across CLI invocations.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/pm-session.js` -- PMSession class managing conversation continuity via Claude session IDs
- `platform/orchestrator/src/commands/plan.js` -- planCommand implementing the brain dump interactive loop
- `platform/orchestrator/src/commands/talk.js` -- talkCommand implementing the mid-project conversation loop

## Requirements

### Brain Dump (plan command)
The system SHALL provide a `plan` command that starts an interactive readline loop with Riley. The first turn of a new session (no existing session state) SHALL use `brain-dump-prompt.md` as the system prompt file. Subsequent turns SHALL rely on Claude's session continuity (no system prompt sent). The command SHALL print a session header identifying the project and instructions.

#### Scenario: First turn uses brain dump prompt
- **WHEN** a developer runs `plan` for a project with no existing PM session
- **THEN** the first user message SHALL be sent with `promptFile: 'brain-dump-prompt.md'` and `systemPromptTemplate: 'pm-agent'`

#### Scenario: Subsequent turns use session continuity
- **WHEN** the developer sends a second message in the same plan session
- **THEN** the chat call SHALL pass `promptFile: null` (no system prompt), relying on the stored session ID for conversation continuity

#### Scenario: Resuming a previous session
- **WHEN** a developer runs `plan` and a previous PM session exists in `active-agents/{project}/orchestrator/pm-session.json`
- **THEN** the session SHALL be loaded and the brain dump prompt SHALL NOT be used (since `existingSession` is truthy), with a console message confirming resumption

#### Scenario: Empty input ignored
- **WHEN** the developer presses Enter without typing anything
- **THEN** the system SHALL re-prompt without sending a message to Riley

### Mid-Project Talk (talk command)
The system SHALL provide a `talk` command that starts an interactive readline loop with Riley, injecting current project progress as context. The context SHALL include session state (completed/pending/parked requirement counts and IDs) and roadmap progress (per-phase completion counts).

#### Scenario: Session state context injected
- **WHEN** a developer runs `talk` and an active orchestrator state.json exists
- **THEN** the REQUIREMENTS template variable SHALL include completed count, pending count, parked count, and lists of completed and parked item IDs

#### Scenario: Roadmap progress context injected
- **WHEN** a developer runs `talk` and a roadmap.md exists
- **THEN** the REQUIREMENTS template variable SHALL include per-phase progress (e.g., "Phase 1 (Foundation): 3/5 complete")

#### Scenario: No active session state
- **WHEN** a developer runs `talk` and no state.json exists
- **THEN** the progress context SHALL include "No active session found" and the conversation SHALL proceed normally

#### Scenario: Talk uses standard system prompt
- **WHEN** the talk command sends messages to Riley
- **THEN** it SHALL use `systemPromptTemplate: 'pm-agent'` with no `promptFile` (using the standard system-prompt.md, not the brain dump prompt)

### PM Session Persistence
The system SHALL persist conversation session IDs to `active-agents/{project}/orchestrator/pm-session.json` containing `{ sessionId, savedAt }`. The PMSession class SHALL store the Claude session ID returned from the first agent run and reuse it for subsequent turns via `resumeSessionId`.

#### Scenario: Session ID captured on first turn
- **WHEN** `chat()` is called and the agent runner returns a `result.sessionId`
- **THEN** PMSession SHALL store it in `this._sessionId` for use in subsequent turns

#### Scenario: Session saved to disk
- **WHEN** `saveSessionState(stateDir)` is called with a valid session ID
- **THEN** a file SHALL be written at `{stateDir}/pm-session.json` containing `{ sessionId: <id>, savedAt: <ISO8601> }` with the directory created recursively if needed

#### Scenario: Session loaded from disk
- **WHEN** `loadSessionState(stateDir)` is called and `pm-session.json` exists
- **THEN** the stored `sessionId` SHALL be restored to `this._sessionId` and the state object SHALL be returned

#### Scenario: Load with no saved session
- **WHEN** `loadSessionState(stateDir)` is called and no `pm-session.json` exists
- **THEN** it SHALL return null without throwing an error and `_sessionId` SHALL remain null

#### Scenario: No session ID means no save
- **WHEN** `saveSessionState` is called but `_sessionId` is null
- **THEN** the method SHALL return immediately without writing any file

### Cost Tracking Per Turn
The system SHALL track cumulative cost across all turns in a session. After each Riley response, the system SHALL display the per-turn cost and running total in the format `[cost: $X.XXX | total: $X.XXX]`.

#### Scenario: Cost accumulation in plan command
- **WHEN** Riley responds to three turns costing $0.10, $0.15, and $0.20
- **THEN** after the third turn, the display SHALL show `[cost: $0.200 | total: $0.450]`

#### Scenario: Null cost handled
- **WHEN** the agent runner returns `cost: null` or `cost: undefined`
- **THEN** the system SHALL treat it as $0.000 (via `result.cost || 0`)

### Graceful Exit
The system SHALL exit the interactive loop when the developer types "done" or "exit" (case-insensitive) or presses Ctrl+C. On any exit, the session state SHALL be saved and the total cost and turn count SHALL be logged.

#### Scenario: Exit via "done" keyword
- **WHEN** the developer types "done"
- **THEN** the session SHALL be saved, a summary SHALL be printed showing total cost and turn count, and the readline interface SHALL close

#### Scenario: Exit via "exit" keyword
- **WHEN** the developer types "Exit" (any case)
- **THEN** the system SHALL treat it the same as "done" (case-insensitive comparison via `.toLowerCase()`)

#### Scenario: Exit via Ctrl+C
- **WHEN** the developer presses Ctrl+C triggering the readline 'close' event
- **THEN** the session state SHALL be saved and a log entry SHALL be written with event 'plan_session_ended' or 'talk_session_ended' including `totalCost` and `turnCount`

#### Scenario: Plan command resume hint
- **WHEN** a plan session ends via "done" or "exit"
- **THEN** the system SHALL print a hint message: `Resume later with: node src/index.js plan {projectId}`

### System Prompt Construction
The system SHALL build system prompts for Riley only on the first turn of a new session. When a `promptFile` is specified, the system SHALL load it from `templates/agents/{systemPromptTemplate}/{promptFile}` and render it with `templateEngine.renderString`. When no `promptFile` is specified and no session exists, it SHALL use `templateEngine.renderAgentPrompt`. When a session already exists (resume), no system prompt SHALL be sent.

#### Scenario: First turn with prompt file
- **WHEN** `chat()` is called with `promptFile: 'brain-dump-prompt.md'` and no active session
- **THEN** the system prompt SHALL be loaded from `templates/agents/pm-agent/brain-dump-prompt.md` and rendered with template variables

#### Scenario: First turn without prompt file
- **WHEN** `chat()` is called with no `promptFile` and no active session
- **THEN** the system prompt SHALL be built via `renderAgentPrompt('pm-agent', templateVars)`

#### Scenario: Resumed session skips system prompt
- **WHEN** `chat()` is called and an active session ID exists (either from prior turn or loaded state)
- **THEN** `systemPrompt` SHALL be null and only the user message SHALL be sent to the agent
