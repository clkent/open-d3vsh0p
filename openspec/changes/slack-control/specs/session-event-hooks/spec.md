## ADDED Requirements

### Requirement: Session Event Schema
The system SHALL define a single JSON event schema used by hook-originated and orchestrator-originated events: `{ ts, type, projectId, sessionType, claudeSessionId, data }`, where `ts` is ISO 8601, `type` is one of `session_started`, `assistant_stop`, `notification`, `question`, `session_ended`, `limit_wait`, `limit_resumed`, `idle_continued`, `run_complete`, `health_failed`, `consolidated`, `action_required`, `sessionType` is one of `kickoff`, `talk`, `pair`, `run`, and `data` carries type-specific fields.

#### Scenario: Stop event shape
- **WHEN** a `Stop` hook fires in a `run` session for project `my-app`
- **THEN** the emitted event SHALL be `type: 'assistant_stop'`, `sessionType: 'run'`, `projectId: 'my-app'`, with `data.message` equal to the hook's `last_assistant_message`

#### Scenario: Unknown event type rejected
- **WHEN** an emitter is asked to send an event whose `type` is not in the schema
- **THEN** it SHALL throw a descriptive error and send nothing

### Requirement: Hook Injection at Spawn
The system SHALL inject Claude Code hooks into a spawned session via the `--settings` argument as an inline JSON string when event emission is enabled (`slack.enabled` true or a sink is discoverable). The injected hooks SHALL be: `Stop`, `Notification` (matcher `idle_prompt|permission_prompt|agent_needs_input|elicitation_dialog`), `SessionEnd`, and `PreToolUse` (matcher `AskUserQuestion`), each running `node <orchestrator>/src/hooks/emit-event.js`. The injected `hooks` object SHALL be the union of any hooks already defined in the project's `.claude/settings.json` and `.claude/settings.local.json` and the orchestrator's hooks, so project hooks are never shadowed. When event emission is not enabled, the spawn args SHALL NOT contain `--settings`.

#### Scenario: Hooks merged with project hooks
- **WHEN** the project's `.claude/settings.json` defines a `PostToolUse` hook and event emission is enabled
- **THEN** the `--settings` JSON SHALL contain both the project's `PostToolUse` hook and the orchestrator's `Stop`, `Notification`, `SessionEnd`, and `PreToolUse` hooks

#### Scenario: Emission disabled
- **WHEN** `slack.enabled` is false and no `active-agents/slack/bridge.json` exists
- **THEN** `buildClaudeArgs` SHALL NOT add `--settings`

#### Scenario: Hook command is absolute
- **WHEN** hooks are injected
- **THEN** every hook `command` SHALL reference the absolute path of `emit-event.js` so it resolves regardless of the session's working directory

### Requirement: Hook Emitter Never Disturbs the Session
The hook command SHALL read the hook payload from stdin, map it to the event schema, POST it to the event sink, and exit with code 0 within 1 second in all cases, including when the sink is unreachable, the payload is malformed, or the POST is rejected. It SHALL NOT print to stdout (so no hook output is injected into the conversation) and SHALL NOT return a blocking decision for `PreToolUse`.

#### Scenario: Sink down
- **WHEN** `emit-event.js Stop` runs and nothing is listening on the sink port
- **THEN** it SHALL exit 0 with empty stdout within 1 second

#### Scenario: AskUserQuestion is not blocked
- **WHEN** `emit-event.js PreToolUse` receives a payload with `tool_name: 'AskUserQuestion'`
- **THEN** it SHALL emit a `question` event containing the question text and options and exit 0 without any JSON decision on stdout

### Requirement: Local Event Sink Discovery and Authentication
Emitters SHALL locate the sink from, in order: the `DEVSHOP_EVENT_SINK` environment variable, then `active-agents/slack/bridge.json` (`{ port, token }`). The sink SHALL bind to `127.0.0.1` only. Every POST SHALL carry `Authorization: Bearer <token>`; the sink SHALL reject requests without the current token with 401 and log them.

#### Scenario: Discovery via bridge file
- **WHEN** `DEVSHOP_EVENT_SINK` is unset and `bridge.json` contains `port: 3211`
- **THEN** the emitter SHALL POST to `http://127.0.0.1:3211/events`

#### Scenario: Wrong token
- **WHEN** a POST arrives with a stale or missing bearer token
- **THEN** the sink SHALL respond 401 and SHALL NOT forward the event to Slack

### Requirement: Run Lifecycle Events
The `run` command SHALL emit orchestrator events at its existing lifecycle points: `session_started` (spawn or respawn, with reason), `limit_wait` (with next probe time), `limit_resumed`, `idle_continued` (with nudge count), `health_failed`, `run_complete` (with completed, parked, remaining counts and stop reason), `consolidated` (with PR URL or skip reason), and `action_required` (with pending HUMAN items). `talk`, `pair`, and `kickoff` SHALL emit `session_started` and rely on hooks for the rest.

#### Scenario: Run summary event
- **WHEN** a run session ends having completed 3 items with 1 parked and 4 remaining
- **THEN** a `run_complete` event SHALL be emitted with `data: { completed: 3, parked: 1, remaining: 4, stopReason }`

#### Scenario: Limit wait event
- **WHEN** the run loop enters a usage-limit wait
- **THEN** a `limit_wait` event SHALL be emitted with `data.nextProbeAt` as ISO 8601
