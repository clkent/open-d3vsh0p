## Why

Seeing live agent activity during `devshop run` requires opening a second terminal and running `devshop watch`. This is friction — the orchestrator already has the SDK events in-process via the `onEvent` callback, but only forwards them to a WebSocket broadcast server. Most users just want to see what agents are doing in the same terminal they started the run from.

## What Changes

- **`--watch` flag on the `run` command**: When set, the orchestrator prints condensed agent activity (assistant text, completions, errors) inline alongside existing progress output. Off by default to keep CI/background runs clean.
- **Shared event formatter module**: Extract `formatAgentEvent`, `formatMilestoneEvent`, `formatProgressEvent`, `formatGoLookEvent`, and `extractAssistantText` from `watch.js` into a shared `format-events.js` module. Both `watch.js` and the inline display use the same formatting.
- **Inline display via `onEvent` callback**: Modify `_createAgentOnEvent()` in `parallel-orchestrator.js` to optionally print formatted events to console in addition to broadcasting. No WebSocket round-trip needed.
- **Broadcast server becomes optional**: The broadcast server still starts for remote/web clients, but is no longer the only way to see agent output. No removal — the `realtime-updates` roadmap item depends on it.

## Capabilities

### New Capabilities
- `inline-watch-mode`: `--watch` flag on the `run` command that displays live agent activity inline in the same terminal, using shared event formatting

### Modified Capabilities
- `live-broadcast`: Event formatting functions extracted into shared module; broadcast server unchanged but no longer sole consumer of agent events
- `cli-interface`: `run` command gains `--watch` flag

## Impact

- `platform/orchestrator/src/commands/run.js` — Parse `--watch` flag, pass to orchestrator
- `platform/orchestrator/src/commands/watch.js` — Import formatters from shared module instead of defining locally
- `platform/orchestrator/src/parallel-orchestrator.js` — `_createAgentOnEvent()` gains optional console output path
- `platform/orchestrator/src/infra/format-events.js` — New shared module extracted from watch.js
- `platform/orchestrator/src/index.js` — Add `--watch` to CLI option parsing
- No new dependencies. `ws` package stays for broadcast server and watch client.
