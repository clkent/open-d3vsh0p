# Agent Pool

## Purpose
Manages a pool of implementation agent personas and assigns them to parallel work groups using random distribution, ensuring variety in agent assignment across groups.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/agent-pool.js` — persona definitions, random assignment, and batch allocation with Fisher-Yates shuffle

## Requirements

### Persona Definitions
The system SHALL define exactly 4 default agent personas, each with a name and a corresponding agentType that maps to a prompt template directory. All personas use the same `implementation-agent` template; names are retained for log identification during parallel execution.

The 4 default personas SHALL be:
- Jordan with agentType `implementation-agent`
- Alex with agentType `implementation-agent`
- Sam with agentType `implementation-agent`
- Taylor with agentType `implementation-agent`

#### Scenario: Default persona list
- **WHEN** an AgentPool is constructed without arguments
- **THEN** the pool SHALL contain exactly 4 personas: Jordan, Alex, Sam, and Taylor

#### Scenario: Custom persona list from config
- **WHEN** an AgentPool is constructed with a custom personas array (e.g. from `config.personas`)
- **THEN** the pool SHALL use the provided list instead of the defaults

#### Scenario: Names accessor
- **WHEN** `pool.names` is accessed
- **THEN** it SHALL return an array of persona names from the pool

### Random Assignment
The system SHALL assign personas to work groups randomly, picking a random index on each call to `assign()`.

Each call to `assign()` SHALL return a copy of the persona object (not a reference).

#### Scenario: Random selection
- **WHEN** `assign()` is called
- **THEN** a random persona SHALL be selected from the pool using `Math.floor(Math.random() * personas.length)`

#### Scenario: Assignment returns a copy
- **WHEN** `assign()` returns a persona object and the caller modifies it
- **THEN** subsequent calls to `assign()` SHALL NOT be affected by the modification

### Batch Assignment with Shuffle
The system SHALL support assigning personas to multiple groups in a single call via `assignMany(count)`, using a Fisher-Yates shuffle to maximize variety.

When count is less than or equal to the number of personas, the system SHALL shuffle the persona list and return the first `count` entries, ensuring no duplicates.

When count exceeds the number of personas, all personas SHALL be included (shuffled) and additional slots filled with random picks.

#### Scenario: Assign to fewer groups than personas
- **WHEN** `assignMany(3)` is called on a pool with 4 personas
- **THEN** the result SHALL be 3 unique persona objects (no duplicates) in random order

#### Scenario: Assign to exactly as many groups as personas
- **WHEN** `assignMany(4)` is called on a pool with 4 personas
- **THEN** the result SHALL be all 4 personas in shuffled order

#### Scenario: Assign to more groups than personas
- **WHEN** `assignMany(6)` is called on a pool with 4 personas
- **THEN** the result SHALL contain all 4 personas (shuffled) plus 2 additional random picks

#### Scenario: Assign zero groups
- **WHEN** `assignMany(0)` is called
- **THEN** the result SHALL be an empty array

### Config Integration
The parallel orchestrator SHALL pass `config.personas` (if defined in `defaults.json`) to the AgentPool constructor, allowing persona customization without code changes.

#### Scenario: Personas from config
- **WHEN** the orchestrator initializes and `config.personas` is defined
- **THEN** `new AgentPool(config.personas)` SHALL be called with the config-provided personas

#### Scenario: No personas in config
- **WHEN** the orchestrator initializes and `config.personas` is undefined
- **THEN** `new AgentPool()` SHALL use the default 4 personas
