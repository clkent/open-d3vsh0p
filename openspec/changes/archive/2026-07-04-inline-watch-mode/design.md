## Context

The orchestrator runs multiple AI agents in parallel via the Claude Agent SDK. Each agent emits streaming events (assistant text, tool calls, results) through an `onEvent` callback. Currently these events flow through a single path:

```
agent-runner.js:80 (onEvent callback)
  → parallel-orchestrator.js:1445 (_createAgentOnEvent)
    → broadcast-server.js:68 (WebSocket broadcast)
      → watch.js (remote terminal client)
```

The `run` terminal only shows high-level orchestrator events (milestones, progress snapshots, microcycle thoughts) via `logger.js`. To see agent activity, you must open a second terminal and run `devshop watch`, which connects via WebSocket to port 3100.

The agent events are already in-process — the `onEvent` callback fires in the same Node.js process as `run`. The broadcast detour through WebSocket is unnecessary for local display.

### Current Event Flow (Key Files)

| File | Role | Line |
|------|------|------|
| `agent-runner.js` | Captures SDK events, calls `onEvent` | 79-80 |
| `parallel-orchestrator.js` | Creates `onEvent` via `_createAgentOnEvent()` | 1439-1456 |
| `broadcast-server.js` | WebSocket server, 50-event replay buffer | 68-87 |
| `watch.js` | WebSocket client, formats + prints events | 98-250 |
| `logger.js` | Console output for orchestrator events only | 45-62 |

### Event Types from SDK

The `sdk.query()` async iterator emits:
- `assistant` — Agent's text response (contains `message.content` with text blocks)
- `tool_use` — Agent invoking a tool (Bash, Edit, etc.)
- `tool_result` — Tool execution result
- `result` — Final result with cost, session ID, success/error status

`watch.js` currently displays only `assistant` and `result` events, ignoring `tool_use`/`tool_result` to avoid noise.

## Goals / Non-Goals

**Goals:**
- `devshop run my-app --watch` shows live agent activity inline — same terminal, no second process
- Shared formatting code between `watch.js` and inline display — one source of truth
- Default `run` behavior unchanged (clean output for CI/cron/background)

**Non-Goals:**
- Removing the broadcast server or `watch` command (needed for future web dashboard and multi-terminal use)
- Changing what events are displayed (same filtering as `watch.js` — assistant text + results)
- Adding log persistence for agent events (separate concern)

## Decisions

### 1. Inline display via `onEvent` callback (not WebSocket self-subscribe)

**Choice:** Modify `_createAgentOnEvent()` to optionally call a console formatter directly when `--watch` is enabled.

**Alternative considered:** Have `run.js` open a WebSocket connection to its own broadcast server. Rejected — adds latency, failure modes (port contention), and complexity for what is fundamentally an in-process console.log.

**Implementation:** `_createAgentOnEvent()` receives a `watchEnabled` flag (set from CLI options). When true, it calls `formatAgentEvent()` from the shared module before (or alongside) broadcasting.

### 2. Extract shared formatter module

**Choice:** Create `platform/orchestrator/src/infra/format-events.js` containing all event formatting functions currently in `watch.js`.

**Alternative considered:** Have `watch.js` import from a formatter and keep it as the canonical location. Rejected — `watch.js` is a command file, not a shared module. The formatter belongs in `infra/`.

**Functions to extract:**
- `formatEvent()` — Top-level dispatcher (agent/orchestrator/pair/riley)
- `formatAgentEvent()` — `[persona] (requirementId) text`
- `formatOrchestratorEvent()` — Milestones, progress, go-look
- `formatMilestoneEvent()` — Separator box with result/cost/diff
- `formatProgressEvent()` — Phase progress line
- `formatGoLookEvent()` — Preview alerts
- `formatPairEvent()`, `formatRileyEvent()` — Pair/Riley session events
- `extractAssistantText()` — Text extraction + 200-char truncation
- `formatEventContext()` — Helper for event metadata

`watch.js` becomes a thin WebSocket client that imports these formatters.

### 3. Flag naming: `--watch`

**Choice:** `--watch` flag on `run` command.

**Alternative considered:** `--verbose`, `--live`, `--stream`. `--watch` is the clearest parallel to the existing command name and intuitive meaning.

### 4. Orchestrator events in watch mode

When `--watch` is enabled, orchestrator events (milestones, progress) are already printed by `logger.js`. Agent events are the addition. No deduplication needed since they come from different sources (logger vs onEvent callback).

## Risks / Trade-offs

- **Console noise in parallel execution** — Multiple agents printing simultaneously could produce interleaved output. Mitigation: each line is prefixed with `[persona] (requirementId)` making it attributable. Lines are single-line (truncated at 200 chars).
- **Performance** — `console.log` in a hot event loop. Mitigation: agent events fire at human-readable pace (seconds between messages), not high-frequency. Negligible overhead.
- **Breaking change risk** — None. Default `run` behavior is unchanged. `--watch` is opt-in. `watch` command continues to work via broadcast.

## Open Questions

- Should `--watch` be persisted in project config so users don't have to pass it every time? Could add a `watch: true` default in project settings. Deferred — easy to add later without changing the core implementation.
