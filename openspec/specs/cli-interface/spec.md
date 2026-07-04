# CLI Interface

## Purpose
Provides the command-line entry point for the DevShop orchestrator. Parses commands and options, resolves projects from the registry, validates directories, and dispatches to the appropriate command handler. Supports commands for the full development workflow: run, plan, talk, report, status, watch, and help.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/index.js` -- main CLI entry point with argument parsing, project resolution, and command dispatch
- `platform/orchestrator/src/commands/run.js` -- run command handler with roadmap-based parallel execution
- `platform/orchestrator/src/commands/status.js` -- status command handler displaying roadmap, session, and summary information
- `platform/orchestrator/src/commands/watch.js` -- watch command handler connecting to broadcast server and displaying real-time events

## Requirements

### Commands
The system SHALL support the following commands: `run`, `plan`, `talk`, `report`, `status`, `watch`, and `help` (among others). The command SHALL be the first positional argument. An unrecognized command SHALL print an error message, display usage information, and exit with code 1.

#### Scenario: Valid command dispatch
- **WHEN** `node src/index.js run my-project` is executed
- **THEN** the system SHALL dispatch to the `runCommand` handler with the resolved project and config

#### Scenario: Unknown command
- **WHEN** `node src/index.js deploy my-project` is executed
- **THEN** the system SHALL print `Unknown command: deploy`, display usage, and exit with code 1

#### Scenario: No command provided
- **WHEN** `node src/index.js` is executed with no arguments
- **THEN** the system SHALL print usage information and exit with code 0 (treated as help)

#### Scenario: Help command
- **WHEN** `node src/index.js help` is executed
- **THEN** the system SHALL print usage showing all commands, options, and examples, then exit with code 0

### Option Parsing
The system SHALL parse CLI options using `node:util` `parseArgs` with the following options: `--budget` (string, default "30"), `--time-limit` (string, default "7"), `--resume` (boolean, default false), `--dry-run` (boolean, default false), `--requirements` (string), and `--status` (boolean, default false). Budget SHALL be parsed as USD float. Time limit SHALL be parsed as hours and converted to milliseconds (multiplied by 3,600,000). Requirements SHALL be split by comma into an array of trimmed strings.

#### Scenario: Default budget and time limit
- **WHEN** no --budget or --time-limit options are provided
- **THEN** config.budgetLimitUsd SHALL be 30.0 and config.timeLimitMs SHALL be 25,200,000 (7 * 3,600,000)

#### Scenario: Custom budget
- **WHEN** `--budget 10` is provided
- **THEN** config.budgetLimitUsd SHALL be 10.0

#### Scenario: Custom time limit in hours
- **WHEN** `--time-limit 4` is provided
- **THEN** config.timeLimitMs SHALL be 14,400,000 (4 * 3,600,000)

#### Scenario: Requirements comma-separated
- **WHEN** `--requirements "user-auth, payment-flow"` is provided
- **THEN** config.requirements SHALL be `["user-auth", "payment-flow"]` (split by comma, each trimmed)

#### Scenario: No requirements specified
- **WHEN** --requirements is not provided
- **THEN** config.requirements SHALL be null

#### Scenario: Resume flag
- **WHEN** `--resume` is provided
- **THEN** config.resume SHALL be true

### Run Command
The system SHALL spawn Morgan (Principal Engineer) as a persistent Claude Code CLI session when the `run` command is executed. The run command SHALL manage the session lifecycle: acquire run lock, create session branch, render and pass the orchestration prompt, spawn Morgan CLI, and consolidate to main after Morgan exits.

If no roadmap exists, the system SHALL exit with an error directing the user to run `devshop kickoff` first.

The command SHALL print a session header (project name, directory, budget, time limit) before spawning Morgan.

After Morgan exits, the command SHALL consolidate the session branch to main via PR if any items were completed (detected by comparing roadmap state before and after the session).

The exit code SHALL be 0 if Morgan exited normally, 1 if the session was terminated by timeout.

#### Scenario: Run spawns Morgan CLI
- **WHEN** `run` is executed and `roadmap.md` exists in the project directory
- **THEN** the system SHALL render the orchestration prompt, spawn `claude` CLI with `--append-system-prompt`, and wait for Morgan to exit

#### Scenario: No roadmap exits with error
- **WHEN** `run` is executed and no `roadmap.md` exists
- **THEN** the system SHALL print an error directing the user to run `devshop kickoff` first and exit with code 1

#### Scenario: Session header output
- **WHEN** `run` is executed
- **THEN** the system SHALL print a header block with Project (name and id), Directory, Budget, and Time limit before spawning Morgan

#### Scenario: Resume flag passes to Morgan
- **WHEN** `run` is executed with `--resume` and a saved session ID exists
- **THEN** the system SHALL pass `--resume {sessionId}` to the `claude` CLI instead of `--append-system-prompt`

#### Scenario: Time limit enforcement
- **WHEN** the configured `timeLimitMs` elapses during Morgan's session
- **THEN** the system SHALL terminate the `claude` CLI process

#### Scenario: Post-session consolidation
- **WHEN** Morgan's CLI session exits and the roadmap has newly completed items compared to pre-session state
- **THEN** the system SHALL push the session branch, create a PR, wait for CI, and merge to main

#### Scenario: Registry updated after run
- **WHEN** the run command completes
- **THEN** it SHALL update `project.lastSessionId` in the registry and call `saveRegistry`

#### Scenario: Window flag enables autonomous mode
- **WHEN** `run` is executed with `--window morning`
- **THEN** the system SHALL include autonomous mode instructions in Morgan's prompt, telling Morgan to work without waiting for user input

### Status Command
The system SHALL display project status including roadmap progress, active session state, and the latest session summary. It SHALL always return exit code 0.

#### Scenario: Roadmap progress display
- **WHEN** `status` is executed and a roadmap.md exists
- **THEN** the system SHALL parse the roadmap and display total items, completed count (from `[x]` checkboxes), pending count, and parked count (from `[!]` markers)

#### Scenario: No roadmap found
- **WHEN** `status` is executed and no roadmap.md exists
- **THEN** the system SHALL display `Roadmap: Not found — run devshop kickoff first`

#### Scenario: Active session state display
- **WHEN** `status` is executed and a state.json exists in `active-agents/{project}/orchestrator/`
- **THEN** the system SHALL display session ID, state, branch, current working requirement (if any), completed/pending/parked counts, cost, and invocation count

#### Scenario: Parallel mode active agents display
- **WHEN** `status` is executed and state.json contains a non-empty `activeAgents` array
- **THEN** the system SHALL display each active agent's persona, group label, and requirement ID

#### Scenario: No active session
- **WHEN** `status` is executed and no state.json exists
- **THEN** the system SHALL display `Session: No active session`

#### Scenario: Latest session summary display
- **WHEN** `status` is executed and the logs directory contains summary files
- **THEN** the system SHALL read the last (alphabetically sorted) `*-summary.json` file and display its session ID, cost, completed count, parked count, and remaining count

#### Scenario: No logs directory
- **WHEN** `status` is executed and no logs directory exists
- **THEN** the system SHALL silently skip the latest session section without error

### Project Resolution
The system SHALL resolve projects by looking up the `projectId` positional argument in `project-registry.json`. It SHALL validate that the project exists in the registry and that the project directory is accessible on disk.

#### Scenario: Project found in registry
- **WHEN** a valid projectId matching a registry entry is provided
- **THEN** the system SHALL extract `projectDir`, `githubRepo`, `name`, and `id` from the registry entry and build the config

#### Scenario: Project not found in registry
- **WHEN** an unknown projectId is provided
- **THEN** the system SHALL print `Project "{id}" not found in project-registry.json`, list all available projects (as `  - {id} ({name})`), and exit with code 1

#### Scenario: No projects in registry
- **WHEN** an unknown projectId is provided and the registry has no projects
- **THEN** the system SHALL print `No projects registered.` and exit with code 1

#### Scenario: Project directory not accessible
- **WHEN** the projectId is found but `project.projectDir` does not exist on disk
- **THEN** the system SHALL print `Project directory not found: {path}` and exit with code 1

#### Scenario: Project ID required for non-help commands
- **WHEN** `node src/index.js run` is executed without a project ID
- **THEN** the system SHALL print `Error: project-id is required`, display usage, and exit with code 1

### Config Assembly
The system SHALL assemble a config object from the resolved project and parsed CLI options, containing: `projectId`, `projectDir`, `githubRepo`, `budgetLimitUsd`, `timeLimitMs`, `resume`, `dryRun`, `requirements`, `templatesDir` (pointing to `templates/agents/`), and `activeAgentsDir` (pointing to `active-agents/{projectId}/`).

#### Scenario: Templates directory resolution
- **WHEN** the config is assembled
- **THEN** `templatesDir` SHALL resolve to `{devshopRoot}/templates/agents`

#### Scenario: Active agents directory resolution
- **WHEN** the config is assembled for project "my-app"
- **THEN** `activeAgentsDir` SHALL resolve to `{devshopRoot}/active-agents/my-app`

### Fatal Error Handling
The system SHALL catch unhandled errors from the main function, print `Fatal error: {message}` to stderr, and exit with code 2. When the `DEBUG` environment variable is set, it SHALL also print the full stack trace.

#### Scenario: Unhandled error
- **WHEN** an unexpected error occurs during command execution
- **THEN** the system SHALL print the error message to stderr and exit with code 2

#### Scenario: Debug mode stack trace
- **WHEN** an error occurs and `process.env.DEBUG` is set
- **THEN** the full stack trace SHALL be printed to stderr in addition to the error message

### Watch Command
The system SHALL support a `watch` command that connects to a running orchestrator session's broadcast server and displays agent activity in real time.

The command SHALL accept a project ID as a positional argument and an optional `--port` flag (default 3100).

#### Scenario: Watch connects to active session
- **WHEN** `./devshop watch my-project` is executed and a broadcast server is running on port 3100
- **THEN** the system SHALL connect via WebSocket and begin printing events to the terminal

#### Scenario: Watch with custom port
- **WHEN** `./devshop watch my-project --port 3200` is executed
- **THEN** the system SHALL connect to `ws://localhost:3200`

#### Scenario: No active session
- **WHEN** `./devshop watch my-project` is executed and no broadcast server is running
- **THEN** the system SHALL print "No active session for my-project. Start one with: ./devshop run my-project" and exit with code 1

#### Scenario: Session ends while watching
- **WHEN** the WebSocket connection closes because the orchestrator session completed
- **THEN** the watch command SHALL print "Session ended." and exit with code 0

### Watch Terminal Output
The watch command SHALL format broadcast events for terminal readability.

Agent events SHALL show the persona name, requirement ID, and message content.

Orchestrator events SHALL show the event type with contextual data, using level-appropriate indicators.

#### Scenario: Agent assistant message displayed
- **WHEN** an agent event with `type: "assistant"` is received for persona "Jordan" on requirement "user-auth"
- **THEN** the terminal SHALL display the persona name, requirement, and the assistant's text content

#### Scenario: Orchestrator phase event displayed
- **WHEN** an orchestrator event with eventType "phase_started" is received
- **THEN** the terminal SHALL display the phase information with an info-level indicator

#### Scenario: Review result displayed
- **WHEN** an orchestrator event with eventType "review_approved" is received
- **THEN** the terminal SHALL display the review outcome with the requirement ID
