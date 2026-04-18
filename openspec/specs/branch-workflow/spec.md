# Branch Workflow Enforcement

## Purpose
Ensure all code changes go through feature branches and pull requests before being merged to main. No direct pushes to main. This applies to both human developers and Claude Code agents working on the DevShop repository.

## Status
IMPLEMENTED

## Source Files
- `CLAUDE.md` — instructions for Claude Code to always use branches and PRs
- `.githooks/pre-push` — local git hook preventing direct pushes to main

## Requirements

### No Direct Pushes to Main
All changes to the main branch SHALL go through a pull request from a feature branch. Direct pushes to main SHALL be blocked by a local pre-push git hook.

#### Scenario: Developer pushes to feature branch
- **WHEN** a developer runs `git push origin feat/my-feature`
- **THEN** the push SHALL succeed normally

#### Scenario: Developer attempts direct push to main
- **WHEN** a developer runs `git push origin main`
- **THEN** the pre-push hook SHALL reject the push with a message explaining that direct pushes to main are not allowed and a PR is required

#### Scenario: Force push to main blocked
- **WHEN** a developer runs `git push --force origin main`
- **THEN** the pre-push hook SHALL reject the push

### Feature Branch Convention
Feature branches SHALL follow the naming convention `<type>/<description>` where type is one of: feat, fix, chore, docs, refactor, test.

#### Scenario: New feature work
- **WHEN** starting work on a new feature
- **THEN** a branch SHALL be created with the pattern `feat/<kebab-case-description>`

#### Scenario: Bug fix
- **WHEN** fixing a bug
- **THEN** a branch SHALL be created with the pattern `fix/<kebab-case-description>`

### Pull Request Workflow
All changes SHALL be submitted via GitHub pull requests with a summary and test plan.

#### Scenario: Feature complete and ready for merge
- **WHEN** work on a feature branch is complete
- **THEN** the developer SHALL push the branch and create a PR using `gh pr create`

#### Scenario: PR merged to main
- **WHEN** a PR is approved and merged
- **THEN** the feature branch SHALL be deleted after merge

### Claude Code Enforcement
Claude Code agents working in this repository SHALL always create feature branches for changes and submit PRs rather than pushing directly to main. This SHALL be enforced via CLAUDE.md project instructions.

#### Scenario: Claude Code making changes
- **WHEN** Claude Code is asked to implement changes
- **THEN** it SHALL create a feature branch, commit on that branch, push it, and create a PR

#### Scenario: Claude Code asked to push to main
- **WHEN** Claude Code is asked to push directly to main
- **THEN** it SHALL explain the branch workflow and offer to create a PR instead
