# Live Broadcast

## Purpose
Provides real-time streaming of agent activity and orchestrator events to connected WebSocket clients. Enables the `watch` command for terminal monitoring and establishes the event schema for future web dashboard and 3D visualization consumers.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/broadcast-server.js` -- WebSocket broadcast server with client management
- `platform/orchestrator/src/commands/watch.js` -- Terminal client for watching broadcast events

## Requirements

### WebSocket Broadcast Server
The system SHALL provide a `BroadcastServer` class that starts a WebSocket server and broadcasts JSON events to all connected clients.

The server SHALL listen on a configurable port (default 3100), bound to `127.0.0.1` (localhost only).

The server SHALL accept WebSocket connections and maintain a set of active clients.

The `broadcast(event)` method SHALL JSON-serialize the event and send it to every connected client. Before serialization, the server SHALL strip sensitive fields (`claudeSessionId`, `session_id`) from the event tree to prevent leaking Claude CLI session identifiers. Clients that error on send SHALL be silently removed from the active set.

#### Scenario: Server starts and accepts connections
- **WHEN** `BroadcastServer.start(port)` is called
- **THEN** a WebSocket server SHALL begin listening on the specified port

#### Scenario: Client connects
- **WHEN** a WebSocket client connects to the server
- **THEN** the server SHALL add it to the active client set

#### Scenario: Client disconnects
- **WHEN** a connected client closes the WebSocket connection
- **THEN** the server SHALL remove it from the active client set

#### Scenario: Event broadcast to all clients
- **WHEN** `broadcast(event)` is called with 3 connected clients
- **THEN** all 3 clients SHALL receive the JSON-serialized event

#### Scenario: Failed send removes client
- **WHEN** `broadcast(event)` is called and one client's send throws an error
- **THEN** that client SHALL be removed from the active set and the other clients SHALL still receive the event

#### Scenario: Server stops cleanly
- **WHEN** `BroadcastServer.stop()` is called
- **THEN** the WebSocket server SHALL close, all client connections SHALL be terminated, and the port SHALL be released

### Broadcast Event Envelope
All broadcast events SHALL be wrapped in a standard envelope containing `source`, `sessionId`, `timestamp`, and the inner `event` payload.

Events with `source: "agent"` SHALL also include `persona`, `requirementId`, and `group` fields identifying which agent produced the event.

Events with `source: "orchestrator"` SHALL include the `level` and `eventType` from the logger.

Events with `source: "pair"` SHALL include `persona` (always "Morgan") and SHALL NOT include `requirementId` or `group`.

#### Scenario: Agent event envelope
- **WHEN** an agent stream-json chunk is broadcast for Jordan working on requirement "user-auth" in Group A
- **THEN** the envelope SHALL contain `{ source: "agent", sessionId, timestamp, persona: "Jordan", requirementId: "user-auth", group: "A", event: <raw stream-json object> }`

#### Scenario: Orchestrator event envelope
- **WHEN** a logger event "phase_started" at level "info" is broadcast
- **THEN** the envelope SHALL contain `{ source: "orchestrator", sessionId, timestamp, level: "info", eventType: "phase_started", event: <log data> }`

#### Scenario: Pair event envelope
- **WHEN** a stream-json chunk is broadcast during a pair session
- **THEN** the envelope SHALL contain `{ source: "pair", sessionId, timestamp, persona: "Morgan", event: <raw stream-json object> }`

### Broadcast Server Lifecycle
The broadcast server SHALL start automatically when the orchestrator begins a session and stop when the session completes.

#### Scenario: Server starts with session
- **WHEN** the orchestrator initializes a new or resumed session
- **THEN** the broadcast server SHALL start before the first phase begins

#### Scenario: Server stops on session complete
- **WHEN** the orchestrator transitions to SESSION_COMPLETE
- **THEN** the broadcast server SHALL stop and release its port

#### Scenario: Port in use
- **WHEN** the broadcast server attempts to start and the port is already in use
- **THEN** the system SHALL log a warning and continue the session without broadcasting (broadcast is non-fatal)

### Pair Session Event Envelope
Events with `source: "pair"` SHALL include `persona` and `sessionId` fields. The `persona` field SHALL be "Morgan". Pair event envelopes SHALL NOT include `requirementId` or `group` fields.

#### Scenario: Pair event envelope
- **WHEN** a stream-json chunk is broadcast during a pair session with session ID "pair-2026-02-16-17-30"
- **THEN** the envelope SHALL contain `{ source: "pair", sessionId: "pair-2026-02-16-17-30", timestamp, persona: "Morgan", event: <raw stream-json object> }`

#### Scenario: Pair event omits parallel-only fields
- **WHEN** a pair session event is broadcast
- **THEN** the envelope SHALL NOT contain `requirementId` or `group` fields

### Pair Session Broadcast Lifecycle
The pair command SHALL start a `BroadcastServer` before the REPL loop begins and stop it when the session ends.

#### Scenario: Broadcast server starts with pair session
- **WHEN** the pair command initializes
- **THEN** a `BroadcastServer` SHALL start on the configured port (default 3100) before the first user prompt

#### Scenario: Broadcast server stops on pair session end
- **WHEN** the user types "done" or presses Ctrl+C to end the pair session
- **THEN** the `BroadcastServer` SHALL stop and release its port

#### Scenario: Pair session continues without broadcast on port conflict
- **WHEN** the broadcast server fails to start because the port is in use
- **THEN** the pair session SHALL continue without broadcasting (non-fatal)

### Pair Event Forwarding
The pair command SHALL pass an `onEvent` callback through `PMSession.chat()` to `AgentRunner.runAgent()` so that Morgan's stream-json events are broadcast in real time.

#### Scenario: Morgan's activity is broadcast during a turn
- **WHEN** the user sends a message and Morgan processes it
- **THEN** each stream-json event from the Claude CLI SHALL be broadcast as a pair event envelope to all connected WebSocket clients

#### Scenario: PMSession forwards onEvent to AgentRunner
- **WHEN** `PMSession.chat()` is called with an `onEvent` option
- **THEN** the `onEvent` callback SHALL be passed to `AgentRunner.runAgent()`

### Watch Command Pair Event Formatting
The `watch` command SHALL format `source: "pair"` events for display.

#### Scenario: Pair assistant text displayed
- **WHEN** a pair event with `event.type === "assistant"` is received
- **THEN** the watch command SHALL display `[Morgan] <truncated text>`

#### Scenario: Pair result displayed
- **WHEN** a pair event with `event.type === "result"` is received
- **THEN** the watch command SHALL display `[Morgan] DONE` or `[Morgan] ERROR` based on `event.is_error`

#### Scenario: Watch connects to pair session
- **WHEN** a user runs `watch` while a pair session is active
- **THEN** the watch command SHALL connect and display pair events

### Milestone Broadcast Event
The broadcast server SHALL emit a `milestone` event (source: `orchestrator`, eventType: `milestone`) when a requirement completes (merged or parked). The event payload SHALL include structured fields: `requirementId` (string), `result` ("merged" or "parked"), `persona` (string), `group` (string), `attempts` (number), `costUsd` (number), `diffStat` (string — output of `git diff --stat`), `reviewSummary` (string or null — one-line review outcome from Morgan), `previewAvailable` (boolean), and `progress` object with `completed` (number), `total` (number), `parked` (number).

#### Scenario: Merged requirement milestone event
- **WHEN** requirement "multi-location-interface" completes with result "merged" by Taylor in Group A, after 2 attempts costing $3.50, with preview available
- **THEN** the broadcast SHALL emit `{ source: "orchestrator", eventType: "milestone", event: { requirementId: "multi-location-interface", result: "merged", persona: "Taylor", group: "A", attempts: 2, costUsd: 3.50, diffStat: "5 files changed, 120 insertions(+), 30 deletions(-)", reviewSummary: "Approved — clean implementation", previewAvailable: true, progress: { completed: 3, total: 7, parked: 0 } } }`

#### Scenario: Parked requirement milestone event
- **WHEN** requirement "payment-flow" is parked by Jordan in Group B after 4 attempts costing $8.20
- **THEN** the broadcast SHALL emit `{ source: "orchestrator", eventType: "milestone", event: { requirementId: "payment-flow", result: "parked", persona: "Jordan", group: "B", attempts: 4, costUsd: 8.20, diffStat: null, reviewSummary: null, previewAvailable: false, progress: { completed: 3, total: 7, parked: 1 } } }`

### Progress Broadcast Event
The broadcast server SHALL emit a `progress` event (source: `orchestrator`, eventType: `progress`) periodically during active phases and after each requirement completion. The event payload SHALL include `phase` (string — current phase label), `completed` (number), `total` (number), `parked` (number), `budgetUsedUsd` (number), `budgetLimitUsd` (number), `elapsedMinutes` (number), and `activeAgents` (array of `{ persona, requirementId }`).

#### Scenario: Timer-based progress event during phase
- **WHEN** the progress timer fires 60 seconds into Phase 2 with 2/5 requirements complete, $6.30 spent of $30 budget, and 2 active agents
- **THEN** the broadcast SHALL emit `{ source: "orchestrator", eventType: "progress", event: { phase: "Phase 2: UI Components", completed: 2, total: 5, parked: 0, budgetUsedUsd: 6.30, budgetLimitUsd: 30, elapsedMinutes: 1, activeAgents: [{ persona: "Taylor", requirementId: "nav-bar" }, { persona: "Jordan", requirementId: "footer" }] } }`

#### Scenario: Progress event after requirement completion
- **WHEN** a requirement completes (merged or parked) during a phase
- **THEN** a `progress` event SHALL be emitted with updated counts immediately after the milestone event

#### Scenario: Progress timer lifecycle
- **WHEN** a phase begins execution
- **THEN** the progress timer SHALL start with a 30-second interval
- **AND** **WHEN** the phase completes or the session ends
- **THEN** the progress timer SHALL be cleared

### Go-Look Broadcast Event
The broadcast server SHALL emit a `go_look` event (source: `orchestrator`, eventType: `go_look`) when the preview transitions from unavailable to available after a merge. The event payload SHALL include `requirementId` (string — the requirement that was just merged), `previewCommand` (string — the command to run the preview, e.g. "npm run dev"), `previewPort` (number), and `message` (string — a human-readable prompt, e.g. "multi-location-interface merged — refresh localhost:3000").

#### Scenario: Preview becomes available after merge
- **WHEN** requirement "multi-location-interface" merges and the subsequent `checkPreview()` detects `transition: true` with `available: true`
- **THEN** the broadcast SHALL emit `{ source: "orchestrator", eventType: "go_look", event: { requirementId: "multi-location-interface", previewCommand: "npm run dev", previewPort: 3000, message: "multi-location-interface merged — refresh localhost:3000" } }`

#### Scenario: Preview already available, no transition
- **WHEN** a requirement merges and `checkPreview()` returns `available: true` but `transition: false`
- **THEN** no `go_look` event SHALL be emitted (the preview was already available)

#### Scenario: Preview unavailable after merge
- **WHEN** a requirement merges and `checkPreview()` returns `available: false`
- **THEN** no `go_look` event SHALL be emitted

### Watch Command Milestone Formatting
The `watch` command SHALL format `eventType: "milestone"` events as a multi-line block that visually stands out from regular log lines. The block SHALL include a separator line, the requirement ID and result, persona and attempt count, cost, diff stat (if present), review summary (if present), preview status, and overall progress fraction.

#### Scenario: Merged milestone display
- **WHEN** a milestone event with `result: "merged"` is received for "user-auth" by Taylor with 2 attempts, $3.50 cost, diff stat "5 files changed", review "Approved", preview available, progress 3/7
- **THEN** the watch command SHALL display a formatted block:
  ```
  ──────────────────────────────────────────
  MERGED  user-auth
  Taylor | 2 attempts | $3.50
  5 files changed, 120 insertions(+), 30 deletions(-)
  Review: Approved — clean implementation
  Preview: available
  Progress: 3/7 complete
  ──────────────────────────────────────────
  ```

#### Scenario: Parked milestone display
- **WHEN** a milestone event with `result: "parked"` is received for "payment-flow"
- **THEN** the watch command SHALL display a formatted block with "PARKED" instead of "MERGED" and omit diff stat and review summary

#### Scenario: Milestone without preview config
- **WHEN** a milestone event is received and `previewAvailable` is null or undefined
- **THEN** the "Preview:" line SHALL be omitted from the block

### Watch Command Progress Formatting
The `watch` command SHALL format `eventType: "progress"` events as a single compact line showing phase progress, budget, and elapsed time.

#### Scenario: Progress line display
- **WHEN** a progress event is received with phase "Phase 2: UI Components", 2/5 complete, 0 parked, $6.30/$30.00 budget, 12 minutes elapsed
- **THEN** the watch command SHALL display: `  [progress] Phase 2: UI Components | 2/5 complete | $6.30/$30.00 | 12m elapsed`

#### Scenario: Progress with parked items
- **WHEN** a progress event is received with 2 complete, 1 parked, 5 total
- **THEN** the display SHALL include parked count: `2/5 complete (1 parked)`

#### Scenario: Progress with active agents
- **WHEN** a progress event is received with 2 active agents
- **THEN** the display SHALL include: `Active: Taylor(nav-bar), Jordan(footer)`

### Watch Command Go-Look Formatting
The `watch` command SHALL format `eventType: "go_look"` events as a prominent single line with a `>>>` prefix to draw attention.

#### Scenario: Go-look display
- **WHEN** a go_look event is received with message "multi-location-interface merged — refresh localhost:3000"
- **THEN** the watch command SHALL display: `  >>> multi-location-interface merged — refresh localhost:3000`

#### Scenario: Go-look stands out from regular events
- **WHEN** a go_look event is displayed alongside regular orchestrator events
- **THEN** the `>>>` prefix SHALL visually distinguish it from the `-`, `~`, `!` prefixes used by regular events
