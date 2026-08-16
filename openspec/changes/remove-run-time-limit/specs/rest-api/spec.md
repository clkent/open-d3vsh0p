# REST API — Delta

## MODIFIED Requirements

### Requirement: Session Management Endpoints
The system SHOULD expose endpoints for starting, stopping, resuming, and querying orchestrator sessions.

#### Scenario: Start a new session
- **WHEN** a POST request is made to `/api/projects/:id/sessions`
- **THEN** the system SHOULD start an orchestrator session for that project and return the session ID, with no budget or time-limit parameters

#### Scenario: Get session status
- **WHEN** a GET request is made to `/api/projects/:id/sessions/:sessionId`
- **THEN** the system SHOULD return the current session state, progress, cost consumed, and active requirement

#### Scenario: Stop a running session
- **WHEN** a POST request is made to `/api/projects/:id/sessions/:sessionId/stop`
- **THEN** the system SHOULD trigger a graceful shutdown of the session, completing the current phase before stopping

#### Scenario: Resume an interrupted session
- **WHEN** a POST request is made to `/api/projects/:id/sessions/:sessionId/resume`
- **THEN** the system SHOULD resume the session from its last persisted checkpoint
