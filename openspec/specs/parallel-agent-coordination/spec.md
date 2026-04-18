# Parallel Agent Coordination

## Purpose
Gives parallel implementation agents awareness of what other agents in the same group are working on, reducing integration failures caused by agents building conflicting or duplicated code. Currently, parallel agents are completely blind to each other -- they only discover conflicts at merge time. This adds a lightweight coordination step.

Addresses: **Subagent Blindness (#9)**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/parallel-orchestrator.js` -- Updated to build coordination context for agent groups
- `platform/orchestrator/src/microcycle.js` -- Updated to accept and inject peer context
- `platform/orchestrator/src/openspec-reader.js` -- Updated `buildImplementationPrompt` to include peer context
- `templates/agents/_shared/parallel-awareness.md` -- New shared partial for coordination guidance

## Requirements

### Peer Context Injection
When launching parallel agents in a group, the orchestrator SHALL provide each agent with a summary of what the other agents in the same group are implementing.

#### Scenario: Two agents working in parallel
- **GIVEN** a group with two requirements: "user-auth" (assigned to Taylor) and "user-profile" (assigned to Jordan)
- **WHEN** the implementation prompt is built for Taylor
- **THEN** it SHALL include a section:
  ```
  ## Parallel Work (Other Agents)
  Another agent (Jordan) is simultaneously implementing "User Profile" in a separate worktree.
  Requirements: [bullets from user-profile requirement]

  Coordinate by: using stable interfaces, not modifying files the other agent is likely touching,
  and not creating conflicting exports or routes.
  ```

#### Scenario: Single agent in group (no peers)
- **GIVEN** a group with only one requirement
- **WHEN** the implementation prompt is built
- **THEN** no peer context section SHALL be included

#### Scenario: Three or more parallel agents
- **GIVEN** a group with requirements A, B, and C
- **WHEN** the prompt is built for agent A
- **THEN** it SHALL list both B and C as parallel work, with requirement names and bullet summaries

### Shared File Warning
The peer context SHALL identify files that multiple requirements are likely to touch (based on keyword overlap in requirement bullets), and warn agents to be careful with those files.

#### Scenario: Both requirements mention "routes" or "API"
- **GIVEN** requirement A mentions "Add GET /users endpoint" and requirement B mentions "Add POST /users endpoint"
- **WHEN** peer context is built
- **THEN** it SHALL include: "Likely shared files: route definitions, API handlers. Avoid conflicting route registrations."

#### Scenario: No keyword overlap
- **GIVEN** requirement A is about "email templates" and requirement B is about "database schema"
- **WHEN** peer context is built
- **THEN** no shared file warning SHALL be included

### Phase Context for Implementation Agents
The existing `phaseContext` (list of already-merged requirements in this phase) SHALL be made available to implementation agents, not just Morgan during review. This gives agents awareness of what code already exists from earlier group completions.

#### Scenario: Previous group already merged
- **GIVEN** Group A completed and merged "database-schema", and Group B is now starting
- **WHEN** Group B's agents receive their implementation prompt
- **THEN** it SHALL include: "Already completed this phase: database-schema. The code for this is already on the session branch."

### Parallel Awareness Partial
A new shared partial SHALL be added to implementation agent system prompts:

```
## Working in Parallel

Other agents may be working simultaneously on different requirements. To avoid conflicts:
- Don't modify shared entry points (index.ts, app.ts) unless your requirement specifically needs it
- Create new files rather than heavily modifying existing shared files
- Use explicit, descriptive exports -- don't rely on barrel files that others might also edit
- If you need to add a route, add it in a dedicated route file, not inline in the main router
```
