# Session Exit Push

## Purpose
Ensures that all interactive session commands (plan, talk, pair, kickoff) automatically detect and push uncommitted changes when the user exits the session. This prevents data loss from file edits made by agents during interactive conversations.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/commands/plan.js` -- commitAndPush on exit (original implementation)
- `platform/orchestrator/src/commands/pair.js` -- commitAndPush on exit (original implementation)
- `platform/orchestrator/src/commands/talk.js` -- commitAndPush on exit (added)
- `platform/orchestrator/src/commands/kickoff.js` -- commitAndPush on exit (added)

## Requirements

### Exit-time change detection
All interactive session commands SHALL check for uncommitted changes when the user types "done" or "exit" by running `git status --porcelain` in the project directory. If the output is non-empty, the command SHALL print a notice and invoke `commitAndPush()`.

#### Scenario: Changes exist on exit
- **WHEN** the user types "done" and `git status --porcelain` returns non-empty output
- **THEN** the command SHALL print "You have unpushed changes. Pushing to GitHub..."
- **AND** SHALL call `commitAndPush()` to create a feature branch, commit, push, create a PR, merge it, and return to main

#### Scenario: No changes on exit
- **WHEN** the user types "done" and `git status --porcelain` returns empty output
- **THEN** the command SHALL proceed with normal exit without any git operations

#### Scenario: Git check fails
- **WHEN** `git status --porcelain` throws an error (e.g., not a git repo)
- **THEN** the command SHALL silently catch the error and proceed with normal exit

### Branch naming
Each command SHALL use a contextual branch name prefix:
- plan: `chore/plan-{timestamp}`
- talk: `chore/talk-{timestamp}`
- pair: `fix/pair-{timestamp}`
- kickoff: `feat/specs-{timestamp}`

### Commit and push flow
The `commitAndPush()` function SHALL:
1. Check `git status --porcelain` — return early if no changes
2. Create a new branch with the contextual prefix
3. `git add -A` all changes
4. Commit with a descriptive message
5. Push the branch to origin
6. Create a PR via `gh pr create`
7. Merge the PR via `gh pr merge --merge`
8. Return to main and pull

If any step fails, the function SHALL log a warning and return without blocking exit.
