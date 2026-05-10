# Git Workflow

## Purpose
Manages all git operations for the orchestrator, including session and work branch creation, commits, merges, diffs, and worktree management for parallel execution.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/git-ops.js` — git command execution, branch management, commit/merge operations, diff retrieval, and worktree lifecycle

## Requirements

### Session Branches
The system SHALL create session branches from main using the naming convention `devshop/session-{sessionId}`.

The system SHALL checkout `main` before creating the session branch to ensure a clean base.

#### Scenario: New session branch creation
- **WHEN** `createSessionBranch(projectDir, 'devshop/session-2026-02-10-14-30')` is called
- **THEN** the system SHALL run `git checkout main` followed by `git checkout -b devshop/session-2026-02-10-14-30` and log the branch creation

#### Scenario: Session branch already exists
- **WHEN** a session branch with the same name already exists in the repository
- **THEN** the `git checkout -b` command SHALL fail and the error SHALL propagate with a message starting with "git checkout failed:"

### Work Branches
The system SHALL create work branches from the session branch using the naming convention `devshop/work-{sessionSuffix}/{requirementId}`.

The session suffix SHALL be extracted by stripping the `devshop/session-` prefix from the session branch name.

#### Scenario: Work branch creation
- **WHEN** `createWorkBranch(projectDir, 'devshop/session-2026-02-10', 'user-auth')` is called
- **THEN** the system SHALL checkout the session branch, then create `devshop/work-2026-02-10/user-auth` and return that branch name

#### Scenario: Multiple work branches from same session
- **WHEN** two work branches are created for requirements `user-auth` and `api-routes` from the same session
- **THEN** the branches SHALL be `devshop/work-{suffix}/user-auth` and `devshop/work-{suffix}/api-routes`, both based on the session branch

### Commit All
The system SHALL stage all changes and commit them atomically, returning the commit SHA or null if there are no changes.

The system SHALL check for changes using `git status --porcelain` before attempting to commit.

#### Scenario: Commit with changes
- **WHEN** `commitAll(projectDir, message)` is called and `git status --porcelain` returns non-empty output
- **THEN** the system SHALL run `git add -A`, `git commit -m {message}`, extract the HEAD SHA via `git rev-parse HEAD`, log the commit, and return the SHA string

#### Scenario: Commit with no changes
- **WHEN** `commitAll(projectDir, message)` is called and `git status --porcelain` returns empty output
- **THEN** the system SHALL return null without running git add or git commit

#### Scenario: Change detection
- **WHEN** `hasChanges(projectDir)` is called
- **THEN** the system SHALL return true if `git status --porcelain` output is non-empty, false otherwise

### Merge Work to Session
The system SHALL merge work branches into the session branch using `--no-ff` to preserve merge history.

The merge commit message SHALL follow the format `merge: {requirementId}`.

#### Scenario: Successful merge
- **WHEN** `mergeWorkToSession(projectDir, sessionBranch, workBranch, requirementId)` is called
- **THEN** the system SHALL checkout the session branch, run `git merge --no-ff {workBranch} -m "merge: {requirementId}"`, and log the merge

#### Scenario: Merge to session with custom message
- **WHEN** `mergeToSession(projectDir, sessionBranch, sourceBranch, commitMessage)` is called
- **THEN** the system SHALL checkout the session branch and run `git merge --no-ff {sourceBranch} -m {commitMessage}`

### Diff and Log Retrieval
The system SHALL retrieve diffs and logs using three-dot syntax with a fallback to two-dot syntax.

#### Scenario: Diff with common ancestor (three-dot)
- **WHEN** `getDiff(projectDir, baseBranch)` is called and the branches share a common ancestor
- **THEN** the system SHALL run `git diff {baseBranch}...HEAD` and return the stdout

#### Scenario: Diff fallback (two-dot)
- **WHEN** `getDiff(projectDir, baseBranch)` is called and the three-dot diff fails (no common ancestor)
- **THEN** the system SHALL fall back to `git diff {baseBranch}` (two-dot syntax)

#### Scenario: Diff stat retrieval
- **WHEN** `getDiffStat(projectDir, baseBranch)` is called
- **THEN** the system SHALL run `git diff --stat {baseBranch}...HEAD` and return the output, or return an empty string on failure

#### Scenario: Log between branches
- **WHEN** `getLog(projectDir, baseBranch)` is called
- **THEN** the system SHALL run `git log --oneline {baseBranch}..HEAD` (two-dot) and return the output, or return an empty string on failure

### Worktree Support
The system SHALL manage git worktrees for parallel execution, supporting creation, removal, and listing.

#### Scenario: Create worktree from existing branch
- **WHEN** `createWorktree(projectDir, worktreePath, branchName)` is called
- **THEN** the system SHALL run `git worktree add {worktreePath} {branchName}` and log the creation

#### Scenario: Create worktree with new branch
- **WHEN** `createWorktreeWithNewBranch(projectDir, worktreePath, newBranch, sourceBranch)` is called
- **THEN** the system SHALL run `git worktree add -b {newBranch} {worktreePath} {sourceBranch}` and log the creation with the source branch

#### Scenario: Remove worktree
- **WHEN** `removeWorktree(projectDir, worktreePath)` is called
- **THEN** the system SHALL run `git worktree remove {worktreePath} --force` and log the removal

#### Scenario: Remove already-gone worktree
- **WHEN** `removeWorktree` is called and the worktree path no longer exists
- **THEN** the system SHALL log a warning but SHALL NOT throw an error

#### Scenario: List worktrees
- **WHEN** `listWorktrees(projectDir)` is called
- **THEN** the system SHALL run `git worktree list` and return the stdout

### Push to Remote
The system SHALL support pushing branches to the remote origin via `pushBranch(projectDir, branchName)`.

The orchestrator SHALL push the session branch after each phase completes and at session end, so progress is visible on GitHub. Push failures SHALL be caught and logged as warnings without crashing the session.

After the final session-end push, the system SHALL attempt auto-consolidation to main (unless `--no-consolidate` is set). See the Session Consolidation requirement for details.

#### Scenario: Push session branch
- **WHEN** `pushBranch(projectDir, branchName)` is called
- **THEN** the system SHALL run `git push -u origin {branchName}` and log the push

#### Scenario: Push after phase completion
- **WHEN** a phase completes and at least one requirement has been completed in the session
- **THEN** the orchestrator SHALL call `pushBranch` with the session branch

#### Scenario: Push failure is non-fatal
- **WHEN** `pushBranch` fails (e.g. no remote, network error)
- **THEN** the orchestrator SHALL log a warning with the error message and continue execution

#### Scenario: Skip push with no completed work
- **WHEN** the session has zero completed requirements
- **THEN** the push SHALL be skipped (nothing useful to push)

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

### Branch Existence Checking
The system SHALL provide a non-throwing method to check whether a branch exists.

#### Scenario: Branch exists
- **WHEN** `branchExists(projectDir, 'main')` is called and the branch exists
- **THEN** the system SHALL run `git rev-parse --verify main` and return true

#### Scenario: Branch does not exist
- **WHEN** `branchExists(projectDir, 'nonexistent-branch')` is called
- **THEN** the system SHALL catch the rev-parse error and return false
