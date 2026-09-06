## MODIFIED Requirements

### Requirement: Default Configuration
The system SHALL ship a `defaults.json` file containing baseline values for all orchestrator settings: `agents` (four roles), `healthCheck` settings (`commands`, `timeoutMs`, `nativeBuildTimeoutMs`), `remoteControl` (`enabled: false`), and `slack` (`enabled: false`, `allowedUserIds: []`, `channel: null`, `port: 3211`, `tmux: true`). The defaults SHALL NOT contain `budgetLimitUsd` or `timeLimitMs`.

#### Scenario: No session budget or time defaults
- **WHEN** loadDefaults() is called
- **THEN** the returned config SHALL NOT contain `budgetLimitUsd` or `timeLimitMs`

#### Scenario: Health check defaults
- **WHEN** loadDefaults() is called
- **THEN** `healthCheck` SHALL contain `commands: []`, `timeoutMs: 120000`, and `nativeBuildTimeoutMs: 300000`

#### Scenario: Remote operation defaults are off
- **WHEN** loadDefaults() is called
- **THEN** `remoteControl.enabled` SHALL be false, `slack.enabled` SHALL be false, `slack.allowedUserIds` SHALL be `[]`, `slack.port` SHALL be 3211, and `slack.tmux` SHALL be true

## ADDED Requirements

### Requirement: Local Configuration Overlay
The system SHALL load an optional machine-level overlay from `<devshopRoot>/config.local.json` and merge it on top of `defaults.json` and beneath per-project overrides, so the priority order is CLI options > project overrides > local overlay > defaults. The file SHALL be gitignored. A missing file SHALL yield an empty overlay; a file with invalid JSON SHALL cause `loadConfig` to throw a descriptive error naming the path.

#### Scenario: Overlay applied
- **WHEN** `config.local.json` contains `{ "slack": { "enabled": true, "allowedUserIds": ["U0123"] } }`
- **THEN** `loadConfig` SHALL return `slack.enabled: true` and `slack.allowedUserIds: ["U0123"]` with the other `slack` defaults intact

#### Scenario: Project override wins over overlay
- **WHEN** the overlay sets `remoteControl.enabled: true` and the project's `orchestrator/config.json` sets `remoteControl.enabled: false`
- **THEN** `loadConfig` SHALL return `remoteControl.enabled: false` for that project

#### Scenario: Overlay missing
- **WHEN** `config.local.json` does not exist
- **THEN** `loadConfig` SHALL behave as if the overlay were `{}`

#### Scenario: Overlay malformed
- **WHEN** `config.local.json` contains invalid JSON
- **THEN** `loadConfig` SHALL throw an error that includes the file path

### Requirement: Slack Token Loading
The system SHALL read `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` from the process environment, falling back to `<devshopRoot>/.env` via `process.loadEnvFile` when present. Tokens SHALL never be written to logs, config files, or event payloads.

#### Scenario: Tokens from .env
- **WHEN** the environment lacks the tokens and `.env` defines both
- **THEN** the bridge SHALL start using the `.env` values

#### Scenario: No .env and Slack disabled
- **WHEN** `.env` is absent and `slack.enabled` is false
- **THEN** `loadConfig` SHALL succeed without error
