# Project Management

## Purpose
Manages project registration, lookup, and directory isolation so the orchestrator can operate on multiple independent projects with separate working directories and agent state.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/index.js` — CLI entry point, project registry loading, and directory validation
- `project-registry.json` — persistent project registry with metadata

## Requirements

### Project Registry Structure
The system SHALL maintain a `project-registry.json` file at the DevShop root containing a `projects` array where each entry has the fields: `id`, `name`, `projectDir`, `githubRepo`, `registeredAt`, and `status`.

The `id` field SHALL be a unique string identifier used for CLI lookups (e.g., `proj-000-test-app`).

The `projectDir` field SHALL be an absolute path to the project's working directory (e.g., `~/projects/test-app`).

The `githubRepo` field SHALL be a string or null for projects without a remote repository.

The `status` field SHALL indicate the project's current state (e.g., `active`).

#### Scenario: Valid registry lookup
- **WHEN** the CLI receives a projectId positional argument
- **THEN** the system SHALL load `project-registry.json`, find the project with matching `id`, and use its `projectDir` and `githubRepo` for the session

#### Scenario: Unknown project ID
- **WHEN** the CLI receives a projectId that does not exist in the registry
- **THEN** the system SHALL print an error with the unknown ID, list all available projects with their IDs and names, and exit with code 1

#### Scenario: Registry persistence
- **WHEN** the `saveRegistry(registry)` function is called
- **THEN** the system SHALL write the registry object as formatted JSON (2-space indent with trailing newline) to the registry file path

### Project Isolation
The system SHALL isolate each project's working directory and agent state into separate filesystem paths.

Project working directories SHALL reside under `~/projects/` (as configured per project in the registry).

Agent state SHALL be stored under `active-agents/{projectId}/` relative to the DevShop root, with an `orchestrator/` subdirectory for state.json and logs.

#### Scenario: Active agents directory per project
- **WHEN** a session starts for project `proj-000-test-app`
- **THEN** the system SHALL set `activeAgentsDir` to `{DEVSHOP_ROOT}/active-agents/proj-000-test-app` and create `orchestrator/` and `orchestrator/logs/` subdirectories within it

#### Scenario: Multiple projects do not interfere
- **WHEN** sessions are run for two different project IDs
- **THEN** each session SHALL use its own `active-agents/{projectId}/orchestrator/state.json` and logs directory, with no shared mutable state

### Directory Validation
The system SHALL validate that a project's working directory exists on the filesystem before starting any operation.

#### Scenario: Valid project directory
- **WHEN** the project's `projectDir` exists and is accessible
- **THEN** the system SHALL proceed to dispatch the requested command

#### Scenario: Missing project directory
- **WHEN** `fs.access(project.projectDir)` fails
- **THEN** the system SHALL print "Project directory not found: {path}" and exit with code 1

#### Scenario: Registry file missing
- **WHEN** `project-registry.json` cannot be read or parsed
- **THEN** the system SHALL throw a fatal error and exit with code 2

### Project Starter Template
The system SHALL provide a project starter template at `templates/project-starter/` containing scaffolding files for new projects.

The starter template SHALL include at minimum: `.gitignore`, `README.md`, `package.json`, and `src/index.js`.

#### Scenario: Template contents available
- **WHEN** a new project is initialized using the starter template
- **THEN** the template directory SHALL contain `.gitignore`, `README.md`, `package.json`, and `src/index.js` as scaffolding files

#### Scenario: Template directory location
- **WHEN** the orchestrator resolves template paths
- **THEN** agent prompt templates SHALL be loaded from `{DEVSHOP_ROOT}/templates/agents/` (separate from the project starter at `{DEVSHOP_ROOT}/templates/project-starter/`)
