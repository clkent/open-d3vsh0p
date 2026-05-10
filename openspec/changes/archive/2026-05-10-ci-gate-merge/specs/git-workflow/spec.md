## MODIFIED Requirements

### Session Consolidation
The system SHALL automatically consolidate completed session branches to main at session end by creating a pull request and merging it.

The consolidation SHALL only occur when the session has at least one completed requirement.

The consolidation SHALL use the existing `consolidateToMain()` method with enhanced PR metadata.

The PR title SHALL follow the format `chore(<projectId>): consolidate session <sessionId>`.

The PR body SHALL include the list of completed requirement IDs, parked requirement IDs, and total session cost.

After creating the PR, the system SHALL wait for CI status checks to complete by running `gh pr checks --watch --fail-fast` with a configurable timeout (default: 10 minutes).

If all CI checks pass, the system SHALL merge the PR, delete the remote branch, and pull main locally.

If any CI check fails or the timeout is reached, the system SHALL NOT merge the PR. It SHALL leave the PR open, log a warning with the PR URL and failing check names, and print a console message directing the developer to fix the issue in pair mode.

When the repository has no CI checks configured, the system SHALL treat this as a pass and merge immediately.

Consolidation failure SHALL be non-fatal: the system SHALL log a warning with the error message and session branch name, and continue with normal session exit.

#### Scenario: Successful consolidation after session with completed work
- **WHEN** a session completes with 3 completed requirements and 1 parked requirement
- **AND** CI checks pass within the timeout
- **THEN** the system SHALL push the session branch, create a PR with title `chore(proj-001): consolidate session 2026-02-18-04-40`, wait for checks, merge the PR, delete the remote branch, and pull main locally

#### Scenario: No consolidation when no work completed
- **WHEN** a session completes with 0 completed requirements (all parked or no work done)
- **THEN** the system SHALL skip consolidation entirely

#### Scenario: CI checks fail
- **WHEN** consolidation creates a PR and CI checks fail
- **THEN** the system SHALL NOT merge the PR
- **AND** the system SHALL print a warning: `CI checks failed on <PR URL>. Fix in pair mode and merge manually.`
- **AND** the system SHALL log the failing check names
- **AND** the PR SHALL remain open for manual intervention
- **AND** the session exit code SHALL NOT change due to the CI failure

#### Scenario: CI check timeout
- **WHEN** consolidation creates a PR and CI checks do not complete within the configured timeout
- **THEN** the system SHALL treat this the same as a check failure (skip merge, warn, leave PR open)

#### Scenario: No CI checks configured
- **WHEN** consolidation creates a PR and the repository has no status checks configured
- **THEN** the system SHALL merge immediately without waiting

#### Scenario: Consolidation failure is non-fatal
- **WHEN** consolidation fails (merge conflict, network error, gh CLI error)
- **THEN** the system SHALL print a warning to console: `Auto-consolidation failed: <error>. Branch <branch> was pushed — merge manually.`
- **AND** the session exit code SHALL NOT change due to the consolidation failure

#### Scenario: Consolidation skipped with --no-consolidate flag
- **WHEN** the `--no-consolidate` CLI flag is set
- **THEN** the system SHALL skip auto-consolidation and behave as before (push only)
