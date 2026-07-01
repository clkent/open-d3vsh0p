## MODIFIED Requirements

### Requirement: Group Concurrency
The system SHALL support two modes of group concurrency within a phase:

1. **Morgan-delegated**: Morgan spawns sub-agents via the Claude Code Agent tool with `isolation: "worktree"` for each independent group. Morgan writes targeted briefs and reviews output before marking items complete.
2. **Direct execution**: Morgan implements group items sequentially when parallelism is unnecessary (single group or simple items).

Morgan SHALL decide which mode to use based on the phase structure and item complexity.

#### Scenario: Morgan delegates multiple groups
- **WHEN** Morgan encounters a phase with Group A and Group B, both with pending items, and determines parallelism is beneficial
- **THEN** Morgan SHALL spawn sub-agents via the Agent tool with worktree isolation, providing each with a scoped implementation brief

#### Scenario: Morgan works sequentially
- **WHEN** Morgan encounters a phase with a single group or determines the items are simple
- **THEN** Morgan SHALL implement the items directly without spawning sub-agents

#### Scenario: Sub-agent output reviewed by Morgan
- **WHEN** a sub-agent completes its delegated work
- **THEN** Morgan SHALL review the changes for consistency with the broader codebase before accepting them

### Requirement: Git Worktrees per Group
The system SHALL create a dedicated git worktree for each concurrent group at `{projectDir}/.worktrees/group-{letter}`.

Each worktree SHALL be created with a new branch `devshop/worktree-{sessionId}/group-{letter}` based on the session branch.

Worktrees SHALL be cleaned up (removed with `--force`) in a finally block after all items in the group are processed.

When Morgan delegates to sub-agents, worktree isolation SHALL be handled by the Claude Code Agent tool's `isolation: "worktree"` parameter rather than the orchestrator's git-ops module.

#### Scenario: Sub-agent worktree via Agent tool
- **WHEN** Morgan spawns a sub-agent with `isolation: "worktree"`
- **THEN** the Agent tool SHALL create a temporary git worktree for the sub-agent, and clean it up when the sub-agent completes

#### Scenario: Worktree creation for group
- **WHEN** `_executeGroup` starts for Group A
- **THEN** the system SHALL call `createWorktreeWithNewBranch` with worktreePath `.worktrees/group-a`, newBranch `devshop/worktree-{sessionId}/group-a`, and sourceBranch equal to the session branch

#### Scenario: Worktree cleanup on success
- **WHEN** all items in a group complete successfully
- **THEN** the system SHALL call `removeWorktree` and attempt to delete the worktree branch with `git branch -D`

#### Scenario: Worktree cleanup on error
- **WHEN** an error occurs during group execution
- **THEN** the finally block SHALL still attempt to remove the worktree and delete the branch (best-effort, errors suppressed)

### Requirement: Roadmap Status Updates
The system SHALL update the roadmap.md file in-place to reflect item completion or parking.

Morgan SHALL edit roadmap.md directly to mark items complete by changing `[ ]` to `[x]` after implementing each item and verifying tests pass.

The `markItemComplete(id)` method SHALL remain available for programmatic use by the run lifecycle wrapper.

The `markItemParked(id)` method SHALL change the checkbox marker from any state to `[!]` for the matching requirement ID.

#### Scenario: Morgan marks item complete directly
- **WHEN** Morgan finishes a roadmap item and tests pass
- **THEN** Morgan SHALL edit roadmap.md to change `- [ ] \`item-id\`` to `- [x] \`item-id\`` and commit the change

#### Scenario: Mark item complete programmatically
- **WHEN** `markItemComplete('user-auth')` is called and the roadmap contains `- [ ] \`user-auth\` -- Description`
- **THEN** the file SHALL be rewritten with `- [x] \`user-auth\` -- Description`

#### Scenario: Mark item parked
- **WHEN** `markItemParked('api-routes')` is called
- **THEN** the checkbox marker for `api-routes` SHALL be changed to `[!]`

#### Scenario: Regex escaping in requirement IDs
- **WHEN** a requirement ID contains regex-special characters (e.g., dots or brackets)
- **THEN** the system SHALL escape them via `_escapeRegex` before constructing the replacement pattern
