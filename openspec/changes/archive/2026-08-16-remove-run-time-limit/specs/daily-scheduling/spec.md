# Daily Scheduling — Delta

## MODIFIED Requirements

### Requirement: Day Work Window
The system SHALL support autonomous microcycles during the day window (default 12pm-5pm).

#### Scenario: Day run bounded by window end
- **WHEN** launchd/cron triggers the orchestrator with `--window day`
- **THEN** the orchestrator SHALL run until the window end time is reached, with no per-session budget or time-limit overrides

#### Scenario: Requirement targeting via CLI
- **WHEN** the day window run is invoked with `--requirements <ids>`
- **THEN** the orchestrator SHALL prioritize those specific requirements

### Requirement: Window-Aware Run Command
The `run` command SHALL accept a `--window` flag that enables autonomous behavior and bounds the session to the named window's end hour. Window configuration SHALL NOT carry `budgetUsd` or `timeLimitHours` overrides; window config files that still contain these keys SHALL be tolerated and ignored.

#### Scenario: --window flag sets the window boundary
- **WHEN** the user runs `node src/index.js run <project-id> --window night`
- **THEN** the orchestrator SHALL compute `windowEndTimeMs` from the window's `endHour` and terminate the session when it is reached

#### Scenario: Legacy window keys ignored
- **WHEN** a window's schedule config still contains `budgetUsd` or `timeLimitHours`
- **THEN** the run SHALL proceed without error and neither key SHALL affect the session
