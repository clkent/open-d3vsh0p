# action-command Specification

## Purpose
TBD - created by archiving change action-command. Update Purpose after archive.
## Requirements
### Requirement: Action Command

The system SHALL provide an `action` command (`./devshop action <project>`) that interactively walks users through resolving incomplete HUMAN-tagged roadmap items.

#### Scenario: Action command with HUMAN items
- **WHEN** `./devshop action <project>` is executed and the roadmap has incomplete HUMAN-tagged items
- **THEN** the system SHALL display a summary of items, then prompt the user to resolve each one interactively

#### Scenario: Action command with no HUMAN items
- **WHEN** `./devshop action <project>` is executed and no incomplete HUMAN items exist
- **THEN** the system SHALL display "No pending HUMAN-tagged items. Nothing to do!"

#### Scenario: Action command with no roadmap
- **WHEN** `./devshop action <project>` is executed and no roadmap.md exists
- **THEN** the system SHALL display an error directing the user to run `./devshop plan` first and exit with code 1

### Requirement: Environment Setup Detection

The `ActionResolver` SHALL classify HUMAN items as `env_setup` when the description matches environment-related keywords (api keys, environment variables, .env, secrets, credentials) AND a `.env.example` file exists in the project. Otherwise items SHALL be classified as `manual`.

#### Scenario: Env-related item with .env.example
- **WHEN** a HUMAN item description contains "API keys" and `.env.example` exists
- **THEN** `ActionResolver.analyze()` SHALL classify the item as `env_setup` with `envDetails` containing missing keys, already-set keys, and the .env.example path

#### Scenario: Env-related item without .env.example
- **WHEN** a HUMAN item description contains "API keys" but no `.env.example` exists
- **THEN** `ActionResolver.analyze()` SHALL classify the item as `manual`

#### Scenario: Non-env HUMAN item
- **WHEN** a HUMAN item description does not match env-related keywords
- **THEN** `ActionResolver.analyze()` SHALL classify the item as `manual`

### Requirement: Environment Key Management

The `EnvManager` SHALL parse `.env.example` files, detect missing keys in `.env`, and write values securely.

#### Scenario: Parse .env.example
- **WHEN** `parseEnvExample()` is called
- **THEN** it SHALL return an array of `{ key, placeholder, comment, signupUrl }` entries, extracting comments and URLs from preceding comment lines, and skipping keys with "No API key required" in comments

#### Scenario: Detect missing keys
- **WHEN** `getMissingKeys()` is called
- **THEN** it SHALL return keys present in `.env.example` but missing or placeholder-valued in `.env`

#### Scenario: Write keys securely
- **WHEN** `writeKeys(keyValues)` is called
- **THEN** it SHALL write to `.env` with `0o600` permissions, merging into existing content or creating from `.env.example` template

### Requirement: Interactive Resolution Flow

The action command SHALL provide an interactive flow for resolving each item.

#### Scenario: Env setup item resolution
- **WHEN** an `env_setup` item is presented
- **THEN** the system SHALL show already-configured keys, prompt for each missing key value (with echo suppressed for secret input), write entered values to `.env`, and ask if the item should be marked complete

#### Scenario: Manual item resolution
- **WHEN** a `manual` item is presented
- **THEN** the system SHALL ask "Have you completed this? (y/n)" and mark the item complete in the roadmap if confirmed

### Requirement: HUMAN Tag Cleaning

The `ActionResolver` SHALL strip the `[HUMAN]` tag from item descriptions in its output so users see clean text.

#### Scenario: Description cleaning
- **WHEN** `analyze()` returns items
- **THEN** each item's description SHALL have the `[HUMAN]` tag removed

### Requirement: Actionable Phase Discovery

The `RoadmapReader` SHALL provide a `getActionablePhaseNumbers(roadmap)` method that returns an array of phase numbers for all phases whose dependency phases are fully satisfied. A dependency phase is satisfied when all its items have status `complete` or `parked`.

#### Scenario: Phase with no dependencies
- **WHEN** a phase has no `depends` clause (first phase or explicit null)
- **THEN** `getActionablePhaseNumbers` SHALL include that phase's number in the result

#### Scenario: Phase with unsatisfied dependencies
- **WHEN** a phase depends on another phase that has pending items
- **THEN** `getActionablePhaseNumbers` SHALL NOT include that phase's number

#### Scenario: Phase with all dependencies satisfied
- **WHEN** a phase depends on phases where all items are complete or parked
- **THEN** `getActionablePhaseNumbers` SHALL include that phase's number

#### Scenario: Multiple independently actionable phases
- **WHEN** multiple phases have their dependencies independently satisfied
- **THEN** `getActionablePhaseNumbers` SHALL include all of their phase numbers

### Requirement: Phase-Filtered Action Analysis

`ActionResolver.analyze()` SHALL filter incomplete HUMAN-tagged items to only those in actionable phases (as determined by `getActionablePhaseNumbers`). It SHALL return `{ items, deferredCount }` where `deferredCount` is the number of incomplete HUMAN items in non-actionable phases.

#### Scenario: Items in blocked phases are deferred
- **WHEN** a HUMAN item exists in a phase whose dependencies are not satisfied
- **THEN** `analyze()` SHALL NOT include that item in `items` and SHALL increment `deferredCount`

#### Scenario: Items in actionable phases are included
- **WHEN** a HUMAN item exists in a phase whose dependencies are satisfied
- **THEN** `analyze()` SHALL include that item in `items`

#### Scenario: Deferred count reflects blocked items
- **WHEN** there are N incomplete HUMAN items in non-actionable phases
- **THEN** `analyze()` SHALL return `deferredCount` equal to N

#### Scenario: All phases actionable
- **WHEN** all dependency phases are satisfied
- **THEN** `analyze()` SHALL include all incomplete HUMAN items and `deferredCount` SHALL be 0

### Requirement: Group Metadata on Action Items

Each item returned by `ActionResolver.analyze()` SHALL include `groupLetter` and `groupLabel` properties from the roadmap group containing the item.

#### Scenario: Group metadata present
- **WHEN** `analyze()` returns items
- **THEN** each item SHALL have `groupLetter` (e.g., `"A"`) and `groupLabel` (e.g., `"Setup"`) properties

### Requirement: Phase-Grouped Display

The action command summary SHALL group items under phase headers. Each item SHALL display its group label.

#### Scenario: Items grouped by phase
- **WHEN** the action command displays actionable items
- **THEN** items SHALL be grouped under `Phase <number>: <label>` headers with each item showing `Group <letter>: <label>` beneath it

### Requirement: Deferred Items Messaging

The action command SHALL inform the user about deferred items waiting in future phases.

#### Scenario: Deferred items exist
- **WHEN** `deferredCount` is greater than 0
- **THEN** the action command SHALL display `<N> more item(s) waiting in future phases.`

#### Scenario: No deferred items
- **WHEN** `deferredCount` is 0
- **THEN** the action command SHALL NOT display the deferred items message

### Requirement: Improved Empty State

The action command SHALL distinguish between having no actionable items now (but deferred items exist) and having no HUMAN items at all.

#### Scenario: No actionable items but deferred items exist
- **WHEN** `items` is empty and `deferredCount` is greater than 0
- **THEN** the action command SHALL display `No currently actionable items. <N> item(s) waiting in future phases.`

#### Scenario: No HUMAN items at all
- **WHEN** `items` is empty and `deferredCount` is 0
- **THEN** the action command SHALL display `No pending HUMAN-tagged items. Nothing to do!`

### Requirement: Group Context in Detail View

The per-item detail section of the action command SHALL show both phase and group context.

#### Scenario: Detail view context line
- **WHEN** the action command shows the detail section for an item
- **THEN** it SHALL display `Phase <number>: <label> > Group <letter>: <label>`

