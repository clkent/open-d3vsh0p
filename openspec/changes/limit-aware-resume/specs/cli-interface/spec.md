# CLI Interface — Delta

## MODIFIED Requirements

### Requirement: Option Parsing
The system SHALL parse CLI options using `node:util` `parseArgs` with options including: `--budget` (string, default "30"), `--time-limit` (string, default "7"), `--resume` (boolean, default false), `--fresh` (boolean, default false), `--dry-run` (boolean, default false), `--no-auto-resume` (boolean, default false), `--requirements` (string), `--window` (string), and `--port` (string, used by the `api` command, default 3200). Budget SHALL be parsed as USD float. Time limit SHALL be parsed as hours and converted to milliseconds (multiplied by 3,600,000). Requirements SHALL be split by comma into an array of trimmed strings. The config SHALL expose `autoResume: true` unless `--no-auto-resume` is provided.

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

#### Scenario: Auto-resume enabled by default
- **WHEN** `--no-auto-resume` is not provided
- **THEN** config.autoResume SHALL be true

#### Scenario: Auto-resume opt-out
- **WHEN** `--no-auto-resume` is provided
- **THEN** config.autoResume SHALL be false
