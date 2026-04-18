# Daily Scheduling

## Purpose
Automate the daily development cycle by scheduling agent work into distinct time windows. The scheduler integrates with macOS launchd (primary) and cron (fallback) for unattended operation, with per-project configuration, rolling GitHub Issue digests, and run locking to prevent concurrent scheduled runs.

## Status
PLANNED

## Requirements

### Per-Project Schedule Configuration

The system SHALL support per-project schedule configuration stored in `project-registry.json`.

#### Scenario: Schedule config in project registry
- **GIVEN** a project entry in `project-registry.json`
- **WHEN** the schedule system reads the project
- **THEN** it SHALL use the project's `schedule` object for window times, budgets, cadence settings, and notification preferences

#### Scenario: Default schedule applied when no config present
- **GIVEN** a project with no `schedule` object in the registry
- **WHEN** the schedule system reads the project
- **THEN** it SHALL apply defaults from `config/schedule-defaults.json`

#### Scenario: Window config validation
- **GIVEN** a schedule configuration
- **WHEN** the system validates the config
- **THEN** it SHALL reject overlapping windows, invalid hour ranges (startHour >= endHour), and hours outside 0-23

### Night Work Window

The system SHALL execute autonomous microcycles on pending requirements during the night window (default 1am-8am) without human intervention.

#### Scenario: Autonomous night run starts on schedule
- **WHEN** launchd/cron triggers the orchestrator with `--window night`
- **THEN** the orchestrator SHALL begin a new session and run microcycles against the next pending requirements

#### Scenario: Night work respects window budget and time
- **WHEN** the night work window is active
- **THEN** consumption monitoring SHALL enforce both the window-specific budget (`budgetUsd`) and the window end time, shutting down gracefully when either is reached

#### Scenario: Run lock prevents concurrent runs
- **WHEN** a scheduled run starts for a project
- **THEN** the system SHALL create a PID lock file at `active-agents/<projectId>/orchestrator/run.lock`
- **AND** if a lock file already exists with a running process, the new run SHALL exit with a warning

### Morning Review Window

The system SHALL produce a rolling daily GitHub Issue summarizing the night's work (default 8am-12pm).

#### Scenario: Rolling daily digest Issue created
- **WHEN** the morning window triggers
- **THEN** the system SHALL search for today's Issue by title `[DevShop Daily] <project name> - <YYYY-MM-DD>` via `gh issue list --search`
- **AND** if found, append the night session summary as a new comment
- **AND** if not found, create a new Issue with the night session summary

#### Scenario: Digest includes session details
- **WHEN** the daily digest is generated
- **THEN** it SHALL include: completed requirements, parked items, cost totals, session branch name, and any warnings from consumption monitoring

#### Scenario: gh CLI unavailable
- **WHEN** the `gh` CLI is not installed or not authenticated
- **THEN** the notifier SHALL log a warning and skip Issue creation without failing the session

### Day Work Window

The system SHALL support autonomous microcycles during the day window (default 12pm-5pm).

#### Scenario: Day run with window-specific limits
- **WHEN** launchd/cron triggers the orchestrator with `--window day`
- **THEN** the orchestrator SHALL use the day window's `budgetUsd` and `timeLimitHours`, and SHALL stop when the window end time is reached

#### Scenario: Requirement targeting via CLI
- **WHEN** the day window run is invoked with `--requirements <ids>`
- **THEN** the orchestrator SHALL prioritize those specific requirements

### Tech Debt Window

The system SHALL run full codebase security scans and principal engineer improvement passes during the tech debt window (default 6pm-10pm).

#### Scenario: Security scan runs first
- **WHEN** the tech debt window begins
- **THEN** the system SHALL spawn the security agent (Casey) to scan the entire project codebase for vulnerabilities

#### Scenario: PE improvement pass follows security
- **WHEN** the security scan completes within the tech debt window
- **THEN** the system SHALL spawn the principal engineer agent (Morgan) with a tech-debt-specific prompt to address code quality, refactoring opportunities, and technical debt across the codebase

#### Scenario: Tech debt results appended to daily digest
- **WHEN** the tech debt window completes
- **THEN** findings SHALL be appended as a comment on today's rolling daily digest Issue

### Window-Aware Run Command

The `run` command SHALL accept a `--window` flag that configures budget, time limits, and behavior based on the named window.

#### Scenario: --window flag overrides defaults
- **WHEN** the user runs `node src/index.js run <project-id> --window night`
- **THEN** the orchestrator SHALL use the night window's `budgetUsd` as the budget limit and compute `timeLimitMs` from the window's `endHour` minus current time
- **AND** SHALL set `windowEndTimeMs` so consumption monitoring stops at window end

#### Scenario: --window with explicit overrides
- **WHEN** the user provides both `--window night` and `--budget 5`
- **THEN** the explicit `--budget` SHALL take precedence over the window's configured budget

### Schedule CLI Command

The system SHALL provide a `schedule` CLI command for managing automated scheduling.

#### Scenario: schedule install
- **WHEN** the user runs `node src/index.js schedule install <project-id>`
- **THEN** the system SHALL generate launchd plist files (one per enabled window per project) and install them via `launchctl load`
- **AND** on non-macOS, SHALL generate crontab entries instead

#### Scenario: schedule remove
- **WHEN** the user runs `node src/index.js schedule remove <project-id>`
- **THEN** the system SHALL unload and delete all launchd plists (or remove crontab entries) for the project

#### Scenario: schedule status
- **WHEN** the user runs `node src/index.js schedule status <project-id>`
- **THEN** the system SHALL show which windows are installed, their next run times, and whether each is enabled

#### Scenario: schedule dry-run
- **WHEN** the user runs `node src/index.js schedule dry-run <project-id>`
- **THEN** the system SHALL print what plist files or crontab entries would be generated, without installing them

### Launchd Integration

The system SHALL generate macOS launchd plist files for automated scheduling.

#### Scenario: One plist per window per project
- **WHEN** generating plists for a project
- **THEN** the system SHALL create one plist per enabled window, named `com.devshop.<projectId>.<window>.plist`
- **AND** place them in `~/Library/LaunchAgents/`

#### Scenario: Plist uses StartCalendarInterval
- **WHEN** a plist is generated
- **THEN** it SHALL use `StartCalendarInterval` with the window's `startHour` to trigger daily
- **AND** the `ProgramArguments` SHALL invoke `node src/index.js run <project-id> --window <window>`

#### Scenario: Plist environment and logging
- **WHEN** a plist is generated
- **THEN** it SHALL set `StandardOutPath` and `StandardErrorPath` to log files in `active-agents/<projectId>/orchestrator/logs/`

### Cron Fallback

The system SHALL support cron as a fallback scheduler on non-macOS systems.

#### Scenario: Crontab entry generation
- **WHEN** the schedule is installed on a non-macOS system
- **THEN** the system SHALL generate crontab entries with appropriate timing for each enabled window
- **AND** entries SHALL be tagged with a comment identifying them as DevShop entries for the project

#### Scenario: Crontab entry removal
- **WHEN** the schedule is removed on a non-macOS system
- **THEN** the system SHALL remove only the DevShop-tagged crontab entries for the project

### Window-End Graceful Shutdown

The consumption monitor SHALL support window-end-time-based shutdown.

#### Scenario: windowEndTimeMs triggers stop
- **WHEN** `windowEndTimeMs` is set in the consumption monitor
- **AND** the current time reaches or exceeds `windowEndTimeMs`
- **THEN** `shouldStop()` SHALL return `{ stop: true, reason: 'window_end' }`

#### Scenario: Complete current phase before stopping
- **WHEN** the window end time is reached during a microcycle
- **THEN** the orchestrator SHALL complete the current microcycle phase (implement, test, commit, or review) before shutting down

## Deferred

The following capabilities are deferred to future iterations:

- **Human-directed day mode details** — Interactive human input during day window (autonomous fallback is implemented)
- **Window transition checkpointing** — Resuming across window boundaries (each window starts a fresh session)
- **Custom cadence-per-window** — Per-window cadence overrides beyond the global schedule
