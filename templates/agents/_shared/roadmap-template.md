### Complete Roadmap Example

Below is a complete roadmap for a fictional "TaskFlow" project demonstrating all rules above:

```markdown
# Roadmap: TaskFlow

## Phase I: Spikes
### Group A: Technical Validation
- [ ] `spike-websocket-scale` — [SPIKE] Validate WebSocket server handles 500 concurrent connections with sub-100ms latency

### Group Z: User Testing
- [ ] `test-phase-1` — [HUMAN] Review spike findings and confirm architecture decisions before implementation begins

## Phase II: Foundation
<!-- depends: Phase I -->

### Group A: Data Layer
- [ ] `task-schema` — Database schema for tasks with title, status, assignee, due date, and priority fields
- [ ] `user-auth` — Email/password authentication with JWT token issuance and refresh
- [ ] `team-schema` — Team membership model with roles (admin, member) and invite flow

### Group B: Human Setup
- [ ] `get-smtp-credentials` — [HUMAN] Obtain SMTP credentials for transactional email service

### Group Z: User Testing
- [ ] `test-phase-2` — [HUMAN] Verify auth flow: register at /signup, confirm JWT returned, refresh token works, invalid credentials rejected

## Phase III: Core Features
<!-- depends: Phase II -->

### Group A: Task Management
- [ ] `task-create-form` — Create task form with title, description, priority picker, and due date selector
- [ ] `task-list-view` — Filterable task list with status tabs, priority badges, and assignee avatars
- [ ] `task-detail-page` — Task detail view with edit-in-place, activity log, and status transitions
- [ ] `task-assignment` — Assign tasks to team members with autocomplete search and notification trigger

### Group B: Real-time Updates
- [ ] `websocket-server` — WebSocket connection manager with authentication and room-based subscriptions
- [ ] `task-live-sync` — Broadcast task mutations to connected clients for instant UI updates
- [ ] `presence-indicators` — Show online team members and who is viewing each task

### Group Z: User Testing
- [ ] `test-phase-3` — [HUMAN] Create a task at /tasks/new, assign to a team member, open in second browser, confirm real-time update appears within 2 seconds

## Phase IV: Polish
<!-- depends: Phase III -->

### Group A: Notifications
- [ ] `email-notifications` — Transactional emails for task assignment, due date reminders, and mentions
- [ ] `in-app-notifications` — Notification bell with unread count, mark-as-read, and notification preferences

### Group B: Search & Filtering
- [ ] `full-text-search` — Search tasks by title and description with ranked results and highlighting
- [ ] `saved-filters` — Save and name custom filter combinations for quick access from sidebar

### Group Z: User Testing
- [ ] `test-phase-4` — [HUMAN] Assign a task to yourself, verify email arrives, check in-app notification appears, search for the task by partial title, confirm result highlights match
```
