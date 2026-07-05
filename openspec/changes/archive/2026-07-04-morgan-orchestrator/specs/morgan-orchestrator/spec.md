## ADDED Requirements

### Requirement: Morgan CLI Session for Run Command
The system SHALL spawn Morgan (Principal Engineer) as a persistent Claude Code CLI session when the `run` command is executed, replacing the current SDK-based isolated agent spawning model.

The system SHALL render a Morgan orchestration prompt template containing: project context (ID, directory, GitHub repo, tech stack), the full roadmap content, conventions, and instructions for working through the roadmap sequentially.

The system SHALL pass the rendered prompt via `--append-system-prompt` to the `claude` CLI process, with `stdio: 'inherit'` for direct user interaction.

#### Scenario: Run spawns Morgan CLI
- **WHEN** `./devshop run my-project` is executed
- **THEN** the system SHALL spawn a `claude` CLI process with the orchestration prompt as the system prompt, working directory set to the project directory, and a session name of `Morgan — {projectId}`

#### Scenario: Morgan receives full project context
- **WHEN** Morgan's CLI session starts
- **THEN** the system prompt SHALL contain the project ID, project directory, GitHub repo, tech stack, full roadmap.md content, and conventions.md content

#### Scenario: Interactive mode
- **WHEN** the user types input during a Morgan run session
- **THEN** the input SHALL be delivered to Morgan via the inherited stdio, allowing real-time interaction

### Requirement: Roadmap-Driven Sequential Execution
Morgan SHALL work through the roadmap sequentially, reading phase dependencies and group structure to determine the order of work.

Morgan's orchestration prompt SHALL instruct Morgan to: read the roadmap, identify the next pending phase (respecting dependency order), work through each group's items, run tests after each item, commit after each item, and mark items complete in roadmap.md by changing `[ ]` to `[x]`.

#### Scenario: Morgan processes phases in dependency order
- **WHEN** Morgan reads a roadmap with Phase I (no deps) and Phase II (depends: Phase I)
- **THEN** Morgan SHALL complete all pending items in Phase I before starting Phase II

#### Scenario: Morgan marks items complete
- **WHEN** Morgan finishes implementing a roadmap item and tests pass
- **THEN** Morgan SHALL edit roadmap.md to change the item's checkbox from `[ ]` to `[x]` and commit the change

#### Scenario: Morgan skips completed items
- **WHEN** Morgan reads the roadmap and finds items marked `[x]`
- **THEN** Morgan SHALL skip those items and proceed to the next pending item

#### Scenario: Morgan handles parked items
- **WHEN** Morgan encounters an item marked `[!]` (parked)
- **THEN** Morgan SHALL attempt to implement it unless it is tagged `[HUMAN]`, in which case Morgan SHALL skip it

### Requirement: Sub-Agent Delegation for Parallel Groups
Morgan SHALL have the ability to delegate work to sub-agents when a phase contains multiple independent groups.

Morgan's orchestration prompt SHALL instruct Morgan to use the Claude Code Agent tool with `isolation: "worktree"` to spawn sub-agents for parallel group work, providing each sub-agent with a specific, scoped brief based on Morgan's understanding of the codebase.

#### Scenario: Morgan delegates parallel groups
- **WHEN** Morgan encounters a phase with Group A and Group B, both with pending items
- **THEN** Morgan MAY spawn sub-agents via the Agent tool to work on the groups in parallel, providing each with a targeted implementation brief

#### Scenario: Morgan writes scoped briefs
- **WHEN** Morgan delegates work to a sub-agent
- **THEN** Morgan SHALL include in the brief: the specific files to create or modify, the patterns to follow from existing code, the tests to write, and clear boundaries of what NOT to touch

#### Scenario: Morgan reviews sub-agent output
- **WHEN** a sub-agent completes its work
- **THEN** Morgan SHALL review the changes before marking the items complete, fixing any issues or inconsistencies with the broader codebase

#### Scenario: Morgan does simple work itself
- **WHEN** a phase has only one group or the items are simple enough to implement directly
- **THEN** Morgan SHALL implement the items directly rather than delegating to sub-agents

### Requirement: Session Persistence and Resume
The system SHALL save Morgan's Claude session ID after each CLI exit and support resuming the session on the next `run` invocation.

The roadmap SHALL serve as the source of truth for progress — completed items are marked `[x]`, and Morgan reads the roadmap on resume to determine what work remains.

#### Scenario: Session ID saved after run
- **WHEN** Morgan's CLI session exits
- **THEN** the system SHALL save the Claude session ID to `{activeAgentsDir}/orchestrator/run-session.json`

#### Scenario: Resume with --resume flag
- **WHEN** `./devshop run my-project --resume` is executed and a saved session ID exists
- **THEN** the system SHALL pass `--resume {sessionId}` to the `claude` CLI, restoring Morgan's conversation history

#### Scenario: Fresh run reads roadmap state
- **WHEN** `./devshop run my-project` is executed without `--resume`
- **THEN** the system SHALL spawn a fresh Morgan session, and Morgan SHALL read the roadmap to determine which items are already complete

### Requirement: Autonomous Mode for Scheduler
Morgan SHALL operate autonomously when invoked by the scheduler, making decisions independently without waiting for user input.

The system SHALL include a flag or context in Morgan's prompt indicating autonomous mode when a `--window` flag is present, instructing Morgan to proceed without asking questions.

#### Scenario: Scheduled run is autonomous
- **WHEN** `./devshop run my-project --window morning` is executed by the scheduler
- **THEN** Morgan's system prompt SHALL include instructions to work autonomously without waiting for user input

#### Scenario: Autonomous Morgan commits and marks progress
- **WHEN** Morgan completes an item in autonomous mode
- **THEN** Morgan SHALL commit, mark the item complete in roadmap.md, and proceed to the next item without pausing

#### Scenario: Autonomous Morgan respects budget limits
- **WHEN** Morgan's system prompt includes budget and time constraints
- **THEN** Morgan SHALL monitor its progress and stop gracefully when approaching the limits, leaving remaining items for the next session

### Requirement: Run Lifecycle Wrapper
The `run.js` command handler SHALL manage the session lifecycle around Morgan's CLI session: lock acquisition, session branch creation, Morgan spawn, and post-session consolidation.

#### Scenario: Pre-session setup
- **WHEN** the `run` command starts
- **THEN** the system SHALL acquire a run lock, create a session branch from main, and apply any window/schedule configuration before spawning Morgan

#### Scenario: Post-session consolidation
- **WHEN** Morgan's CLI session exits and completed items exist
- **THEN** the system SHALL consolidate the session branch to main via a PR (push, create PR, wait for CI, merge)

#### Scenario: Lock released on exit
- **WHEN** Morgan's CLI session exits (normally or via error)
- **THEN** the system SHALL release the run lock in a finally block

#### Scenario: Budget and time enforcement
- **WHEN** the configured `timeLimitMs` elapses during Morgan's session
- **THEN** the system SHALL terminate the `claude` CLI process to enforce the time limit

### Requirement: Morgan Orchestration Prompt Template
The system SHALL provide a prompt template at `templates/agents/principal-engineer/run-prompt.md` that instructs Morgan on the orchestration workflow.

The template SHALL include: role description (Morgan as orchestrator), roadmap content, conventions, phase/group execution rules, sub-agent delegation guidelines, commit and test conventions, roadmap marking instructions, and budget/time awareness.

#### Scenario: Template rendered with project context
- **WHEN** the run command prepares Morgan's prompt
- **THEN** it SHALL render the template with variables for PROJECT_ID, PROJECT_DIR, GITHUB_REPO, TECH_STACK, ROADMAP_CONTENT, CONVENTIONS, BUDGET_USD, TIME_LIMIT_HOURS, and AUTONOMOUS_MODE

#### Scenario: Template includes delegation instructions
- **WHEN** Morgan reads its system prompt
- **THEN** it SHALL find instructions on when to delegate to sub-agents (multiple independent groups) vs. when to implement directly (single group or simple items)
