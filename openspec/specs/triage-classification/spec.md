# Triage Classification

## Purpose
Classifies parked (failed) roadmap items as BLOCKING or NON_BLOCKING for dependent phases, preventing the orchestrator from wasting budget on agents that will inevitably fail because their dependencies are missing. Also auto-parks `[HUMAN]` tagged items before agents run.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/parallel-orchestrator.js` — triage invocation, auto-park `[HUMAN]`, blocking check integration
- `platform/orchestrator/src/json-extractor.js` — shared JSON extraction utility used by triage parser
- `platform/orchestrator/src/roadmap-reader.js` — `[HUMAN]` flag parsing, `getParkedItemsInPhase()`, blocking filter in `getNextPhase()`
- `templates/agents/triage-agent/system-prompt.md` — Drew the triage specialist persona and classification rules
- `templates/agents/triage-agent/config.json` — read-only agent config (temperature 0.2, no tools)
- `platform/orchestrator/config/defaults.json` — triage agent budget ($0.25) and timeout (30s)

## Requirements

### `[HUMAN]` Item Detection
The roadmap parser SHALL detect `[HUMAN]` tagged items during parsing by checking if the item description contains the string `[HUMAN]`.

Items with `[HUMAN]` SHALL have `isHuman: true` set on the parsed item object.

#### Scenario: Item with `[HUMAN]` tag
- **WHEN** a roadmap item has description containing `[HUMAN]`
- **THEN** the parsed item SHALL have `isHuman: true`

#### Scenario: Item without `[HUMAN]` tag
- **WHEN** a roadmap item has a description that does not contain `[HUMAN]`
- **THEN** the parsed item SHALL have `isHuman: false`

### Auto-Park `[HUMAN]` Items
The parallel orchestrator SHALL auto-park `[HUMAN]` tagged items before executing any groups in a phase.

Auto-parked items SHALL be assigned `triageClassification: 'non_blocking'` immediately — no agent budget is wasted on them and they do not block dependent phases.

#### Scenario: `[HUMAN]` item in a phase
- **WHEN** `_executePhase` encounters a pending item with `isHuman: true`
- **THEN** the item SHALL be parked with reason `[HUMAN] tagged — requires manual intervention` and `triageClassification: 'non_blocking'`
- **AND** the item SHALL NOT be sent to any agent

#### Scenario: Mix of `[HUMAN]` and normal items
- **WHEN** a group contains both `[HUMAN]` and normal pending items
- **THEN** only the `[HUMAN]` items SHALL be auto-parked; normal items SHALL proceed to agent execution

### Parked Items in Phase
The roadmap reader SHALL provide a `getParkedItemsInPhase(phase)` method that returns all items with `status === 'parked'` from a given phase, augmented with group metadata.

#### Scenario: Phase with parked items
- **WHEN** `getParkedItemsInPhase(phase)` is called on a phase containing parked items
- **THEN** the result SHALL be an array of parked items, each with `groupLetter` and `groupLabel` properties

#### Scenario: Phase with no parked items
- **WHEN** `getParkedItemsInPhase(phase)` is called on a phase with no parked items
- **THEN** the result SHALL be an empty array

### Inline Triage at Park Time
The orchestrator SHALL run a lightweight triage classification immediately when an item is parked (inside `_parkItem()`), rather than waiting until phase end.

The inline triage SHALL call the triage agent for the single parked item and return the classification (`blocking` or `non_blocking`) to the caller so it can act immediately.

#### Scenario: Inline triage classifies as blocking
- **WHEN** an item is parked and inline triage runs
- **AND** the triage agent classifies it as `blocking`
- **THEN** `_parkItem()` SHALL return `{ classification: 'blocking' }` to the caller
- **AND** the parked entry SHALL have `triageClassification: 'blocking'` set immediately

#### Scenario: Inline triage classifies as non-blocking
- **WHEN** an item is parked and inline triage runs
- **AND** the triage agent classifies it as `non_blocking`
- **THEN** `_parkItem()` SHALL return `{ classification: 'non_blocking' }` to the caller
- **AND** the parked entry SHALL have `triageClassification: 'non_blocking'` set immediately

#### Scenario: Inline triage fails
- **WHEN** an item is parked and the inline triage agent fails or returns unparseable output
- **THEN** the classification SHALL default to `blocking` (fail-safe)
- **AND** `_parkItem()` SHALL return `{ classification: 'blocking' }` to the caller

#### Scenario: Inline triage skipped when no dependent phases
- **WHEN** an item is parked and no downstream phases depend on the current phase
- **THEN** inline triage SHALL still run because blocking classification now triggers the auto-fix flow regardless of phase dependencies

### Triage Agent Invocation
After a phase completes with parked items, the orchestrator SHALL invoke a triage agent to classify each unclassified parked item as BLOCKING or NON_BLOCKING, but only if dependent phases exist.

Items that were already classified by inline triage at park time SHALL be skipped during post-phase triage.

The triage agent receives the parked items with their failure reasons and the next phase's items, and outputs structured JSON with classifications.

#### Scenario: Parked items with dependent phases
- **WHEN** a phase completes with parked items and at least one downstream phase depends on it
- **THEN** the orchestrator SHALL invoke the triage agent with unclassified parked items and next phase items

#### Scenario: Parked items with no dependent phases
- **WHEN** a phase completes with parked items but no downstream phases depend on it
- **THEN** triage SHALL be skipped — there is nothing downstream to protect

#### Scenario: All parked items already classified
- **WHEN** all parked items in a phase already have `triageClassification` set (e.g. `[HUMAN]` items or inline-triaged items)
- **THEN** the triage agent SHALL NOT be invoked

#### Scenario: Mix of classified and unclassified items
- **WHEN** a phase completes with some items classified by inline triage and some unclassified
- **THEN** the triage agent SHALL only receive the unclassified items

### Triage Classification Storage
Triage results SHALL be persisted in the state machine's `requirements.parked` entries with `triageClassification` and `triageReason` fields.

#### Scenario: Triage agent returns valid classifications
- **WHEN** the triage agent returns `{ classifications: [{ id, classification, reason }] }`
- **THEN** each matching parked entry in state SHALL be updated with `triageClassification` (normalized to lowercase `blocking` or `non_blocking`) and `triageReason`

#### Scenario: Triage agent misses an item
- **WHEN** the triage agent's response does not include a classification for a parked item
- **THEN** that item SHALL be treated as `blocking` (fail-safe)

### Triage Response Parsing
The triage parser SHALL use the shared `extractJson()` utility to parse triage agent output, handling clean JSON, markdown-fenced JSON, and JSON embedded in surrounding prose text.

#### Scenario: Clean JSON response
- **WHEN** the triage agent returns a plain JSON object with `classifications` array
- **THEN** the parser SHALL parse it successfully and apply classifications

#### Scenario: JSON in markdown code fences
- **WHEN** the triage agent returns JSON wrapped in ``` or ```json fences
- **THEN** the parser SHALL extract the JSON from within the fences and parse it

#### Scenario: JSON embedded in prose
- **WHEN** the triage agent returns prose text containing a JSON object (e.g. "Based on my analysis: {\"classifications\": [...]}")
- **THEN** the parser SHALL find the first `{` and use brace-depth matching to extract the complete JSON object

#### Scenario: Unparseable response with debug logging
- **WHEN** the triage agent returns output that contains no valid JSON
- **THEN** the parser SHALL log the raw output (truncated to 2000 characters) at debug level before falling back to marking all items as blocking

#### Scenario: Valid JSON missing classifications key
- **WHEN** the triage agent returns valid JSON that does not contain a `classifications` array
- **THEN** the parser SHALL log the parsed object's keys at debug level and throw an error indicating the classifications array is missing

### Triage Prompt Format
The triage agent prompt SHALL show the expected output format as inline JSON without markdown code fences. The prompt SHALL NOT contain contradictory instructions (e.g. saying "no fences" while showing fenced examples).

#### Scenario: Prompt example format
- **WHEN** the triage agent system prompt is rendered
- **THEN** the example JSON SHALL appear as a single-line inline JSON object, not wrapped in markdown code fences

### Triage Fail-Safe
The system SHALL treat ALL parked items as BLOCKING if the triage agent fails, returns unparseable output, or if the triage template fails to load. This is the conservative fail-safe — blocking unnecessarily is better than proceeding into a broken phase.

#### Scenario: Triage agent returns invalid JSON
- **WHEN** the triage agent's output cannot be parsed as JSON (even after attempting to extract from code fences and prose)
- **THEN** all unclassified parked items SHALL be marked as `blocking`

#### Scenario: Triage agent invocation fails
- **WHEN** the triage agent returns `success: false`
- **THEN** all unclassified parked items SHALL be marked as `blocking` with reason `Triage agent failed`

#### Scenario: Triage template fails to load
- **WHEN** `renderAgentPrompt('triage-agent', ...)` throws an error
- **THEN** all unclassified parked items SHALL be marked as `blocking` with reason `Triage template failed to load`

### Blocking Check in Phase Progression
The `getNextPhase()` method SHALL accept an optional `blockingParkedIds` parameter (a Set of item IDs). Parked items in the blocking set SHALL be treated as unsatisfied — preventing dependent phases from starting.

#### Scenario: Blocking parked item prevents dependent phase
- **WHEN** Phase I has a parked item classified as `blocking` and Phase II depends on Phase I
- **THEN** `getNextPhase(roadmap, blockingIds)` SHALL NOT return Phase II

#### Scenario: Non-blocking parked item allows dependent phase
- **WHEN** Phase I has a parked item classified as `non_blocking` (not in blocking set) and Phase II depends on Phase I
- **THEN** `getNextPhase(roadmap, blockingIds)` SHALL return Phase II (parked non-blocking items are treated as satisfied)

#### Scenario: Empty blocking set preserves backward compatibility
- **WHEN** `getNextPhase(roadmap)` is called without a `blockingParkedIds` argument
- **THEN** the default empty set SHALL cause all parked items to be treated as satisfied (original behavior)

#### Scenario: All phases blocked
- **WHEN** blocking parked items prevent all remaining phases from starting
- **THEN** `getNextPhase` SHALL return null, the orchestrator SHALL log `no_ready_phases_blocked` with the blocking IDs, and the session SHALL end

### Triage Agent Configuration
The triage agent SHALL be configured as a lightweight, read-only agent with low temperature for deterministic classification.

#### Scenario: Triage agent defaults
- **WHEN** the triage agent is invoked
- **THEN** it SHALL use model `claude-sonnet-4-20250514`, max budget $0.25, timeout 30s, and no tools
