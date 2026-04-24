# Tasks: inline-watch-mode

## 1. Extract shared event formatter

- [x] Create `platform/orchestrator/src/infra/format-events.js` — extract `formatEvent`, `formatAgentEvent`, `formatOrchestratorEvent`, `formatMilestoneEvent`, `formatProgressEvent`, `formatGoLookEvent`, `formatPairEvent`, `formatRileyEvent`, `extractAssistantText`, `formatEventContext` from `watch.js`
- [x] Update `platform/orchestrator/src/commands/watch.js` — replace local formatting functions with imports from `format-events.js`, keep WebSocket client logic
- [x] Add tests for `format-events.js` — verify `formatAgentEvent` output for assistant and result events, `extractAssistantText` truncation at 200 chars, `formatMilestoneEvent` block structure

## 2. Add --watch flag to CLI

- [x] Add `--watch` boolean option to `parseArgs` in `platform/orchestrator/src/index.js`
- [x] Pass `watch` flag through config to `run.js` and into `ParallelOrchestrator`
- [x] Update help text in `index.js` — add `--watch` with description "Show live agent activity inline"

## 3. Wire inline display into orchestrator

- [x] Modify `_createAgentOnEvent()` in `parallel-orchestrator.js` — accept `watchEnabled` parameter; when true, call `formatAgentEvent()` from shared module to print to console in addition to broadcasting
- [x] Ensure `_createAgentOnEvent()` returns a callback even when broadcast server is not running if `watchEnabled` is true (currently returns `undefined` when no broadcast server)
- [x] Add tests — `_createAgentOnEvent` with `watchEnabled: true` calls formatter, with `watchEnabled: false` does not

## 4. Verify

- [x] Run full test suite — 1237 tests pass, no regressions
- [ ] Manual test: `./devshop run <project> --watch` shows agent text inline; without `--watch` shows only orchestrator events
