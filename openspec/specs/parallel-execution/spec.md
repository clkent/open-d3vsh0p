# Parallel Execution

## Purpose
Orchestrates roadmap-driven parallel development by parsing a structured roadmap into phases and groups, executing groups concurrently via git worktrees and agent personas, and serializing merge operations through an async mutex.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/parallel-orchestrator.js` — phase loop, group concurrency, worktree lifecycle, and merge coordination
- `platform/orchestrator/src/roadmap-reader.js` — roadmap.md parsing, dependency resolution, status tracking, and item marking
- `platform/orchestrator/src/merge-lock.js` — async mutex for serialized merge operations

## Requirements

### Roadmap Parsing
The system SHALL parse a `roadmap.md` file from `{projectDir}/openspec/roadmap.md` into a structured hierarchy of phases, groups, and items.

The title SHALL be extracted from the pattern `# Roadmap: {title}`.

Phases SHALL be extracted from `## Phase {number}: {label}` headings, where number can be Roman numerals (I, II, III) or Arabic numerals.

Groups SHALL be extracted from `### Group {letter}: {label}` headings under each phase, where letter is a single uppercase character (A, B, C).

Items SHALL be extracted from checkbox lines matching `- [{marker}] \`{id}\` -- {description}`, where marker is ` ` (pending), `x` (complete), or `!` (parked).

#### Scenario: Parse complete roadmap
- **WHEN** `parse()` is called on a valid roadmap.md
- **THEN** the result SHALL be `{ title, phases: [{ number, label, depends, groups: [{ letter, label, items: [{ id, description, status }] }] }] }`

#### Scenario: Item status detection
- **WHEN** an item line contains `- [x]`
- **THEN** its status SHALL be `complete`
- **WHEN** an item line contains `- [!]`
- **THEN** its status SHALL be `parked`
- **WHEN** an item line contains `- [ ]`
- **THEN** its status SHALL be `pending`

#### Scenario: getAllItems flattens the hierarchy
- **WHEN** `getAllItems(roadmap)` is called
- **THEN** the result SHALL be a flat array of all items across all phases and groups, each augmented with `phaseNumber`, `phaseLabel`, `groupLetter`, and `groupLabel`

### Phase Dependencies
The system SHALL resolve phase dependencies from explicit HTML comments and implicit ordering.

Explicit dependencies SHALL be declared via `<!-- depends: Phase {number} -->` comments within a phase section.

Implicit dependencies SHALL be set automatically: each phase after the first SHALL depend on the immediately preceding phase unless an explicit dependency is declared.

#### Scenario: Explicit dependency
- **WHEN** Phase II contains `<!-- depends: Phase I -->` in the roadmap
- **THEN** Phase II's `depends` property SHALL be set to `"I"`

#### Scenario: Implicit dependency
- **WHEN** Phase III has no explicit depends comment and Phase II is the preceding phase with number "II"
- **THEN** Phase III's `depends` property SHALL be set to `"II"`

#### Scenario: First phase has no dependency
- **WHEN** the first phase in the roadmap has no depends comment
- **THEN** its `depends` property SHALL remain null, making it immediately eligible for execution

#### Scenario: Dependency satisfaction check
- **WHEN** `getNextPhase(roadmap, blockingParkedIds)` evaluates a phase whose dependency phase has all items complete or parked (non-blocking)
- **THEN** that phase SHALL be considered ready and returned as the next phase

### Group Concurrency
The system SHALL execute all pending groups within a phase concurrently using `Promise.allSettled()`.

Each group SHALL be assigned a persona from the AgentPool via `assignMany()`.

Group results SHALL be logged individually regardless of success or failure (since `allSettled` captures both).

#### Scenario: Two groups execute in parallel
- **WHEN** a phase has Group A and Group B both with pending items
- **THEN** the system SHALL call `Promise.allSettled([_executeGroup(A), _executeGroup(B)])` so both run concurrently

#### Scenario: One group fails, other succeeds
- **WHEN** Group A's promise rejects and Group B's promise resolves
- **THEN** the system SHALL log an error for Group A and a success for Group B, without aborting the phase

#### Scenario: No pending groups in phase
- **WHEN** `getPendingGroups(phase)` returns an empty array
- **THEN** `_executePhase` SHALL return immediately without spawning any agents

### Git Worktrees per Group
The system SHALL create a dedicated git worktree for each concurrent group at `{projectDir}/.worktrees/group-{letter}`.

Each worktree SHALL be created with a new branch `devshop/worktree-{sessionId}/group-{letter}` based on the session branch.

Worktrees SHALL be cleaned up (removed with `--force`) in a finally block after all items in the group are processed.

#### Scenario: Worktree creation for group
- **WHEN** `_executeGroup` starts for Group A
- **THEN** the system SHALL call `createWorktreeWithNewBranch` with worktreePath `.worktrees/group-a`, newBranch `devshop/worktree-{sessionId}/group-a`, and sourceBranch equal to the session branch

#### Scenario: Worktree cleanup on success
- **WHEN** all items in a group complete successfully
- **THEN** the system SHALL call `removeWorktree` and attempt to delete the worktree branch with `git branch -D`

#### Scenario: Worktree cleanup on error
- **WHEN** an error occurs during group execution
- **THEN** the finally block SHALL still attempt to remove the worktree and delete the branch (best-effort, errors suppressed)

### Merge Lock
The system SHALL serialize all merge operations through an async mutex (MergeLock) to prevent concurrent git merge conflicts.

The MergeLock SHALL use a promise-based queue: if the lock is already held, callers wait in a FIFO queue.

The `withLock(fn)` method SHALL automatically release the lock when the function completes, including on error (via finally).

#### Scenario: Sequential merge serialization
- **WHEN** two groups finish simultaneously and both call `mergeLock.withLock(mergeFn)`
- **THEN** the first merge SHALL execute immediately and the second SHALL wait in the queue until the first completes

#### Scenario: Lock release on merge error
- **WHEN** a merge operation inside `withLock` throws an error
- **THEN** the lock SHALL still be released (via finally) so that subsequent merges are not permanently blocked

#### Scenario: Lock state inspection
- **WHEN** the lock is held and one operation is queued
- **THEN** `isLocked` SHALL return true and `queueLength` SHALL return 1

#### Scenario: Post-merge worktree sync
- **WHEN** a merge completes successfully inside the lock
- **THEN** the system SHALL update the worktree branch by merging the latest session branch back into it (best-effort, failure tolerated)

### Roadmap Status Updates
The system SHALL update the roadmap.md file in-place to reflect item completion or parking.

The `markItemComplete(id)` method SHALL change the checkbox marker from any state to `[x]` for the matching requirement ID.

The `markItemParked(id)` method SHALL change the checkbox marker from any state to `[!]` for the matching requirement ID.

#### Scenario: Mark item complete
- **WHEN** `markItemComplete('user-auth')` is called and the roadmap contains `- [ ] \`user-auth\` -- Description`
- **THEN** the file SHALL be rewritten with `- [x] \`user-auth\` -- Description`

#### Scenario: Mark item parked
- **WHEN** `markItemParked('api-routes')` is called
- **THEN** the checkbox marker for `api-routes` SHALL be changed to `[!]`

#### Scenario: Regex escaping in requirement IDs
- **WHEN** a requirement ID contains regex-special characters (e.g., dots or brackets)
- **THEN** the system SHALL escape them via `_escapeRegex` before constructing the replacement pattern

### `[HUMAN]` Auto-Park
The system SHALL auto-park roadmap items tagged with `[HUMAN]` before executing any groups in a phase. These items are classified as `non_blocking` immediately and never sent to agents.

#### Scenario: `[HUMAN]` items parked before group execution
- **WHEN** `_executePhase` runs and the phase contains pending items with `isHuman: true`
- **THEN** those items SHALL be parked with `triageClassification: 'non_blocking'` before any groups are assigned to agents

### Between-Phase Report Processing
After each phase completes and the session branch is pushed, the system SHALL check for pending user-reported issues in the report queue and process them before proceeding to parked-item triage or the next phase.

The report processing SHALL occur at the safe point where no agents are running and no worktrees exist.

The system SHALL log `reports_processing_started` with the count of pending reports, and `reports_processing_complete` with results.

#### Scenario: Reports exist in queue after phase completion
- **WHEN** a phase completes, the session branch is pushed, and `reported-issues.json` contains pending reports
- **THEN** the system SHALL invoke the report processor to handle all pending reports before continuing to triage or the next phase

#### Scenario: No reports in queue after phase completion
- **WHEN** a phase completes and no pending reports exist in the queue
- **THEN** the system SHALL skip report processing and proceed directly to triage

#### Scenario: Report processing does not block phase progression
- **WHEN** report processing completes (regardless of individual report success or failure)
- **THEN** the system SHALL continue to parked-item triage and the next phase as normal

### Triage Integration
After a phase completes with parked items, the system SHALL invoke a triage agent to classify unclassified parked items as BLOCKING or NON_BLOCKING for dependent phases (see triage-classification spec for full details).

The blocking IDs SHALL be passed to `getNextPhase()` to prevent dependent phases from starting when critical dependencies are missing.

#### Scenario: Blocking IDs passed to phase progression
- **WHEN** the phase loop calls `getNextPhase` after triage
- **THEN** it SHALL pass `_getBlockingIdsFromState()` as the `blockingParkedIds` argument

### Persona Logging
Group completion and failure logs SHALL include the assigned persona name and agentType for traceability.

#### Scenario: Group complete log
- **WHEN** a group completes successfully
- **THEN** the log entry SHALL include `persona` (name) and `agentType` fields

#### Scenario: Group failed log
- **WHEN** a group fails
- **THEN** the log entry SHALL include `persona` (name) and `agentType` fields

### Phase Completion Detection
The system SHALL detect when all phases are complete and terminate the session.

The `isComplete(roadmap)` method SHALL return true when every item in every group in every phase has status `complete` or `parked`.

The phase loop SHALL re-parse the roadmap file on each iteration to pick up status changes made during execution.

#### Scenario: All items complete
- **WHEN** `isComplete(roadmap)` is called and every item across all phases is `complete` or `parked`
- **THEN** the method SHALL return true and the phase loop SHALL transition to SESSION_COMPLETE

#### Scenario: Pending items remain
- **WHEN** at least one item in any phase has status `pending`
- **THEN** `isComplete` SHALL return false and the phase loop SHALL continue

#### Scenario: No ready phases but items remain
- **WHEN** `getNextPhase(roadmap)` returns null because remaining phases have unsatisfied dependencies
- **THEN** the system SHALL log "no_ready_phases" and transition to SESSION_COMPLETE

### Post-Merge Integration Test
After a successful merge to the session branch inside the merge lock, the system SHALL run the project test suite on the session branch before releasing the lock. This validates that the merged code does not regress existing functionality from other parallel merges.

#### Scenario: Integration test after merge
- **WHEN** `mergeToSession()` completes successfully inside the merge lock
- **THEN** the system SHALL run `runHealthCheck()` with test commands on the project directory before releasing the lock

### Phase Gate
After all groups in a phase finish executing and before the session branch is pushed, the system SHALL run a full health check on the session branch. If the check fails, the system SHALL attempt a project diagnostic. The phase gate SHALL NOT block phase progression — failures are logged as warnings.

#### Scenario: Phase gate runs after phase execution
- **WHEN** `_executePhase()` completes with at least one merged requirement
- **THEN** the system SHALL call `runHealthCheck()` before `_pushSessionBranch()`

#### Scenario: Phase gate failure triggers diagnostic
- **WHEN** the phase gate health check fails
- **THEN** the system SHALL call `_runProjectDiagnostic(phase)` to attempt a fix

### Review Phase Context
The microcycle SHALL receive phase context (list of other merged requirements in the current phase) and include it in the review prompt sent to the principal engineer.

#### Scenario: Phase context threaded to review
- **WHEN** a microcycle is created for a requirement in a phase where other items have already merged
- **THEN** the microcycle SHALL pass the list of merged item IDs and descriptions to the review prompt builder
