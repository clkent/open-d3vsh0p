# Cadence Automation

## Purpose
Automate weekly maintenance cadences that keep the development environment healthy: stale branch cleanup and dead worktree removal, reported via GitHub Issues. The monthly review (parked-item archiving, cost review) is disabled — its data source (session summaries) is no longer generated; it will return with the token-based estimator.

## Status
PLANNED

## Requirements

### Weekly Stale Branch Cleanup

The system SHALL prune stale branches weekly to keep the git repository clean.

#### Scenario: Merged branches pruned after 7 days
- **WHEN** the weekly cleanup runs
- **THEN** the system SHALL identify branches matching `devshop/session-*` and `devshop/work-*` that have been fully merged to main
- **AND** if merged more than 7 days ago, SHALL delete them locally and from the remote

#### Scenario: Abandoned branches pruned after 14 days
- **WHEN** the weekly cleanup runs
- **THEN** the system SHALL identify branches with no commits in the last 14 days that are not the project's `lastSessionId` branch
- **AND** SHALL delete them locally and from the remote

#### Scenario: Protected branches never pruned
- **WHEN** the cleanup identifies branches to prune
- **THEN** it SHALL never delete `main`, `master`, or any branch currently checked out

#### Scenario: Dry run mode
- **WHEN** the cleanup runs with `--dry-run`
- **THEN** it SHALL list branches that would be pruned without actually deleting them

### Weekly Dead Worktree Removal

The system SHALL remove dead worktrees weekly.

#### Scenario: Orphaned worktrees cleaned
- **WHEN** the weekly cleanup runs
- **THEN** the system SHALL run `git worktree list` and identify worktrees whose directories no longer exist
- **AND** SHALL run `git worktree prune` to clean them up

#### Scenario: Active worktrees preserved
- **WHEN** the cleanup identifies worktrees
- **THEN** it SHALL never remove worktrees that have an active process (check for run.lock)

### Monthly Review Disabled

The monthly review's former tasks (archiving stale parked items, cost aggregation) depended on session summaries, which are no longer generated. Until the token-based estimator (`session/token-estimator.js`, roadmap item `token-estimator`) provides a replacement data source, `cadence run --type monthly` SHALL print a notice that the monthly review is disabled and exit 0.

#### Scenario: Monthly cadence prints disabled notice
- **WHEN** `cadence run <project> --type monthly` is executed
- **THEN** the system SHALL print that the monthly review is disabled pending the token-based estimator and SHALL exit 0 without posting a GitHub Issue

### Cadence CLI Command

The system SHALL provide a `cadence` CLI command for running maintenance tasks.

#### Scenario: cadence run weekly
- **WHEN** the user runs `node src/index.js cadence run <project-id> --type weekly`
- **THEN** the system SHALL execute all enabled weekly tasks (stale branch cleanup, dead worktree removal)

#### Scenario: cadence run monthly
- **WHEN** the user runs `node src/index.js cadence run <project-id> --type monthly`
- **THEN** the system SHALL execute all enabled monthly tasks (archive parked items, cost review)

#### Scenario: cadence status
- **WHEN** the user runs `node src/index.js cadence status <project-id>`
- **THEN** the system SHALL show the last run date and results for each cadence type

### GitHub Issue Reporting

The system SHALL report cadence results via GitHub Issues.

#### Scenario: Weekly cleanup report
- **WHEN** the weekly cleanup completes
- **THEN** the system SHALL create or update a GitHub Issue titled `[DevShop Weekly] <project name> - <YYYY-Www>` with the cleanup results

#### Scenario: Monthly review report
- **WHEN** the monthly review completes
- **THEN** the system SHALL create a GitHub Issue titled `[DevShop Monthly] <project name> - <YYYY-MM>` with the cost report and archive summary

#### Scenario: gh CLI unavailable
- **WHEN** the `gh` CLI is not installed or not authenticated
- **THEN** the system SHALL log results to the console and log file without failing

## Deferred

The following capabilities are deferred to future iterations:

- **Weekly pattern review** — Analyzing completed work for recurring patterns and common failures
- **Weekly checklist update** — Auto-updating project checklists from completed/deferred work
- **Weekly defeat test** — Re-testing previously identified failure patterns
- **Monthly behavior audit** — Agent performance drift detection and metrics comparison
- **Monthly agent versioning** — Prompt updates based on observed patterns
- **Monthly compost cleanup** — Full dead code detection and removal (branch cleanup is implemented)
