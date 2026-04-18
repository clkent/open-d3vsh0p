# Spike Phases

## Purpose
Provides a structured mechanism for investigating technical unknowns before committing to full implementation. When Riley identifies genuine uncertainty during kickoff (unfamiliar APIs, novel algorithms, architectural bets), she creates `[SPIKE]` items in a dedicated first phase. Morgan investigates each spike, produces findings, and the orchestrator auto-pauses for human review.

## Status
IMPLEMENTED

## Requirements

### Spike Detection in Roadmap
The system SHALL detect `[SPIKE]` tags in roadmap item descriptions and set an `isSpike` flag on the parsed item, mirroring the existing `[HUMAN]` tag detection pattern.

#### Scenario: Spike item detection
- **WHEN** a roadmap item has `[SPIKE]` in its description
- **THEN** the parsed item SHALL have `isSpike: true`

#### Scenario: Non-spike item
- **WHEN** a roadmap item does not have `[SPIKE]` in its description
- **THEN** the parsed item SHALL have `isSpike: false`

### Spike Phase Identification
The system SHALL provide an `isSpikePhase(phase)` method that returns true when all pending items in the phase are spikes.

#### Scenario: All-spike phase
- **WHEN** a phase has pending items and all of them have `isSpike: true`
- **THEN** `isSpikePhase()` SHALL return `true`

#### Scenario: Mixed phase
- **WHEN** a phase has both spike and non-spike pending items
- **THEN** `isSpikePhase()` SHALL return `false`

#### Scenario: No pending items
- **WHEN** a phase has no pending items
- **THEN** `isSpikePhase()` SHALL return `false`

### Spike Execution
The system SHALL execute `[SPIKE]` items using direct agent invocation (not the microcycle), running sequentially on the session branch without worktrees.

#### Scenario: Spike agent invocation
- **WHEN** a `[SPIKE]` item is executed
- **THEN** the orchestrator SHALL render the `spike-agent` system prompt with `SPIKE_ID` and `SPIKE_DESCRIPTION` variables, and invoke `agentRunner.runAgent()` with the `config.agents.spike` settings

#### Scenario: Spike findings output
- **WHEN** a spike investigation completes successfully
- **THEN** the agent SHALL have produced `openspec/spikes/<spike-id>/findings.md` containing Question, Findings, Recommendation, and optional POC evidence

#### Scenario: Spike item completion
- **WHEN** a spike investigation succeeds
- **THEN** the item SHALL be marked complete in the roadmap and findings committed to the session branch

#### Scenario: Spike item failure
- **WHEN** a spike investigation fails
- **THEN** the item SHALL be parked with triage classification

### Spike Phase Auto-Pause
The system SHALL auto-pause after completing a spike-only phase with `stopReason: 'spike_review_pending'`.

#### Scenario: Spike phase completion
- **WHEN** a spike-only phase completes (all spike items executed)
- **THEN** the orchestrator SHALL push the session branch, log a `spike_phase_complete` event, print spike findings paths to console, and complete the session with `stopReason: 'spike_review_pending'`

#### Scenario: Resume after spike review
- **WHEN** the user resumes with `--resume` after reviewing spike findings
- **THEN** the orchestrator SHALL continue from the next phase (implementation phases)

### Spike Items in Mixed Phases
The system SHALL execute spike items before normal implementation items when both exist in the same phase.

#### Scenario: Mixed phase execution order
- **WHEN** a phase contains both `[SPIKE]` and non-spike pending items
- **THEN** spike items SHALL be executed first via `_executeSpikeItems()`, then filtered out of group items before normal group execution proceeds

### Spike Agent Template
The system SHALL provide a `spike-agent` template with a system prompt focused on technical investigation.

#### Scenario: Spike agent prompt content
- **WHEN** the spike-agent system prompt is rendered
- **THEN** it SHALL instruct Morgan to investigate a specific technical question, produce a findings.md file, and optionally create throwaway POC code

#### Scenario: Spike agent config
- **WHEN** the spike-agent config.json is read
- **THEN** it SHALL contain `role: "spike"` and `name: "Morgan"`

### PM Spike Guidance
Riley's kickoff and brain-dump prompts SHALL include guidance on when to create spike items and the `[SPIKE]` tag format.

#### Scenario: Spike creation criteria
- **WHEN** Riley evaluates project features for uncertainty
- **THEN** she SHALL create `[SPIKE]` items only for genuine unknowns: unfamiliar APIs, novel algorithms, architectural bets requiring prototyping

#### Scenario: Spike limits
- **WHEN** Riley creates spike items
- **THEN** there SHALL be no more than 3 spike items per project, and they SHALL be placed in the first phase
