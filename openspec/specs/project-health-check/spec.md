# Project Health Check

## Purpose
Provides a preflight health check that verifies a project's baseline (tests pass, build succeeds) inside the `run` command before Morgan's CLI session spawns. A failing baseline never blocks the run — instead the failure output is injected into Morgan's prompt so repairing the baseline becomes his first task. Pair mode remains the interactive path for fixing a broken baseline by hand.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/quality/health-checker.js` — health check runner with auto-detection and configurable commands
- `platform/orchestrator/src/commands/run.js` — `runPreflightHealthCheck()` preflight integration in the run command
- `templates/agents/principal-engineer/run-prompt.md` — Morgan's run prompt template with the `{{HEALTH_STATUS}}` variable
- `platform/orchestrator/config/defaults.json` — default health check configuration

## Requirements

### Health Check Execution
The run command SHALL execute a set of verification commands against the project before spawning Morgan's CLI session.

Each command SHALL be executed as a shell command in the project directory with a clean environment. The health check SHALL capture the exit code, stdout, and stderr of each command.

A command SHALL be considered passing if its exit code is 0, and failing if its exit code is non-zero or if execution times out.

The health check SHALL be considered passing only if ALL configured commands pass. If any command fails, the health check SHALL be considered failing.

#### Scenario: All health check commands pass
- **WHEN** the preflight health check runs and all configured commands exit with code 0
- **THEN** the run command SHALL report the check as passed and spawn Morgan with no failure block in his prompt

#### Scenario: One health check command fails
- **WHEN** the preflight health check runs and one command exits with a non-zero code
- **THEN** the run command SHALL capture the failing command's stdout and stderr for injection into Morgan's prompt

#### Scenario: Health check command times out
- **WHEN** a health check command does not complete within the configured timeout
- **THEN** the process SHALL be killed and the command treated as failed

#### Scenario: Multiple commands with mixed results
- **WHEN** the health check runs two commands and the first passes but the second fails
- **THEN** the health check SHALL be considered failing, and the output of the failing command SHALL be captured for the prompt injection

### Health Check Command Configuration
The health check commands SHALL be configurable per-project via the project configuration (`.devshop.json` or project registry entry) under a `healthCheck` field.

The configuration SHALL support:
- `commands`: An array of shell command strings to execute (e.g., `["npm test", "npm run build"]`)
- `timeoutMs`: Per-command timeout in milliseconds (default: 120000)
- `nativeBuild`: Boolean to enable/disable native build auto-detection (default: true)
- `nativeBuildTimeoutMs`: Per-command timeout for native build commands in milliseconds (default: 300000)
- `ios.workspace`: Override auto-detected iOS workspace filename
- `ios.scheme`: Override auto-detected iOS scheme name
- `android.command`: Override default Android build command

If no `healthCheck` configuration is provided, the system SHALL attempt auto-detection by reading the project's `package.json` (if present):
- If a `test` script exists, include `npm test`
- If a `build` script exists, include `npm run build`

Additionally, if `nativeBuild` is not explicitly set to `false`, the system SHALL auto-detect native projects:
- If `ios/Podfile` exists, include iOS build validation commands
- If `android/build.gradle` or `android/build.gradle.kts` exists, include Android build validation commands

If no `package.json` exists or it contains no `test` or `build` scripts, no native project markers are found, and no explicit configuration is provided, the system SHALL skip the health check and proceed normally.

#### Scenario: Explicit health check configuration
- **WHEN** the project config contains `healthCheck.commands: ["pytest", "mypy src/"]`
- **THEN** the system SHALL execute `pytest` and `mypy src/` as health check commands, ignoring any `package.json` auto-detection

#### Scenario: Auto-detection from package.json
- **WHEN** no `healthCheck` config exists and the project's `package.json` has `scripts.test: "jest"` and `scripts.build: "next build"`
- **THEN** the system SHALL use `["npm test", "npm run build"]` as health check commands

#### Scenario: Auto-detection with test only
- **WHEN** no `healthCheck` config exists and the project's `package.json` has `scripts.test: "jest"` but no `scripts.build`
- **THEN** the system SHALL use `["npm test"]` as the sole health check command

#### Scenario: Auto-detection with React Native iOS project
- **WHEN** no `healthCheck` config exists and the project has `package.json` with `scripts.test` and an `ios/Podfile`
- **THEN** the system SHALL use `["npm test"]` plus iOS native build validation commands

#### Scenario: No configuration and no package.json
- **WHEN** no `healthCheck` config exists and no `package.json` is found in the project directory
- **THEN** the run command SHALL skip the health check entirely and spawn Morgan normally

#### Scenario: Custom timeout
- **WHEN** the project config contains `healthCheck.timeoutMs: 300000`
- **THEN** each health check command SHALL be allowed up to 300 seconds before being killed

#### Scenario: Native build disabled via config
- **WHEN** the project config contains `healthCheck.nativeBuild: false` and the project has an `ios/Podfile`
- **THEN** the system SHALL NOT include iOS build validation commands in auto-detection

### Preflight Integration in the Run Command
The `run` command SHALL call `runPreflightHealthCheck()` before rendering Morgan's orchestration prompt and spawning the CLI session.

On pass (or when no commands are configured), the preflight SHALL contribute an empty `HEALTH_STATUS` value and the run proceeds unchanged.

On failure, the preflight SHALL return a markdown block titled `## Pre-Run Health Check FAILED` containing each failing command, its exit code, and up to the last 2000 characters of its output, instructing Morgan to repair the build/tests and confirm the failing commands pass before starting any roadmap item.

The failure block SHALL be injected into Morgan's run prompt via the `{{HEALTH_STATUS}}` template variable in `templates/agents/principal-engineer/run-prompt.md`. When a failure block exists, the initial prompt sent to Morgan (including on `--resume`) SHALL also instruct him to repair the baseline first.

If the preflight itself errors (e.g., config resolution fails), the run command SHALL log that the preflight was skipped and proceed normally.

#### Scenario: Preflight failure injected into Morgan's prompt
- **WHEN** the preflight health check fails before a run session
- **THEN** the run command SHALL render Morgan's prompt with a `## Pre-Run Health Check FAILED` markdown block describing the failing commands, making baseline repair Morgan's first task

#### Scenario: Preflight pass leaves prompt clean
- **WHEN** the preflight health check passes
- **THEN** `HEALTH_STATUS` SHALL render as empty and Morgan's prompt SHALL contain no repair instructions

#### Scenario: Resumed session still receives repair instruction
- **WHEN** `run --resume` is executed and the preflight health check fails
- **THEN** the initial prompt sent to the resumed session SHALL instruct Morgan to repair the baseline before roadmap work

#### Scenario: Preflight error is non-fatal
- **WHEN** `runPreflightHealthCheck()` throws while resolving config or running commands
- **THEN** the run command SHALL print a skip notice and spawn Morgan without a failure block

### Post-Session Health Verification
After Morgan's CLI session exits, the run command SHALL verify project health again — the closing gate that catches anything broken that Morgan missed during the session.

The post-session check SHALL run only when the session actually changed the project (new commits since the pre-session HEAD, or uncommitted working-tree changes). When git state cannot be determined, the check SHALL run anyway.

On failure, the run command SHALL resume Morgan's session with the failure output and an instruction to repair (not start new roadmap work), up to 2 repair attempts, each capped at 15 minutes.

If the health check still fails after all repair attempts, the run command SHALL skip auto-consolidation to main — broken code SHALL NOT be merged — and SHALL direct the user to fix interactively via `pair` and consolidate later via `run --resume`.

#### Scenario: Healthy session consolidates normally
- **WHEN** Morgan's session exits with completed items and the post-session health check passes
- **THEN** the run command SHALL proceed to auto-consolidation as usual

#### Scenario: Morgan re-entered to repair post-session breakage
- **WHEN** the post-session health check fails after a session that changed the project
- **THEN** the run command SHALL resume Morgan's session with the failing commands' output and instruct him to repair, commit, and re-verify

#### Scenario: Consolidation blocked by failing health
- **WHEN** the post-session health check still fails after the repair attempts
- **THEN** the session branch SHALL NOT be consolidated to main, and the console SHALL direct the user to `pair` for an interactive fix

#### Scenario: Unchanged session skips the post-check
- **WHEN** Morgan's session exits without any new commits or working-tree changes
- **THEN** the post-session health check SHALL be skipped

### Health Check Never Blocks the Run
A failing preflight health check SHALL NOT prevent Morgan's session from starting. The run command SHALL always proceed to spawn Morgan; repair happens inside the session.

Pair mode (`./devshop pair`) SHALL remain the interactive path for a user who prefers to diagnose and fix a broken baseline with Morgan directly.

#### Scenario: Run proceeds despite failing baseline
- **WHEN** the preflight health check fails
- **THEN** the run command SHALL print that Morgan will repair the baseline first and continue spawning the session (no error exit)

#### Scenario: Interactive fix via pair mode
- **WHEN** the user wants to fix a broken baseline interactively instead of letting a run session handle it
- **THEN** the user MAY run `./devshop pair {project}` to work through the failures with Morgan

### Health Check Console Output
The run command SHALL print the preflight outcome to the console: a start notice when commands are about to run, a pass notice when all commands succeed, and a failure notice with the count of failing commands when any fail. The health checker SHALL print `health_check_warning` notices for skipped or unsafe commands (e.g., missing `xcodebuild`, unset `ANDROID_HOME`).

#### Scenario: Pass is reported
- **WHEN** all preflight commands pass
- **THEN** the run command SHALL print `Health check passed.`

#### Scenario: Failure is reported with count
- **WHEN** one or more preflight commands fail
- **THEN** the run command SHALL print the number of failing commands and that Morgan will repair the baseline first
