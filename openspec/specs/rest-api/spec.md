# REST API

## Purpose
Provide an HTTP API for managing DevShop projects, sessions, and agent invocations programmatically. This enables the web dashboard and external tooling to interact with the orchestrator without direct CLI access. The implementation will live in the `platform/api/` directory, which currently exists but is empty.

## Status
IMPLEMENTED

## Requirements

### Project CRUD Endpoints
The system SHOULD expose RESTful endpoints for creating, reading, updating, and deleting projects in the project registry.

#### Scenario: List all projects
- **WHEN** a GET request is made to `/api/projects`
- **THEN** the system SHOULD return a JSON array of all registered projects with their ID, name, directory, and status

#### Scenario: Get a single project
- **WHEN** a GET request is made to `/api/projects/:id`
- **THEN** the system SHOULD return the full project details including its OpenSpec requirements summary

#### Scenario: Create a new project
- **WHEN** a POST request is made to `/api/projects` with a valid project name and configuration
- **THEN** the system SHOULD create the project directory, initialize it from the starter template, register it in the project registry, and return the new project record

#### Scenario: Delete a project
- **WHEN** a DELETE request is made to `/api/projects/:id`
- **THEN** the system SHOULD remove the project from the registry and optionally archive its directory

### Session Management Endpoints
The system SHOULD expose endpoints for starting, stopping, resuming, and querying orchestrator sessions.

#### Scenario: Start a new session
- **WHEN** a POST request is made to `/api/projects/:id/sessions` with optional budget and time limits
- **THEN** the system SHOULD start an orchestrator session for that project and return the session ID

#### Scenario: Get session status
- **WHEN** a GET request is made to `/api/projects/:id/sessions/:sessionId`
- **THEN** the system SHOULD return the current session state, progress, cost consumed, and active requirement

#### Scenario: Stop a running session
- **WHEN** a POST request is made to `/api/projects/:id/sessions/:sessionId/stop`
- **THEN** the system SHOULD trigger a graceful shutdown of the session, completing the current phase before stopping

#### Scenario: Resume an interrupted session
- **WHEN** a POST request is made to `/api/projects/:id/sessions/:sessionId/resume`
- **THEN** the system SHOULD resume the session from its last persisted checkpoint

### Agent Invocation Endpoints
The system SHOULD expose endpoints for triggering individual agent runs outside of a full orchestrator session.

#### Scenario: Invoke an agent directly
- **WHEN** a POST request is made to `/api/projects/:id/agents/:role/invoke` with a task description
- **THEN** the system SHOULD spawn the specified agent role for the project and return the run result

### Run Logs and Summary Retrieval
The system SHOULD expose endpoints for retrieving structured run logs and session summaries.

#### Scenario: Retrieve session run log
- **WHEN** a GET request is made to `/api/projects/:id/sessions/:sessionId/logs`
- **THEN** the system SHOULD return the JSONL run log entries for that session

#### Scenario: Retrieve session summary
- **WHEN** a GET request is made to `/api/projects/:id/sessions/:sessionId/summary`
- **THEN** the system SHOULD return the session summary JSON including completed requirements, parked items, and cost totals

### Health Check and System Status
The system SHOULD expose a health check endpoint for monitoring.

#### Scenario: Health check returns system status
- **WHEN** a GET request is made to `/api/health`
- **THEN** the system SHOULD return the platform version, uptime, number of active sessions, and overall system health

### Authentication and Authorization
The system SHOULD require authentication for all API endpoints to prevent unauthorized access.

#### Scenario: Unauthenticated request rejected
- **WHEN** a request is made without a valid authentication token
- **THEN** the system SHOULD return a 401 Unauthorized response

#### Scenario: Valid token grants access
- **WHEN** a request is made with a valid API token in the Authorization header
- **THEN** the system SHOULD process the request normally
