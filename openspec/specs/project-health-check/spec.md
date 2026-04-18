# Project Health Check

## Purpose
Provides a pre-work health check gate that verifies a project's baseline (tests pass, build succeeds) before dispatching agents, with automated repair via Morgan and interactive pair-mode fallback.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/health-checker.js` — health check runner with auto-detection and configurable commands
- `platform/orchestrator/src/parallel-orchestrator.js` — orchestrator integration (`_runHealthCheckGate`, `_handleProjectRepair`, `_projectRepairPairFallback`)
- `templates/agents/principal-engineer/project-repair-prompt.md` — Morgan's repair prompt template
- `platform/orchestrator/config/defaults.json` — default health check configuration

## Requirements

### Health Check Execution
The orchestrator SHALL execute a set of verification commands against the project after session branch creation and before dispatching any spec work to agents.

Each command SHALL be executed as a shell command in the project directory. The health check SHALL capture the exit code, stdout, and stderr of each command.

A command SHALL be considered passing if its exit code is 0, and failing if its exit code is non-zero or if execution times out.

The health check SHALL be considered passing only if ALL configured commands pass. If any command fails, the health check SHALL be considered failing.

#### Scenario: All health check commands pass
- **WHEN** the orchestrator runs the health check and all configured commands exit with code 0
- **THEN** the orchestrator SHALL proceed to `SELECTING_REQUIREMENT` and begin normal phase execution

#### Scenario: One health check command fails
- **WHEN** the orchestrator runs the health check and one command exits with a non-zero code
- **THEN** the orchestrator SHALL capture the failing command's stdout and stderr and transition to `PROJECT_REPAIR`

#### Scenario: Health check command times out
- **WHEN** a health check command does not complete within the configured timeout
- **THEN** the orchestrator SHALL kill the process, treat the command as failed, and transition to `PROJECT_REPAIR`

#### Scenario: Multiple commands with mixed results
- **WHEN** the health check runs two commands and the first passes but the second fails
- **THEN** the health check SHALL be considered failing, and the output of the failing command SHALL be captured for the repair flow

### Health Check Command Configuration
The health check commands SHALL be configurable per-project via the project configuration (`.devshop.json` or project registry entry) under a `healthCheck` field.

The configuration SHALL support:
- `commands`: An array of shell command strings to execute (e.g., `["npm test", "npm run build"]`)
- `timeoutMs`: Per-command timeout in milliseconds (default: 120000)

If no `healthCheck` configuration is provided, the orchestrator SHALL attempt auto-detection by reading the project's `package.json` (if present):
- If a `test` script exists, include `npm test`
- If a `build` script exists, include `npm run build`

If no `package.json` exists or it contains no `test` or `build` scripts, and no explicit configuration is provided, the orchestrator SHALL skip the health check and proceed normally.

#### Scenario: Explicit health check configuration
- **WHEN** the project config contains `healthCheck.commands: ["pytest", "mypy src/"]`
- **THEN** the orchestrator SHALL execute `pytest` and `mypy src/` as health check commands, ignoring any `package.json` auto-detection

#### Scenario: Auto-detection from package.json
- **WHEN** no `healthCheck` config exists and the project's `package.json` has `scripts.test: "jest"` and `scripts.build: "next build"`
- **THEN** the orchestrator SHALL use `["npm test", "npm run build"]` as health check commands

#### Scenario: Auto-detection with test only
- **WHEN** no `healthCheck` config exists and the project's `package.json` has `scripts.test: "jest"` but no `scripts.build`
- **THEN** the orchestrator SHALL use `["npm test"]` as the sole health check command

#### Scenario: No configuration and no package.json
- **WHEN** no `healthCheck` config exists and no `package.json` is found in the project directory
- **THEN** the orchestrator SHALL skip the health check entirely and proceed to phase execution

#### Scenario: Custom timeout
- **WHEN** the project config contains `healthCheck.timeoutMs: 300000`
- **THEN** each health check command SHALL be allowed up to 300 seconds before being killed

### Health Check Runs Only on Fresh Sessions
The health check SHALL run only on `--fresh` session starts. Resumed sessions (`--resume`) SHALL skip the health check.

#### Scenario: Fresh session triggers health check
- **WHEN** the orchestrator starts with `--fresh` and health check commands are configured or auto-detected
- **THEN** the orchestrator SHALL run the health check before dispatching spec work

#### Scenario: Resumed session skips health check
- **WHEN** the orchestrator starts with `--resume` and an existing session state is found
- **THEN** the orchestrator SHALL skip the health check and continue from the persisted state

### Project Repair via Morgan
When the health check fails, the orchestrator SHALL invoke Morgan (principal engineer) via `AgentSession.chat()` to attempt an automated repair.

Morgan SHALL receive the full output (stdout + stderr) of all failing health check commands as context.

Morgan SHALL operate on the session branch (not main directly) to make repair changes.

After Morgan completes, the orchestrator SHALL re-run the full health check to verify the repair.

If the health check passes after Morgan's repair, the orchestrator SHALL commit Morgan's changes and proceed to `SELECTING_REQUIREMENT`.

If the health check fails after Morgan's repair, the orchestrator SHALL discard Morgan's changes (via `git checkout . && git clean -fd`) and proceed to pair-mode fallback.

Morgan SHALL receive a single repair attempt. The orchestrator SHALL NOT retry Morgan on failure.

#### Scenario: Morgan successfully repairs the project
- **WHEN** the health check fails and Morgan makes changes that cause all health check commands to pass on re-run
- **THEN** the orchestrator SHALL commit Morgan's changes to the session branch, log the repair, and transition to `SELECTING_REQUIREMENT`

#### Scenario: Morgan cannot repair the project
- **WHEN** the health check fails and Morgan's changes do not result in all health check commands passing
- **THEN** the orchestrator SHALL discard Morgan's changes, log the failure, and transition to pair-mode fallback

#### Scenario: Morgan's session errors out
- **WHEN** Morgan's `AgentSession.chat()` throws an error
- **THEN** the orchestrator SHALL log the error and proceed to pair-mode fallback without discarding any files (Morgan may not have made changes)

### Pair-Mode Fallback for Failed Repair
When Morgan cannot repair the project, the orchestrator SHALL drop into interactive pair mode, presenting the health check failure output to the user.

The pair-mode prompt SHALL display:
- Which health check commands failed
- The captured output of each failing command
- Instructions to fix the issues and exit pair mode

After pair mode exits, the orchestrator SHALL re-run the health check. If it passes, the orchestrator SHALL proceed to `SELECTING_REQUIREMENT`. If it fails, the orchestrator SHALL transition to `SESSION_COMPLETE`.

#### Scenario: User fixes the issue in pair mode
- **WHEN** the user fixes the baseline in pair mode and the post-pair health check passes
- **THEN** the orchestrator SHALL proceed to `SELECTING_REQUIREMENT` and begin normal spec work

#### Scenario: User exits pair mode without fixing
- **WHEN** the user exits pair mode and the post-pair health check still fails
- **THEN** the orchestrator SHALL transition to `SESSION_COMPLETE` with reason `health_check_failed`

### Health Check Logging
The orchestrator SHALL log health check events with the following event types:
- `health_check_started`: Logged when the health check begins, with the list of commands to run
- `health_check_passed`: Logged when all commands pass
- `health_check_failed`: Logged when any command fails, with the failing command and truncated output
- `project_repair_started`: Logged when Morgan is invoked for repair
- `project_repair_succeeded`: Logged when Morgan's repair passes the re-check
- `project_repair_failed`: Logged when Morgan's repair does not pass the re-check

#### Scenario: Health check pass is logged
- **WHEN** all health check commands pass
- **THEN** the orchestrator SHALL log `health_check_passed` with the number of commands run and total elapsed time

#### Scenario: Health check failure is logged with output
- **WHEN** a health check command fails
- **THEN** the orchestrator SHALL log `health_check_failed` with the command string, exit code, and the first 2000 characters of stderr
