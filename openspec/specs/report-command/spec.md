# Report Command

## Purpose
Provides a CLI command for developers to queue bug reports and feature requests while the orchestrator is running, and a between-phase processor that dispatches reports to Morgan (bugs) or Riley (features) at the safe point between phases.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/commands/report.js` — CLI command for queuing reports
- `platform/orchestrator/src/report-processor.js` — between-phase queue consumer

## Requirements

### Report CLI Command
The system SHALL provide a `./devshop report <project-id>` CLI command that allows the developer to submit bug reports and feature requests while the orchestrator is running.

The command SHALL prompt the developer to select a report type: `bug` or `feature`.

The command SHALL prompt the developer for a description of the issue or feature.

The command SHALL append the report to the queue file at `active-agents/<project>/orchestrator/reported-issues.json`.

Each report entry SHALL include: `id` (UUID), `type` ("bug" or "feature"), `description` (developer's text), `createdAt` (ISO timestamp), and `status` ("pending").

The command SHALL confirm submission and display the report ID.

#### Scenario: Submit a bug report
- **WHEN** the developer runs `./devshop report garden-planner`, selects "bug", and describes "The /plants page throws a 500 error when no plants exist in the database"
- **THEN** the system SHALL append a report with `type: "bug"` and the description to `reported-issues.json` and display confirmation with the report ID

#### Scenario: Submit a feature request
- **WHEN** the developer selects "feature" and describes "Add a plant search feature with filtering by sun exposure and water needs"
- **THEN** the system SHALL append a report with `type: "feature"` and the description to `reported-issues.json`

#### Scenario: Queue file does not exist yet
- **WHEN** the developer submits a report and `reported-issues.json` does not exist
- **THEN** the system SHALL create the file with a JSON array containing the single report

#### Scenario: Queue file already has entries
- **WHEN** the developer submits a report and `reported-issues.json` already contains 2 pending reports
- **THEN** the system SHALL read the existing array, append the new report, and write the updated array back

### Report Queue File
The system SHALL store reports in `active-agents/<project>/orchestrator/reported-issues.json` as a JSON array.

Each entry SHALL have the shape: `{ id, type, description, createdAt, status, processedAt?, outcome?, error? }`.

The `status` field SHALL be one of: `pending`, `processing`, `completed`, `failed`.

#### Scenario: Queue file structure
- **WHEN** the queue file is read
- **THEN** it SHALL be a valid JSON array where each element has at minimum `id`, `type`, `description`, `createdAt`, and `status` fields

### Between-Phase Report Processing
The report processor SHALL be invoked by the orchestrator between phases, after phase completion and session branch push, but before parked-item triage.

The processor SHALL read the queue file and process all entries with `status: "pending"`.

Bug reports SHALL be processed before feature requests within a single between-phase window.

Each report SHALL be marked as `processing` before the agent runs and `completed` or `failed` after.

#### Scenario: Process pending bug reports
- **WHEN** the between-phase window is reached and the queue contains 2 pending bug reports
- **THEN** the processor SHALL invoke Morgan for each bug report sequentially, commit successful fixes, and mark each report as `completed` or `failed`

#### Scenario: Process pending feature requests
- **WHEN** the between-phase window is reached and the queue contains a pending feature request
- **THEN** the processor SHALL invoke Riley to create or update specs and roadmap items, commit changes, and mark the report as `completed`

#### Scenario: No pending reports
- **WHEN** the between-phase window is reached and the queue file has no pending entries (or does not exist)
- **THEN** the processor SHALL return immediately without invoking any agents

#### Scenario: Mixed bug and feature reports
- **WHEN** the queue contains both bug and feature reports
- **THEN** bug reports SHALL be processed first (all bugs, then all features)

### Bug Report Handler
For bug reports, the processor SHALL invoke Morgan with a diagnostic prompt that includes the developer's bug description, project context, and tech stack.

Morgan SHALL work on the session branch (same as the orchestrator's current branch).

After Morgan's fix, the processor SHALL run `npm test` to verify the fix does not break existing tests.

If tests pass, the fix SHALL be committed with message `fix: report <id> — <truncated description>`.

If tests fail, Morgan's changes SHALL be discarded (`git checkout . && git clean -fd`) and the report marked as `failed`.

#### Scenario: Morgan fixes the bug successfully
- **WHEN** Morgan's agent session produces changes and `npm test` passes afterward
- **THEN** the changes SHALL be committed and the report status set to `completed` with `outcome: "fixed"`

#### Scenario: Morgan's fix breaks tests
- **WHEN** Morgan's changes cause `npm test` to fail
- **THEN** the changes SHALL be discarded, the report status set to `failed` with `error: "fix broke existing tests"`, and the orchestrator SHALL continue to the next report

#### Scenario: Morgan cannot diagnose the issue
- **WHEN** Morgan's agent session completes without making any changes
- **THEN** the report status SHALL be set to `failed` with `error: "no fix produced"`

### Feature Request Handler
For feature requests, the processor SHALL invoke Riley with context about the current project state, roadmap progress, and the developer's feature description.

Riley SHALL create or modify spec files in `openspec/specs/` and update `openspec/roadmap.md` to include new items in appropriate future phases.

Riley SHALL NOT modify items in the currently executing or already-completed phases.

Changes SHALL be committed with message `feat: report <id> — <truncated description>`.

#### Scenario: Riley creates a new spec and roadmap entry
- **WHEN** Riley processes a feature request for a new capability
- **THEN** Riley SHALL create a spec file at `openspec/specs/<capability>/spec.md`, add roadmap items to a future phase, and commit the changes

#### Scenario: Riley adds to an existing spec
- **WHEN** the feature request describes an enhancement to an existing capability
- **THEN** Riley SHALL add requirements to the existing spec and add new roadmap items

#### Scenario: Riley places items in future phases only
- **WHEN** Riley updates the roadmap
- **THEN** new items SHALL only be added to phases that have not yet started execution (phases after the current one)

### Report Status Visibility
The developer SHALL be able to check report status via `./devshop report <project-id> --status`.

The status display SHALL show each report's ID, type, description (truncated), status, and processing outcome.

#### Scenario: Check report status
- **WHEN** the developer runs `./devshop report garden-planner --status`
- **THEN** the system SHALL display a table of all reports with their current status and outcomes
