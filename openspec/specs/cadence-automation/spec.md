# Cadence Automation

## Purpose
Automate weekly and monthly maintenance cadences that keep the development environment healthy. Weekly tasks focus on stale branch cleanup and dead worktree removal. Monthly tasks focus on archiving old parked items and cost review from session summaries. Results are reported via GitHub Issues.

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

### Monthly Archive Parked Items

The system SHALL archive parked requirements that have been inactive for more than 30 days.

#### Scenario: Old parked items archived
- **WHEN** the monthly review runs
- **THEN** the system SHALL scan session summaries to find requirements that were parked more than 30 days ago and have not been retried since
- **AND** SHALL update the roadmap to mark them with `[-]` (archived) status

#### Scenario: Active parked items preserved
- **WHEN** a parked item was retried within the last 30 days
- **THEN** it SHALL not be archived

### Monthly Cost Review

The system SHALL aggregate cost data from session summaries and produce a monthly cost report.

#### Scenario: Cost aggregation from session summaries
- **WHEN** the monthly cost review runs
- **THEN** the system SHALL scan all `*-summary.json` files in `active-agents/<projectId>/orchestrator/logs/`
- **AND** SHALL aggregate: total cost, cost per session, cost per completed requirement, and total agent invocations

#### Scenario: Month-over-month comparison
- **WHEN** cost data exists for the previous month
- **THEN** the report SHALL include month-over-month cost change percentages

#### Scenario: Cost anomaly flagging
- **WHEN** a project's monthly cost has increased by more than 50% compared to the previous month
- **THEN** the report SHALL flag it for human review with a breakdown of cost drivers

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
