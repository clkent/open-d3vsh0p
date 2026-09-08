# CLI Interface

## Purpose
Provides the command-line entry point for the DevShop orchestrator. Parses commands and options, resolves projects from the registry, validates directories, and dispatches to the appropriate command handler. Supports commands for the full development workflow: kickoff, run, plan, talk, pair, status, schedule, cadence, action, recover, security, api, and help.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/index.js` -- main CLI entry point with argument parsing, project resolution, and command dispatch
- `platform/orchestrator/src/commands/run.js` -- run command handler that spawns Morgan as a Claude Code CLI session
- `platform/orchestrator/src/commands/status.js` -- status command handler displaying roadmap and session information
## Requirements
### Requirement: Commands
The system SHALL support the following commands: `kickoff`, `run`, `plan`, `talk`, `pair`, `status`, `schedule`, `cadence`, `action`, `recover`, `security`, `api`, and `help`. The command SHALL be the first positional argument. An unrecognized command SHALL print an error message, display usage information, and exit with code 1.

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

### Requirement: Option Parsing
The system SHALL parse CLI options using `node:util` `parseArgs` with options including: `--budget` (string, default "30", consumed only by the `security` command as an enforced scan budget), `--resume` (boolean, default false), `--fresh` (boolean, default false), `--dry-run` (boolean, default false), `--no-auto-resume` (boolean, default false), `--remote-control` (boolean, default false), `--requirements` (string), `--window` (string), and `--port` (string, used by the `api` command, default 3200). Requirements SHALL be split by comma into an array of trimmed strings. The config SHALL expose `autoResume: true` unless `--no-auto-resume` is provided. The system SHALL NOT accept a `--time-limit` option and SHALL NOT derive a session time limit for the `run` command.

#### Scenario: No time limit option
- **WHEN** CLI options are parsed
- **THEN** no `--time-limit` option SHALL exist and the run config SHALL contain no `timeLimitMs`

#### Scenario: Budget applies to security only
- **WHEN** `--budget 5` is provided with the `security` command
- **THEN** the security scan SHALL use $5.00 as its enforced budget cap; the `run` command SHALL ignore `--budget`

#### Scenario: Requirements comma-separated
- **WHEN** `--requirements "user-auth, payment-flow"` is provided
- **THEN** config.requirements SHALL be `["user-auth", "payment-flow"]` (split by comma, each trimmed)

#### Scenario: No requirements specified
- **WHEN** --requirements is not provided
- **THEN** config.requirements SHALL be null

#### Scenario: Resume flag
- **WHEN** `--resume` is provided
- **THEN** config.resume SHALL be true

#### Scenario: Auto-resume enabled by default
- **WHEN** `--no-auto-resume` is not provided
- **THEN** config.autoResume SHALL be true

#### Scenario: Auto-resume opt-out
- **WHEN** `--no-auto-resume` is provided
- **THEN** config.autoResume SHALL be false

#### Scenario: Remote Control flag
- **WHEN** `--remote-control` is provided with `run`, `talk`, `pair`, or `kickoff`
- **THEN** config.remoteControl SHALL be true regardless of the `remoteControl.enabled` config value

### Requirement: Run Command
The system SHALL spawn Morgan (Principal Engineer) as a persistent Claude Code CLI session when the `run` command is executed. The run command SHALL manage the session lifecycle: acquire run lock, create session branch, render and pass the orchestration prompt, spawn Morgan CLI, and consolidate to main after Morgan exits.

If no roadmap exists, the system SHALL exit with an error directing the user to run `devshop kickoff` first.

The command SHALL print a session header (project name, directory) before spawning Morgan. The header SHALL NOT include budget or time-limit lines.

The run SHALL have no session time limit: it continues until Morgan exits (and the limit-aware resume loop declines to respawn), the operator stops it, or — for windowed runs only — the window end time is reached.

After Morgan exits, the command SHALL consolidate the session branch to main via PR if any items were completed (detected by comparing roadmap state before and after the session).

The exit code SHALL be 0 on normal completion and 1 when parked items remain.

#### Scenario: Run spawns Morgan CLI
- **WHEN** `run` is executed and `roadmap.md` exists in the project directory
- **THEN** the system SHALL render the orchestration prompt, spawn `claude` CLI with `--append-system-prompt`, and wait for Morgan to exit

#### Scenario: No roadmap exits with error
- **WHEN** `run` is executed and no `roadmap.md` exists
- **THEN** the system SHALL print an error directing the user to run `devshop kickoff` first and exit with code 1

#### Scenario: Session header output
- **WHEN** `run` is executed
- **THEN** the system SHALL print a header block with Project (name and id) and Directory before spawning Morgan, with no Budget or Time limit lines

#### Scenario: Resume flag passes to Morgan
- **WHEN** `run` is executed with `--resume` and a saved session ID exists
- **THEN** the system SHALL pass `--resume {sessionId}` to the `claude` CLI instead of `--append-system-prompt`

#### Scenario: No time-based termination on plain runs
- **WHEN** `run` is executed without `--window` and Morgan's session runs for any duration
- **THEN** the system SHALL NOT terminate the `claude` CLI process based on elapsed time

#### Scenario: Post-session consolidation
- **WHEN** Morgan's CLI session exits and the roadmap has newly completed items compared to pre-session state
- **THEN** the system SHALL push the session branch, create a PR, wait for CI, and merge to main

#### Scenario: Registry updated after run
- **WHEN** the run command completes
- **THEN** it SHALL update `project.lastSessionId` in the registry and call `saveRegistry`

#### Scenario: Window flag enables autonomous mode
- **WHEN** `run` is executed with `--window morning`
- **THEN** the system SHALL include autonomous mode instructions in Morgan's prompt, telling Morgan to work without waiting for user input

### Requirement: Status Command
The system SHALL display project status including roadmap progress and active session state. It SHALL always return exit code 0.

#### Scenario: Roadmap progress display
- **WHEN** `status` is executed and a roadmap.md exists
- **THEN** the system SHALL parse the roadmap and display total items, completed count (from `[x]` checkboxes), pending count, and parked count (from `[!]` markers)

#### Scenario: No roadmap found
- **WHEN** `status` is executed and no roadmap.md exists
- **THEN** the system SHALL display `Roadmap: Not found — run devshop kickoff first`

#### Scenario: Active session state display
- **WHEN** `status` is executed and a state.json exists in `active-agents/{project}/orchestrator/`
- **THEN** the system SHALL display session ID, state, branch, current working requirement (if any), completed/pending/parked counts, cost, and invocation count

#### Scenario: Active agents display
- **WHEN** `status` is executed and state.json contains a non-empty `activeAgents` array
- **THEN** the system SHALL display each active agent's persona, group label, and requirement ID

#### Scenario: No active session
- **WHEN** `status` is executed and no state.json exists
- **THEN** the system SHALL display `Session: No active session`

### Requirement: Project Resolution
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

### Requirement: Config Assembly
The system SHALL assemble a config object from the resolved project and parsed CLI options, containing: `projectId`, `projectDir`, `githubRepo`, `resume`, `dryRun`, `requirements`, `remoteControl` (true when `--remote-control` was passed, otherwise null so the configuration layer decides), `templatesDir` (pointing to `templates/agents/`), and `activeAgentsDir` (pointing to `active-agents/{projectId}/`). The config SHALL NOT contain `budgetLimitUsd` or `timeLimitMs`.

#### Scenario: Templates directory resolution
- **WHEN** the config is assembled
- **THEN** `templatesDir` SHALL resolve to `{devshopRoot}/templates/agents`

#### Scenario: Active agents directory resolution
- **WHEN** the config is assembled for project "my-app"
- **THEN** `activeAgentsDir` SHALL resolve to `{devshopRoot}/active-agents/my-app`

#### Scenario: No budget or time fields
- **WHEN** the config is assembled for the `run` command
- **THEN** it SHALL NOT include `budgetLimitUsd` or `timeLimitMs`

#### Scenario: Remote Control not requested
- **WHEN** the config is assembled without `--remote-control`
- **THEN** `remoteControl` SHALL be null and the effective value SHALL come from `loadConfig`

### Requirement: Fatal Error Handling
The system SHALL catch unhandled errors from the main function, print `Fatal error: {message}` to stderr, and exit with code 2. When the `DEBUG` environment variable is set, it SHALL also print the full stack trace.

#### Scenario: Unhandled error
- **WHEN** an unexpected error occurs during command execution
- **THEN** the system SHALL print the error message to stderr and exit with code 2

#### Scenario: Debug mode stack trace
- **WHEN** an error occurs and `process.env.DEBUG` is set
- **THEN** the full stack trace SHALL be printed to stderr in addition to the error message

