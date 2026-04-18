# Integration Quality Gates

## Purpose
Provides integration validation at natural checkpoints in the orchestrator flow: after each merge to the session branch, after each phase completes, and during code reviews. Catches regressions caused by parallel work merging together.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/parallel-orchestrator.js` — `_runPostMergeSmokeTest()`, `_runPhaseGate()`, `_runDiagnosticFix()`, phase context threading
- `platform/orchestrator/src/openspec-reader.js` — `buildReviewPrompt()` with phase context
- `platform/orchestrator/src/microcycle.js` — `phaseContext` constructor parameter

## Requirements

### Requirement: Post-Merge Smoke Test
After a requirement merges to the session branch, the system SHALL run the project's test suite on the session branch (inside the merge lock) to detect regressions introduced by the merge.

The smoke test SHALL reuse `runHealthCheck()` from `health-checker.js` with the test commands only (not build).

If the smoke test fails, the system SHALL attempt a Morgan diagnostic fix on the session branch. If the fix succeeds and tests pass, the merge is accepted. If the fix fails, the item SHALL be parked with reason indicating the merge caused a regression.

The smoke test SHALL have a 120-second timeout to prevent blocking the merge lock indefinitely.

#### Scenario: Merge passes smoke test
- **WHEN** a requirement merges to the session branch and `npm test` passes on the session branch
- **THEN** the system SHALL proceed normally (mark complete, log milestone)

#### Scenario: Merge fails smoke test, Morgan fixes it
- **WHEN** a requirement merges and `npm test` fails on the session branch, and Morgan's diagnostic fix succeeds
- **THEN** the system SHALL commit the fix, re-run tests to confirm, and proceed with the merge accepted

#### Scenario: Merge fails smoke test, Morgan cannot fix
- **WHEN** a requirement merges and `npm test` fails on the session branch, and Morgan's fix attempt fails
- **THEN** the system SHALL park the item with reason `post-merge regression: <test output summary>` and log `post_merge_smoke_failed`

#### Scenario: Smoke test timeout
- **WHEN** `npm test` exceeds 120 seconds during the post-merge smoke test
- **THEN** the system SHALL treat it as a failure and attempt the Morgan fix path

### Requirement: Phase Gate Health Check
After all groups in a phase complete and before the session branch is pushed, the system SHALL run a full health check (tests + build) on the session branch to validate cross-group integration.

The phase gate SHALL reuse `runHealthCheck()` from `health-checker.js` with the same configuration used at session start.

If the phase gate fails, the system SHALL attempt `_runProjectDiagnostic(phase)` to fix integration issues. If the diagnostic succeeds and the health check passes on retry, the phase gate is satisfied. If the diagnostic fails or the retry fails, the system SHALL log a warning and proceed to the next phase (non-blocking).

#### Scenario: Phase gate passes
- **WHEN** all groups in a phase complete and the health check passes on the session branch
- **THEN** the system SHALL log `phase_gate_passed` and proceed to push the session branch and start the next phase

#### Scenario: Phase gate fails, diagnostic fixes it
- **WHEN** the phase gate health check fails, and `_runProjectDiagnostic(phase)` succeeds, and the retry health check passes
- **THEN** the system SHALL log `phase_gate_fixed` with the diagnostic details and proceed

#### Scenario: Phase gate fails, diagnostic cannot fix
- **WHEN** the phase gate health check fails and the diagnostic fails or the retry health check still fails
- **THEN** the system SHALL log `phase_gate_failed` as a warning and proceed to the next phase without blocking

#### Scenario: Phase gate skipped when no items merged
- **WHEN** a phase completes but no requirements were merged (all items were parked or already complete)
- **THEN** the system SHALL skip the phase gate health check

### Requirement: Review Context Enrichment
When Morgan reviews a requirement, the review prompt SHALL include a summary of other requirements that have already merged in the current phase, so Morgan can identify incompatibilities between parallel work.

The context SHALL be derived from `completedMicrocycles` in the state machine, filtered to items whose IDs appear in the current phase's groups.

The context SHALL be injected into the review prompt as a "## Other Work Merged This Phase" section listing each merged requirement's ID and description.

#### Scenario: Review with phase context
- **WHEN** Morgan reviews requirement C and requirements A and B have already merged in the same phase
- **THEN** the review prompt SHALL include a section listing A and B with their descriptions

#### Scenario: Review with no prior merges in phase
- **WHEN** Morgan reviews the first requirement in a phase (no other merges yet)
- **THEN** the review prompt SHALL omit the phase context section entirely

#### Scenario: Review context excludes other phases
- **WHEN** Morgan reviews a Phase III requirement and Phase II had 5 merged items
- **THEN** the review prompt SHALL NOT include Phase II items — only items from Phase III
