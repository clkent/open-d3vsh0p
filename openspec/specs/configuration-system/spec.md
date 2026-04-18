# Configuration System

## Purpose
Provides a three-tier configuration system for the orchestrator: built-in defaults, per-project overrides, and CLI options. Configurations are deep-merged with CLI options taking highest priority, ensuring projects can customize budgets, timeouts, agent settings, and persona assignments without modifying the global defaults.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/config.js` -- loadConfig, loadDefaults, deepMerge functions
- `platform/orchestrator/config/defaults.json` -- default configuration values

## Requirements

### Default Configuration
The system SHALL ship a `defaults.json` file containing baseline values for all orchestrator settings: `budgetLimitUsd` (20.00), `warningThresholdPct` (80), `timeLimitMs` (25,200,000), `maxAgentInvocations` (50), `retryLimits` (implementation: 3, testFix: 3, reviewFix: 2), `agents` (four roles), `personas` (four implementation personas), `parallelism` settings, and `git` settings.

#### Scenario: Budget defaults
- **WHEN** loadDefaults() is called
- **THEN** the returned config SHALL contain `budgetLimitUsd: 20.00`, `warningThresholdPct: 80`, `timeLimitMs: 25200000`, and `maxAgentInvocations: 50`

#### Scenario: Retry limit defaults
- **WHEN** loadDefaults() is called
- **THEN** `retryLimits` SHALL contain `implementation: 3`, `testFix: 3`, and `reviewFix: 2`

#### Scenario: Git defaults
- **WHEN** loadDefaults() is called
- **THEN** `git.sessionBranchPrefix` SHALL be `"devshop/session"` and `git.commitPrefix` SHALL be `"feat"`

### Per-Agent Configuration
The system SHALL define four agent roles in `defaults.json`, each with `model`, `maxBudgetUsd`, `timeoutMs`, and `allowedTools`. The roles SHALL be: `implementation` (model: claude-sonnet-4-20250514, budget: $5.00, timeout: 600s, tools: Bash/Edit/Read/Write/Glob/Grep), `principal-engineer` (budget: $2.00, timeout: 120s, tools: Read/Glob/Grep/Bash), `security` (budget: $1.00, timeout: 120s, tools: Read/Glob/Grep), and `pm` (budget: $2.00, timeout: 300s, tools: Bash/Read/Write/Glob/Grep/Edit).

#### Scenario: Implementation agent defaults
- **WHEN** loadDefaults() is called
- **THEN** `agents.implementation` SHALL have `maxBudgetUsd: 5.00`, `timeoutMs: 600000`, and `allowedTools` containing `["Bash", "Edit", "Read", "Write", "Glob", "Grep"]`

#### Scenario: Security agent has restricted tools
- **WHEN** loadDefaults() is called
- **THEN** `agents.security.allowedTools` SHALL be `["Read", "Glob", "Grep"]` with no write or execution tools

#### Scenario: PM agent has full tool access
- **WHEN** loadDefaults() is called
- **THEN** `agents.pm.allowedTools` SHALL include Bash, Read, Write, Glob, Grep, and Edit

### Persona Configuration
The system SHALL define four implementation personas in `defaults.json`, each mapping a persona name to the single `implementation-agent` template type: Jordan, Alex, Sam, and Taylor. All personas use the same agent template; names are retained for log identification during parallel execution.

#### Scenario: All four personas present
- **WHEN** loadDefaults() is called
- **THEN** the `personas` array SHALL contain exactly 4 entries with names Jordan, Alex, Sam, and Taylor

#### Scenario: Persona-to-template mapping
- **WHEN** the persona with name "Alex" is looked up
- **THEN** its `agentType` SHALL be `"implementation-agent"`

### Project Overrides
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

### CLI Option Priority
The system SHALL merge configuration in priority order: CLI options > project overrides > defaults. CLI options for `budgetLimitUsd` and `timeLimitMs` SHALL override the merged result when explicitly provided (not undefined).

#### Scenario: CLI budget overrides project and default
- **WHEN** defaults has `budgetLimitUsd: 20`, project override has `budgetLimitUsd: 15`, and CLI passes `budgetLimitUsd: 10`
- **THEN** the final config SHALL have `budgetLimitUsd: 10`

#### Scenario: CLI option not provided falls through
- **WHEN** CLI options do not include `budgetLimitUsd` (value is undefined)
- **THEN** the merged default/project-override value SHALL be used

#### Scenario: CLI time limit overrides
- **WHEN** CLI passes `timeLimitMs: 3600000`
- **THEN** the final config SHALL have `timeLimitMs: 3600000` regardless of defaults or project overrides

### Deep Merge Behavior
The system SHALL recursively merge nested objects from source into target. Arrays SHALL be replaced entirely (not concatenated). Primitive values from source SHALL overwrite target. Only plain objects (non-array) are recursively merged.

#### Scenario: Nested object merge
- **WHEN** defaults has `{ agents: { implementation: { model: 'a', maxBudgetUsd: 5 } } }` and override has `{ agents: { implementation: { maxBudgetUsd: 3 } } }`
- **THEN** the result SHALL be `{ agents: { implementation: { model: 'a', maxBudgetUsd: 3 } } }` with model preserved

#### Scenario: Array replacement
- **WHEN** defaults has `{ allowedTools: ["Read", "Write"] }` and override has `{ allowedTools: ["Read"] }`
- **THEN** the result SHALL be `{ allowedTools: ["Read"] }` -- the array is replaced, not merged

#### Scenario: New keys added from override
- **WHEN** defaults has `{ a: 1 }` and override has `{ b: 2 }`
- **THEN** the result SHALL be `{ a: 1, b: 2 }`

### Spike Agent Configuration
The system SHALL define a spike agent role in `defaults.json` with `model`, `maxBudgetUsd`, `timeoutMs`, and `allowedTools`. The spike agent uses the same budget and timeout as the diagnostic agent ($3, 5 minutes) but excludes the Edit tool since spikes create new files rather than modifying existing ones.

#### Scenario: Spike agent defaults
- **WHEN** loadDefaults() is called
- **THEN** `agents.spike` SHALL have `maxBudgetUsd: 3.00`, `timeoutMs: 300000`, and `allowedTools` containing `["Bash", "Read", "Write", "Glob", "Grep"]`

### Parallelism Configuration
The system SHALL include parallelism settings in defaults: `maxConcurrentGroups` (default 4) for the number of parallel agent groups, and `worktreeDir` (default ".worktrees") for git worktree storage.

#### Scenario: Parallelism defaults
- **WHEN** loadDefaults() is called
- **THEN** `parallelism.maxConcurrentGroups` SHALL be 4 and `parallelism.worktreeDir` SHALL be `".worktrees"`
