# Live Broadcast — Delta Spec (inline-watch-mode)

## Modified Requirements

### Shared Event Formatting Module
Event formatting functions previously defined in `watch.js` SHALL be extracted into `platform/orchestrator/src/infra/format-events.js`. The following functions SHALL be exported from the shared module:

- `formatEvent()` — top-level event dispatcher
- `formatAgentEvent()` — agent assistant text and result formatting
- `formatOrchestratorEvent()` — orchestrator event dispatcher
- `formatMilestoneEvent()` — milestone block formatting
- `formatProgressEvent()` — progress line formatting
- `formatGoLookEvent()` — go-look alert formatting
- `formatPairEvent()` — pair session event formatting
- `formatRileyEvent()` — Riley session event formatting
- `extractAssistantText()` — text extraction with 200-char truncation
- `formatEventContext()` — event metadata helper

#### Scenario: Watch command imports from shared module
- **WHEN** the `watch` command formats an event
- **THEN** it SHALL import formatting functions from `format-events.js` instead of defining them locally

#### Scenario: Formatting behavior unchanged
- **WHEN** an event is formatted by the shared module
- **THEN** the output SHALL be identical to the previous `watch.js` inline implementation
