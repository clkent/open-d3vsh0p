## MODIFIED Requirements

### Requirement: Commands
The system SHALL support the following commands: `kickoff`, `run`, `plan`, `talk`, `pair`, `status`, `schedule`, `cadence`, `action`, `recover`, `security`, `api`, `remote`, and `help`. The command SHALL be the first positional argument. An unrecognized command SHALL print an error message, display usage information, and exit with code 1. The `remote` command SHALL take a subcommand (`start`, `install`, `remove`, `status`, `launch`, `sessions`, `stop`); only `launch` and `stop` take a project argument.

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

#### Scenario: Remote subcommand dispatch
- **WHEN** `node src/index.js remote start` is executed
- **THEN** the system SHALL dispatch to the `remoteCommand` handler with subcommand `start` without requiring or resolving a project

#### Scenario: Remote without subcommand
- **WHEN** `node src/index.js remote` is executed
- **THEN** the system SHALL print an error naming the valid subcommands, display usage, and exit with code 1

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
