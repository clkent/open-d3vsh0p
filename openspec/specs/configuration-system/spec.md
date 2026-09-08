# Configuration System

## Purpose
Provides a three-tier configuration system for the orchestrator: built-in defaults, per-project overrides, and CLI options. Configurations are deep-merged with CLI options taking highest priority, ensuring projects can customize budgets, timeouts, agent settings, and health check commands without modifying the global defaults.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/infra/config.js` -- loadConfig, loadDefaults, deepMerge functions
- `platform/orchestrator/config/defaults.json` -- default configuration values
## Requirements
### Requirement: Default Configuration
The system SHALL ship a `defaults.json` file containing baseline values for all orchestrator settings: `agents` (four roles), `healthCheck` settings (`commands`, `timeoutMs`, `nativeBuildTimeoutMs`), and `remoteControl` (`enabled: false`). The defaults SHALL NOT contain `budgetLimitUsd` or `timeLimitMs`.

#### Scenario: No session budget or time defaults
- **WHEN** loadDefaults() is called
- **THEN** the returned config SHALL NOT contain `budgetLimitUsd` or `timeLimitMs`

#### Scenario: Health check defaults
- **WHEN** loadDefaults() is called
- **THEN** `healthCheck` SHALL contain `commands: []`, `timeoutMs: 120000`, and `nativeBuildTimeoutMs: 300000`

#### Scenario: Remote Control default is off
- **WHEN** loadDefaults() is called
- **THEN** `remoteControl.enabled` SHALL be false

### Requirement: Per-Agent Configuration
The system SHALL define four agent roles in `defaults.json`, each with `maxBudgetUsd`, `timeoutMs`, and `allowedTools`. The roles SHALL be: `principal-engineer` (budget: $2.00, timeout: 120s, tools: Read/Glob/Grep/Bash), `security` (budget: $1.00, timeout: 120s, tools: Read/Glob/Grep), `pair` (budget: $5.00, timeout: 600s, tools: Bash/Read/Write/Glob/Grep/Edit), and `pm` (budget: $2.00, timeout: 300s, tools: Bash/Read/Write/Glob/Grep/Edit).

#### Scenario: Principal engineer defaults
- **WHEN** loadDefaults() is called
- **THEN** `agents.principal-engineer` SHALL have `maxBudgetUsd: 2.00`, `timeoutMs: 120000`, and `allowedTools` containing `["Read", "Glob", "Grep", "Bash"]`

#### Scenario: Security agent has restricted tools
- **WHEN** loadDefaults() is called
- **THEN** `agents.security.allowedTools` SHALL be `["Read", "Glob", "Grep"]` with no write or execution tools

#### Scenario: PM agent has full tool access
- **WHEN** loadDefaults() is called
- **THEN** `agents.pm.allowedTools` SHALL include Bash, Read, Write, Glob, Grep, and Edit

### Requirement: Project Overrides
The system SHALL load project-specific overrides from `active-agents/{project}/orchestrator/config.json`. If the file does not exist, the system SHALL return an empty object (no overrides). Overrides are merged on top of defaults.

#### Scenario: Project override file exists
- **WHEN** `loadProjectOverrides` is called with an activeAgentsDir that contains `orchestrator/config.json`
- **THEN** the parsed JSON contents SHALL be returned as the override object

#### Scenario: Project override file missing
- **WHEN** `loadProjectOverrides` is called and the config file does not exist
- **THEN** it SHALL return `{}` without throwing an error

#### Scenario: No activeAgentsDir provided
- **WHEN** `loadConfig` is called with `cliOptions.activeAgentsDir` undefined
- **THEN** project overrides SHALL be skipped and only defaults used

### Requirement: CLI Option Priority
The system SHALL merge configuration in priority order: CLI options > project overrides > defaults. The system SHALL NOT apply special-case CLI overrides for `budgetLimitUsd` or `timeLimitMs`; project override files that still contain these keys SHALL be merged without error but SHALL have no effect on run behavior.

#### Scenario: CLI option not provided falls through
- **WHEN** a CLI option is undefined
- **THEN** the merged default/project-override value SHALL be used

#### Scenario: Legacy override keys tolerated
- **WHEN** a project's `orchestrator/config.json` contains `budgetLimitUsd` or `timeLimitMs`
- **THEN** loadConfig SHALL complete without error and no session budget or time limit SHALL be enforced

### Requirement: Deep Merge Behavior
The system SHALL recursively merge nested objects from source into target. Arrays SHALL be replaced entirely (not concatenated). Primitive values from source SHALL overwrite target. Only plain objects (non-array) are recursively merged.

#### Scenario: Nested object merge
- **WHEN** defaults has `{ agents: { pm: { maxBudgetUsd: 2, timeoutMs: 300000 } } }` and override has `{ agents: { pm: { maxBudgetUsd: 3 } } }`
- **THEN** the result SHALL be `{ agents: { pm: { maxBudgetUsd: 3, timeoutMs: 300000 } } }` with timeoutMs preserved

#### Scenario: Array replacement
- **WHEN** defaults has `{ allowedTools: ["Read", "Write"] }` and override has `{ allowedTools: ["Read"] }`
- **THEN** the result SHALL be `{ allowedTools: ["Read"] }` -- the array is replaced, not merged

#### Scenario: New keys added from override
- **WHEN** defaults has `{ a: 1 }` and override has `{ b: 2 }`
- **THEN** the result SHALL be `{ a: 1, b: 2 }`

### Requirement: Local Configuration Overlay
The system SHALL load an optional machine-level overlay from `<devshopRoot>/config.local.json` and merge it on top of `defaults.json` and beneath per-project overrides, so the priority order is CLI options > project overrides > local overlay > defaults. The file SHALL be gitignored. A missing file SHALL yield an empty overlay; a file with invalid JSON SHALL cause `loadConfig` to throw a descriptive error naming the path.

#### Scenario: Overlay applied
- **WHEN** `config.local.json` contains `{ "remoteControl": { "enabled": true } }`
- **THEN** `loadConfig` SHALL return `remoteControl.enabled: true` with the other defaults intact

#### Scenario: Project override wins over overlay
- **WHEN** the overlay sets `remoteControl.enabled: true` and the project's `orchestrator/config.json` sets `remoteControl.enabled: false`
- **THEN** `loadConfig` SHALL return `remoteControl.enabled: false` for that project

#### Scenario: Overlay missing
- **WHEN** `config.local.json` does not exist
- **THEN** `loadConfig` SHALL behave as if the overlay were `{}`

#### Scenario: Overlay malformed
- **WHEN** `config.local.json` contains invalid JSON
- **THEN** `loadConfig` SHALL throw an error that includes the file path

