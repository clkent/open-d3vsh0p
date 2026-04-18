# Realtime Updates

## Purpose
Provide live streaming of agent activity and orchestrator state through a WebSocket server, powering a web dashboard for project management and monitoring. The long-term vision includes a 3D visualization where agent characters work within project spaces. The implementation will live in the `platform/websocket/` directory, which currently exists but is empty.

## Status
PLANNED

## Requirements

### WebSocket Server
The system SHOULD provide a WebSocket server that streams orchestrator events to connected clients in real time.

#### Scenario: Client connects and receives current state
- **WHEN** a WebSocket client connects to the server
- **THEN** the system SHOULD send the current orchestrator state including active sessions, running agents, and recent events

#### Scenario: State transitions streamed live
- **WHEN** the orchestrator transitions between states during a microcycle
- **THEN** the system SHOULD emit an event to all connected clients with the new state, current requirement, and phase

#### Scenario: Agent output streamed
- **WHEN** an agent produces output during a run
- **THEN** the system SHOULD stream incremental output to connected clients so activity is visible in near real time

### Web Dashboard
The system SHOULD provide a web-based dashboard for managing projects and monitoring orchestrator activity.

#### Scenario: Project list displayed
- **WHEN** a user opens the dashboard
- **THEN** the system SHOULD display all registered projects with their status, active sessions, and recent activity

#### Scenario: Session monitoring view
- **WHEN** a user selects an active session in the dashboard
- **THEN** the system SHOULD display the live microcycle progress, current agent, requirement being worked on, and cost consumed

#### Scenario: Session control from dashboard
- **WHEN** a user clicks start, stop, or resume on a session in the dashboard
- **THEN** the system SHOULD invoke the corresponding API endpoint and reflect the updated state in real time

### Real-Time Agent Activity Visualization
The system SHOULD visualize agent activity so users can see what each agent is doing at a glance.

#### Scenario: Active agents shown with current task
- **WHEN** agents are running across one or more projects
- **THEN** the dashboard SHOULD display each active agent with its role, project, current task, and elapsed time

#### Scenario: Agent completion and handoff visible
- **WHEN** an agent completes its task and the orchestrator transitions to the next phase
- **THEN** the dashboard SHOULD animate the transition, showing the handoff from one agent to the next

### 3D World Visualization (Long-Term Vision)
The system SHOULD eventually support a 3D Sims-type visualization where agent characters work within project environments.

#### Scenario: Project spaces rendered as physical environments
- **WHEN** the 3D view is active
- **THEN** each project SHOULD be represented as a distinct physical space (e.g., an office, a workshop) that agents move through

#### Scenario: Agent characters perform visible work
- **WHEN** an agent is running a task in the orchestrator
- **THEN** the corresponding 3D character SHOULD animate activity that reflects the type of work (e.g., typing for implementation, inspecting for review)

#### Scenario: Multiple projects visible simultaneously
- **WHEN** multiple projects have active sessions
- **THEN** the 3D world SHOULD show all project spaces with their respective agent characters, allowing the user to navigate between them
