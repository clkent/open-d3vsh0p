# Persistence Layer

## Purpose
Provide structured, queryable storage for project metadata, session history, agent metrics, and cost tracking. This replaces the current approach of flat JSON files with a persistence layer that supports historical queries, aggregation, and efficient retrieval. The implementation will live in the `platform/database/` directory, which currently exists but is empty.

## Status
PLANNED

## Requirements

### Project Metadata Storage
The system SHOULD store project metadata in a structured format that supports efficient queries beyond what flat JSON files provide.

#### Scenario: Project data persisted with full history
- **WHEN** a project is created or updated
- **THEN** the system SHOULD store the project record with timestamps and retain previous versions for audit purposes

#### Scenario: Projects queryable by status and attributes
- **WHEN** a query is made for projects matching specific criteria (e.g., status "active", created after a date)
- **THEN** the system SHOULD return matching projects without loading the entire registry into memory

### Session History
The system SHOULD maintain a queryable history of all orchestrator sessions with their outcomes, costs, and timelines.

#### Scenario: Session records stored with outcomes
- **WHEN** a session completes or is stopped
- **THEN** the system SHOULD persist a session record including start time, end time, requirements attempted, requirements completed, requirements parked, and total cost

#### Scenario: Session history queryable by project and date range
- **WHEN** a query is made for sessions belonging to a project within a date range
- **THEN** the system SHOULD return matching session records ordered by start time

### Agent Metrics and Cost Tracking
The system SHOULD track per-agent metrics and costs over time to support the monthly behavior audit and cost review cadences.

#### Scenario: Agent invocation metrics recorded
- **WHEN** an agent completes a run
- **THEN** the system SHOULD record the agent role, project, duration, cost, token usage, and outcome (success, failure, retry)

#### Scenario: Cost aggregation by project and time period
- **WHEN** a cost report is requested for a project over a time period
- **THEN** the system SHOULD return aggregated costs broken down by agent role and phase

#### Scenario: Agent performance trends queryable
- **WHEN** a performance trend query is made for a specific agent role
- **THEN** the system SHOULD return metrics such as approval rate, average retry count, and cost per requirement over time

### Migration from JSON Files
The system SHOULD provide a migration path from the current JSON file approach to the structured persistence layer.

#### Scenario: Existing data migrated to new storage
- **WHEN** the migration tool is run
- **THEN** the system SHOULD read existing JSON files (project-registry.json, session summaries, run logs) and import them into the persistence layer without data loss

#### Scenario: Backward-compatible fallback
- **WHEN** the persistence layer is unavailable
- **THEN** the system SHOULD fall back to reading and writing JSON files, ensuring the orchestrator can still function
