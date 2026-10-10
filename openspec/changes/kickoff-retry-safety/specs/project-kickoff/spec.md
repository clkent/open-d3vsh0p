## ADDED Requirements

### Requirement: Scaffold Preflight for GitHub Token Scopes
The scaffolder SHALL verify, before creating any repository or directory, that the authenticated `gh` token carries every scope the initial push needs. When the project starter template contains files under `.github/workflows/`, the `workflow` scope is required.

#### Scenario: Token lacks workflow scope
- **WHEN** kickoff starts and `gh auth status` reports token scopes without `workflow` while the starter template includes `.github/workflows/test.yml`
- **THEN** the scaffolder SHALL fail with an error naming the missing scope and the command `gh auth refresh -h github.com -s workflow`
- **AND** no GitHub repo, project directory, or registry entry SHALL be created

#### Scenario: Token has required scopes
- **WHEN** `gh auth status` reports scopes including `repo` and `workflow`
- **THEN** the scaffolder SHALL proceed to repo creation

#### Scenario: Scopes cannot be determined
- **WHEN** `gh auth status` succeeds but its output has no parseable `Token scopes:` line
- **THEN** the scaffolder SHALL log a warning and proceed rather than block kickoff

### Requirement: Scaffold Retry Safety
Re-running `kickoff` after a failed push SHALL complete without manual cleanup of the remote repo or local project directory. Every scaffold step after repo creation MUST be idempotent.

#### Scenario: Retry after push rejection
- **WHEN** a previous kickoff created the remote repo and committed the scaffold locally but its push was rejected, and the user re-runs `./devshop kickoff <name>` after fixing the cause
- **THEN** the scaffolder SHALL reuse the existing repo and directory, skip the commit because the working tree is clean, push, and write the registry entry

#### Scenario: Clean working tree at commit step
- **WHEN** the scaffolder reaches the initial-commit step and `git status --porcelain` is empty
- **THEN** it SHALL log `kickoff_nothing_to_commit` and continue to push without invoking `git commit`

#### Scenario: Push rejected for missing scope
- **WHEN** the initial push fails and GitHub's response mentions the `workflow` scope
- **THEN** the scaffold error SHALL include the `gh auth refresh -h github.com -s workflow` remedy instead of only the raw git output
