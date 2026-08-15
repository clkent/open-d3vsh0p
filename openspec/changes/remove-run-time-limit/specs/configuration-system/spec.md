# Configuration System — Delta

## MODIFIED Requirements

### Requirement: Default Configuration
The system SHALL ship a `defaults.json` file containing baseline values for all orchestrator settings: `agents` (four roles) and `healthCheck` settings (`commands`, `timeoutMs`, `nativeBuildTimeoutMs`). The defaults SHALL NOT contain `budgetLimitUsd` or `timeLimitMs`.

#### Scenario: No session budget or time defaults
- **WHEN** loadDefaults() is called
- **THEN** the returned config SHALL NOT contain `budgetLimitUsd` or `timeLimitMs`

#### Scenario: Health check defaults
- **WHEN** loadDefaults() is called
- **THEN** `healthCheck` SHALL contain `commands: []`, `timeoutMs: 120000`, and `nativeBuildTimeoutMs: 300000`

### Requirement: CLI Option Priority
The system SHALL merge configuration in priority order: CLI options > project overrides > defaults. The system SHALL NOT apply special-case CLI overrides for `budgetLimitUsd` or `timeLimitMs`; project override files that still contain these keys SHALL be merged without error but SHALL have no effect on run behavior.

#### Scenario: CLI option not provided falls through
- **WHEN** a CLI option is undefined
- **THEN** the merged default/project-override value SHALL be used

#### Scenario: Legacy override keys tolerated
- **WHEN** a project's `orchestrator/config.json` contains `budgetLimitUsd` or `timeLimitMs`
- **THEN** loadConfig SHALL complete without error and no session budget or time limit SHALL be enforced
