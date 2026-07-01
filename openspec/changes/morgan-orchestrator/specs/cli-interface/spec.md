## MODIFIED Requirements

### Requirement: Run Command
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
