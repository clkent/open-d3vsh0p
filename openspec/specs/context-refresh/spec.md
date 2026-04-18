# Context Refresh for Interactive Sessions

## Purpose
Prevents context rot in long interactive sessions (talk, plan, pair) where accumulated conversation history can cause the agent to forget earlier instructions, constraints, or project context. Periodically re-injects key context (conventions, project state, role instructions) as system reminders during the conversation.

Addresses: **Context Rot (#5)**

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/agent-session.js` -- Updated chat method to inject context refreshers
- `platform/orchestrator/src/commands/talk.js` -- Passes refresh config
- `platform/orchestrator/src/commands/plan.js` -- Passes refresh config
- `platform/orchestrator/src/commands/pair.js` -- Passes refresh config

## Requirements

### Periodic Context Refresh
The AgentSession SHALL inject a context reminder into the conversation every N turns to reinforce key constraints that may have been pushed out of the agent's effective context window.

#### Scenario: Refresh triggers after configured interval
- **GIVEN** a pair session with Morgan, configured to refresh every 5 turns
- **WHEN** the 5th user message is sent
- **THEN** the chat method SHALL prepend a context reminder to the user message:
  ```
  [Context Reminder: You are Morgan, principal engineer. Project: garden-planner.
  Working directory: ~/projects/garden-planner.
  Key conventions: {summary of conventions}. Stay focused on the current task.]
  ```

#### Scenario: First few turns don't need refresh
- **GIVEN** a talk session with Riley
- **WHEN** turns 1 through 4 are processed
- **THEN** no context reminder SHALL be injected

#### Scenario: Refresh interval is configurable
- **WHEN** AgentSession is created with `contextRefreshInterval: 3`
- **THEN** context reminders SHALL be injected on turns 3, 6, 9, etc.

### Refresh Content
The context reminder SHALL include:
1. The agent's persona name and role (one sentence)
2. The project ID and working directory
3. A condensed conventions summary (first 500 characters of conventions.md)
4. The original task/goal if one was established in the first turn

#### Scenario: Conventions are long
- **GIVEN** a conventions.md file with 2000 characters
- **WHEN** a context reminder is built
- **THEN** only the first 500 characters of conventions SHALL be included, followed by "(see full conventions in project)"

#### Scenario: No conventions file exists
- **GIVEN** a project without openspec/conventions.md
- **WHEN** a context reminder is built
- **THEN** the conventions line SHALL be omitted

### Default Configuration
The default refresh interval SHALL be 5 turns for all interactive commands. This balances context freshness against the cost of slightly longer prompts.

#### Scenario: Default interval applies when not configured
- **WHEN** an interactive session starts without explicit refresh configuration
- **THEN** context refresh SHALL occur every 5 turns
