# Orchestrator Core

## Purpose
Manages the lifecycle of a DevShop session through a finite state machine that drives requirements through implement-test-commit-review-merge microcycles, with atomic state persistence, retry logic, and crash recovery.

## Status
IMPLEMENTED

## Source Files
- `platform/orchestrator/src/state-machine.js` — finite state machine with 14 states, atomic disk persistence, and crash recovery
- `platform/orchestrator/src/orchestrator.js` — session lifecycle, main run loop, and state-driven dispatch
- `platform/orchestrator/src/microcycle.js` — self-contained implement-test-commit-review cycle for a single requirement
- `platform/orchestrator/src/json-extractor.js` — shared JSON extraction utility for parsing agent output
- `platform/orchestrator/src/health-checker.js` — health check runner with auto-detection and configurable commands
## Requirements

### State Machine Transitions
The system SHALL enforce a finite state machine with exactly 14 states and a fixed set of valid transitions between them.

The 14 states SHALL be: IDLE, LOADING_ROADMAP, EXECUTING_PHASE, PHASE_COMPLETE, SELECTING_REQUIREMENT, IMPLEMENTING, RUNNING_TESTS, COMMITTING, REVIEWING, MERGING, PARKING, BLOCKING_FIX, PROJECT_REPAIR, and SESSION_COMPLETE.

The system SHALL reject any transition not in the VALID_TRANSITIONS map by throwing an error containing the current state, the attempted state, and the list of allowed target states.

BLOCKING_FIX SHALL be entered from PARKING when a blocking park triggers the fix flow. Valid transitions from BLOCKING_FIX SHALL be to SESSION_COMPLETE.

SESSION_COMPLETE SHALL be a terminal state with no outgoing transitions.

#### Scenario: Valid transition from IMPLEMENTING to RUNNING_TESTS
- **WHEN** the state machine is in IMPLEMENTING and a transition to RUNNING_TESTS is requested
- **THEN** the state SHALL update to RUNNING_TESTS and the updatedAt timestamp SHALL be refreshed

#### Scenario: Invalid transition from IDLE to MERGING
- **WHEN** the state machine is in IDLE and a transition to MERGING is requested
- **THEN** the system SHALL throw an error with message "Invalid transition: IDLE -> MERGING" and list the allowed transitions (SELECTING_REQUIREMENT, LOADING_ROADMAP)

#### Scenario: Transition from terminal state
- **WHEN** the state machine is in SESSION_COMPLETE and any transition is requested
- **THEN** the system SHALL throw an error indicating no transitions are allowed from the terminal state

#### Scenario: Transition with state updates
- **WHEN** a transition is requested with an updates object containing nested properties (requirements, retryCounters, consumption, currentRequirement)
- **THEN** the system SHALL shallow-merge each nested object individually, preserving existing keys not included in the update

#### Scenario: Transition to BLOCKING_FIX
- **WHEN** a blocking park is detected and the state is PARKING
- **THEN** the system SHALL transition to BLOCKING_FIX with the blocking item's ID and error stored in state

#### Scenario: BLOCKING_FIX to SESSION_COMPLETE
- **WHEN** the blocking fix flow completes (either via auto-restart signal or pair-mode exit)
- **THEN** the system SHALL transition to SESSION_COMPLETE

PROJECT_REPAIR SHALL be entered from SELECTING_REQUIREMENT when the pre-work health check fails on a fresh session. Valid transitions from PROJECT_REPAIR SHALL be to SELECTING_REQUIREMENT (repair succeeded) or SESSION_COMPLETE (repair failed).

#### Scenario: Transition to PROJECT_REPAIR
- **WHEN** the health check gate detects failing commands on a fresh session
- **THEN** the system SHALL transition from SELECTING_REQUIREMENT to PROJECT_REPAIR

#### Scenario: PROJECT_REPAIR to SELECTING_REQUIREMENT
- **WHEN** Morgan or pair mode successfully repairs the baseline and the health check re-run passes
- **THEN** the system SHALL transition to SELECTING_REQUIREMENT to begin normal phase execution

#### Scenario: PROJECT_REPAIR to SESSION_COMPLETE
- **WHEN** both Morgan and pair mode fail to repair the baseline
- **THEN** the system SHALL transition to SESSION_COMPLETE with stop reason `health_check_failed`

### Atomic State Persistence
The system SHALL persist state to disk atomically using a write-to-temp-then-rename strategy to prevent corruption on crash.

The system SHALL write state JSON to a `.tmp` file first, then atomically rename it to the target `state.json` path.

#### Scenario: Normal state write
- **WHEN** the state machine writes to disk
- **THEN** the system SHALL write the full JSON to `{stateFilePath}.tmp` and then call `fs.rename` to atomically replace the target file

#### Scenario: Crash recovery with leftover temp file
- **WHEN** the state machine calls `load()` and a `.tmp` file exists alongside the state file
- **THEN** the system SHALL delete the `.tmp` file (which represents an incomplete write) and load the main state file

#### Scenario: No existing state file
- **WHEN** `load()` is called and no state file exists
- **THEN** the system SHALL return null, allowing the caller to call `initialize()` to create fresh state

### Microcycle Loop
The system SHALL execute a microcycle loop of implement, test, commit, review, merge for each requirement.

The Microcycle class SHALL accept a workingDir parameter allowing it to operate in a git worktree for parallel execution.

#### Scenario: Happy path microcycle
- **WHEN** a microcycle runs for a requirement and implementation succeeds, tests pass, commit produces a SHA, and the reviewer responds with APPROVE
- **THEN** the microcycle SHALL return `{ status: 'merged', cost, attempts, commitSha, workBranch, error: null }`

#### Scenario: Test failure triggers re-implementation
- **WHEN** tests fail during the microcycle and testFixRetries has not exceeded maxTestFix
- **THEN** the system SHALL set lastError to the test output, clear reviewFeedback, and loop back to the implement step

#### Scenario: Review requests changes
- **WHEN** the reviewer output contains REQUEST_CHANGES (or does not contain APPROVE)
- **THEN** the system SHALL set reviewFeedback to the review text, clear lastError, and loop back to implement

#### Scenario: Empty diff auto-approves review
- **WHEN** the diff between the work branch and session branch is empty at the review step
- **THEN** the system SHALL skip the review agent and proceed directly to the merge return

### Retry Logic
The system SHALL enforce configurable retry limits for three categories: implementation (default 3), testFix (default 3), and reviewFix (default 2).

Retry limits SHALL be configurable via the config object passed to `initialize()` or from `config.retryLimits`.

#### Scenario: Implementation retry within limit
- **WHEN** the implementation agent fails and the implementation retry counter is below max (3)
- **THEN** the system SHALL increment the counter, set lastError on the current requirement, and transition back to IMPLEMENTING

#### Scenario: Test fix retry exhausted
- **WHEN** tests fail and the testFix retry counter has reached max (3)
- **THEN** the system SHALL transition to PARKING with lastError set to "Test fix retries exhausted"

#### Scenario: Review fix retry exhausted
- **WHEN** the reviewer requests changes and the reviewFix counter has reached max (2)
- **THEN** the system SHALL transition to PARKING with lastError containing the last review feedback

### Parking Lot
The system SHALL park requirements that exhaust all retries, recording the reason, attempt count, cost, and timestamp.

Parked requirements SHALL not block remaining work unless classified as `blocking` by inline triage; the system SHALL continue to the next pending requirement only if the park is non-blocking.

#### Scenario: Requirement parked after retries exhausted
- **WHEN** a requirement exhausts its implementation retries
- **THEN** the system SHALL add a parked entry with `{ id, reason, attempts, costUsd, parkedAt }` to `requirements.parked`, set inProgress to null, and checkout the session branch

#### Scenario: Parking with remaining requirements (non-blocking)
- **WHEN** a requirement is parked as `non_blocking` and `requirements.pending` is non-empty
- **THEN** the system SHALL transition to SELECTING_REQUIREMENT to continue processing

#### Scenario: Parking with remaining requirements (blocking)
- **WHEN** a requirement is parked as `blocking` and `requirements.pending` is non-empty
- **THEN** the system SHALL NOT transition to SELECTING_REQUIREMENT
- **AND** the system SHALL initiate the blocking-park response flow

#### Scenario: Parking as last requirement
- **WHEN** a requirement is parked and `requirements.pending` is empty
- **THEN** the system SHALL transition to SESSION_COMPLETE

### Session Lifecycle
The system SHALL support creating new sessions and resuming interrupted sessions.

New session IDs SHALL be generated from the current ISO timestamp in the format `YYYY-MM-DD-HH-MM`.

#### Scenario: Creating a new session
- **WHEN** the orchestrator runs without the `--resume` flag
- **THEN** the system SHALL call `stateMachine.initialize()`, parse requirements from openspec, create a session branch, and transition to SELECTING_REQUIREMENT

#### Scenario: Resuming an interrupted session
- **WHEN** the orchestrator runs with `--resume` and existing state is not SESSION_COMPLETE
- **THEN** the system SHALL reuse the existing sessionId and resume the main loop from the persisted state

#### Scenario: Resume with completed session
- **WHEN** `--resume` is passed but the existing state is SESSION_COMPLETE
- **THEN** the system SHALL create a new session instead of resuming

#### Scenario: Early exit when roadmap is fully complete
- **WHEN** the orchestrator loads the roadmap and all items are marked complete (`[x]`)
- **THEN** the system SHALL exit immediately without creating a session branch, session state, or summary log, and SHALL print a message indicating there is no pending work

#### Scenario: Early exit when no pending items in any phase
- **WHEN** the orchestrator loads the roadmap and every phase has zero pending items (all `[x]` or `[!]`)
- **THEN** the system SHALL behave identically to the fully-complete scenario: no session created, no branches, no logs

#### Scenario: Graceful shutdown on budget exhaustion
- **WHEN** the consumption monitor reports `shouldStop()` returning true during the run loop
- **THEN** the system SHALL log a graceful_shutdown warning and transition to SESSION_COMPLETE with the latest consumption state

### HUMAN Item Surfacing

The system SHALL surface incomplete HUMAN-tagged roadmap items at the end of each session so that the user has visibility into what manual work is needed.

#### Session Output

The session-end console output SHALL include an "Action Required" section listing all incomplete HUMAN-tagged roadmap items when a roadmap exists and has such items.

Each listed item SHALL include the item ID, a cleaned description (with the `[HUMAN]` tag removed), and the phase number.

The "Action Required" section SHALL NOT appear when there are no incomplete HUMAN items or when no roadmap exists.

#### Scenario: Session ends with incomplete HUMAN items
- **WHEN** a session completes and the roadmap contains HUMAN-tagged items that are not marked complete
- **THEN** the session output SHALL print an "Action Required" section with the item ID, description, and phase for each such item

#### Scenario: Session ends with no HUMAN items
- **WHEN** a session completes and the roadmap contains no HUMAN-tagged items (or all are complete)
- **THEN** the session output SHALL NOT include an "Action Required" section

#### Summary JSON

The summary JSON written by `writeSummary()` SHALL include a `humanItems` array containing objects with `{ id, description, phase, status }` for each incomplete HUMAN-tagged roadmap item.

The `humanItems` array SHALL default to an empty array when no HUMAN items are provided.

#### Scenario: Summary JSON with HUMAN items
- **WHEN** `writeSummary()` is called with a `humanItems` option containing items
- **THEN** the summary JSON SHALL include those items in the `humanItems` field

#### Scenario: Summary JSON without HUMAN items
- **WHEN** `writeSummary()` is called without a `humanItems` option
- **THEN** the summary JSON SHALL include `humanItems: []`

### Cross-Session Failure History

When a session starts with the `--fresh` flag and previous state contains parked items, the orchestrator SHALL capture failure history from the parked entries before they are reset.

The failure history SHALL be stored as a Map keyed by requirement ID, with each entry containing the failure reason, attempt count, and cost from the previous session.

#### Scenario: Fresh session with previous parked items
- **WHEN** `--fresh` is set and the existing state has parked requirements
- **THEN** the orchestrator SHALL capture each parked item's `reason`, `attempts`, and `costUsd` into `_failureHistory` before resetting parked items to pending

#### Scenario: Fresh session with no previous state
- **WHEN** `--fresh` is set but no existing state exists (first session)
- **THEN** `_failureHistory` SHALL remain null and parked items SHALL still be reset

#### Scenario: Non-fresh session
- **WHEN** `--fresh` is not set
- **THEN** `_failureHistory` SHALL remain null (resume sessions do not reset parked items)

### Failure History Injection into Microcycle

The orchestrator SHALL pass the per-requirement failure history entry when constructing a Microcycle, enabling the microcycle to inject cross-session context into the first implementation attempt.

#### Scenario: Microcycle receives failure history
- **WHEN** a Microcycle is constructed for a requirement that has failure history
- **THEN** the `failureHistory` parameter SHALL contain `{ reason, attempts, costUsd }` from the previous session

#### Scenario: Microcycle without failure history
- **WHEN** a Microcycle is constructed for a requirement with no failure history (new requirement or no previous session)
- **THEN** the `failureHistory` parameter SHALL be null

### Microcycle Cross-Session Retry Prompt

When a microcycle has `failureHistory` and is on its first attempt (`attempt === 1`), it SHALL use `buildRetryPrompt()` with context about the previous session's failure instead of the standard implementation prompt.

#### Scenario: First attempt with failure history
- **WHEN** `attempt === 1` and `failureHistory` is not null
- **THEN** the microcycle SHALL call `buildRetryPrompt()` with a context string describing the previous session's failure reason, attempt count, and cost

#### Scenario: First attempt without failure history
- **WHEN** `attempt === 1` and `failureHistory` is null
- **THEN** the microcycle SHALL use `buildImplementationPrompt()` as normal

#### Scenario: Subsequent attempts with failure history
- **WHEN** `attempt > 1` regardless of whether `failureHistory` exists
- **THEN** the in-session `lastError` or `reviewFeedback` SHALL take precedence — `failureHistory` is only used on the first attempt

### Prior Work Diff Salvaging

When a `--fresh` session starts and previous parked items exist with stale `devshop/work-*` branches, the orchestrator SHALL extract diffs from those branches BEFORE recovery deletes them — but only for infrastructure failures (not code failures).

Infrastructure failures are identified by matching the parked item's `reason` against patterns such as: timeout, null bytes, maxBuffer, SIGTERM, SIGKILL, process error/exited, phase stuck, consecutive failures.

The extracted diffs are stored in `_priorWorkDiffs` (Map keyed by requirement ID) and passed to the Microcycle as `priorWorkDiff`.

#### Scenario: Fresh session with infra-failure parked items and stale branches
- **WHEN** `--fresh` is set, a parked item's reason matches an infrastructure failure pattern, and a `devshop/work-*/<reqId>` branch exists
- **THEN** the orchestrator SHALL extract the diff (truncated to 8KB) and pass it to the Microcycle as `priorWorkDiff`

#### Scenario: Fresh session with code-failure parked items
- **WHEN** `--fresh` is set but the parked item's reason does NOT match an infrastructure failure pattern (e.g. "Tests failed", "Review rejected")
- **THEN** the orchestrator SHALL NOT extract a diff for that item (to avoid anchoring agents on bad code)

#### Scenario: Microcycle includes prior work diff in cross-session retry
- **WHEN** a Microcycle has both `failureHistory` and `priorWorkDiff` on its first attempt
- **THEN** the retry prompt SHALL include the prior diff with framing that indicates it was an infrastructure failure, not a code problem, and the agent should use it as a starting point

#### Scenario: No stale branches exist
- **WHEN** `--fresh` is set but no `devshop/work-*` branches exist
- **THEN** `_priorWorkDiffs` SHALL remain null

### Project Conventions Loading

The orchestrator SHALL load project conventions from `<projectDir>/openspec/conventions.md` once at session start using `OpenSpecReader.parseConventions()`.

The `parseConventions()` method SHALL return the file contents as a string when the file exists, or `null` when it does not.

The loaded conventions SHALL be stored in `this._conventions` and passed to every Microcycle instance as the `conventions` parameter.

#### Scenario: Conventions file exists
- **WHEN** a session starts and `openspec/conventions.md` exists in the project directory
- **THEN** the orchestrator SHALL read its contents and pass them to all Microcycles as the `conventions` parameter

#### Scenario: Conventions file does not exist
- **WHEN** a session starts and `openspec/conventions.md` does not exist
- **THEN** `parseConventions()` SHALL return `null` and Microcycles SHALL receive `null` for conventions

### Project Conventions Injection

The Microcycle SHALL inject the conventions content (or a fallback message) into agent system prompts via the `PROJECT_CONVENTIONS` template variable.

When `conventions` is not null, the `PROJECT_CONVENTIONS` variable SHALL contain the conventions file content.

When `conventions` is null, the `PROJECT_CONVENTIONS` variable SHALL contain the fallback text: "No project conventions file found. Follow patterns in existing code."

The `PROJECT_CONVENTIONS` variable SHALL be passed to both the implementation agent prompt and the principal-engineer review prompt.

#### Scenario: Implementation agent receives conventions
- **WHEN** a Microcycle renders the implementation agent prompt and conventions are available
- **THEN** the `PROJECT_CONVENTIONS` variable SHALL be set to the conventions file content

#### Scenario: Review agent receives conventions
- **WHEN** a Microcycle renders the principal-engineer review prompt and conventions are available
- **THEN** the `PROJECT_CONVENTIONS` variable SHALL be set to the conventions file content

#### Scenario: Fallback when no conventions
- **WHEN** conventions are null
- **THEN** the `PROJECT_CONVENTIONS` variable SHALL contain the fallback text

### Blocking Park Detection
When an item is parked and inline triage classifies it as `blocking`, the orchestrator SHALL immediately initiate the blocking-park response flow instead of continuing to the next pending item.

The orchestrator SHALL log a `blocking_park_detected` event with the blocking item's ID and error before entering the fix flow.

#### Scenario: Blocking park triggers fix flow
- **WHEN** `_parkItem()` parks a requirement and inline triage classifies it as `blocking`
- **THEN** the orchestrator SHALL NOT proceed to the next pending item
- **AND** the orchestrator SHALL initiate the blocking-park response flow (graceful stop, consolidate, Morgan fix)

#### Scenario: Non-blocking park continues normally
- **WHEN** `_parkItem()` parks a requirement and inline triage classifies it as `non_blocking`
- **THEN** the orchestrator SHALL continue to the next pending item as before

### Blocking Park Graceful Stop All Groups
When a blocking park is detected, the orchestrator SHALL signal all groups to graceful-stop by calling `monitor.requestPause()` with reason `blocking_park`.

The blocked group SHALL return immediately. Other groups SHALL finish their current in-progress item and then stop at the next `shouldStop()` check.

#### Scenario: All groups stop after blocking park
- **WHEN** a blocking park is detected in group A while group B is mid-item
- **THEN** group A SHALL return immediately with the blocking park result
- **AND** group B SHALL finish its current item and stop before picking up the next one
- **AND** the `Promise.allSettled` for all groups SHALL resolve

#### Scenario: Single-group session
- **WHEN** a blocking park is detected and only one group is running
- **THEN** `requestPause()` SHALL still be called for consistency
- **AND** the orchestrator SHALL proceed directly to consolidation

### Work Consolidation to Main
After all groups stop, the orchestrator SHALL consolidate all completed work from the session branch to main by pushing the session branch, creating a PR, and merging it.

The consolidation SHALL include all microcycle merges that completed before the stop, plus all roadmap `[x]` marks.

#### Scenario: Successful consolidation
- **WHEN** all groups have stopped and the session branch has commits ahead of main
- **THEN** the orchestrator SHALL push the session branch, create a PR with a summary of completed items, and merge it to main

#### Scenario: No new work to consolidate
- **WHEN** all groups stopped but no items were completed in the current session
- **THEN** the consolidation step SHALL be skipped (no PR created)

#### Scenario: Consolidation PR merge fails
- **WHEN** the PR merge fails (e.g., due to conflicts with manual changes on main)
- **THEN** the orchestrator SHALL log the error and skip to pair-mode fallback instead of Morgan auto-fix

### Morgan Auto-Fix Attempt
After consolidation, the orchestrator SHALL spawn Morgan (principal engineer) via `AgentSession.chat()` with the `blocking-fix-prompt.md` template to attempt an automated fix of the blocking issue on the session branch.

Morgan SHALL receive the blocking item's error/review feedback, the requirement spec, and the project context. The fix attempt SHALL be capped at the configured pair agent budget.

#### Scenario: Morgan fixes the issue
- **WHEN** Morgan's fix attempt completes and the project's test suite passes
- **THEN** the orchestrator SHALL commit Morgan's changes to the session branch and proceed to auto-restart

#### Scenario: Morgan cannot fix the issue
- **WHEN** Morgan's fix attempt completes but the test suite fails
- **THEN** the orchestrator SHALL discard Morgan's changes and proceed to pair-mode fallback

#### Scenario: Morgan's session errors out
- **WHEN** the AgentSession returns `success: false`
- **THEN** the orchestrator SHALL log the error and proceed to pair-mode fallback

### Auto-Restart After Successful Fix
When Morgan successfully fixes the blocking issue, the orchestrator's `run()` method SHALL return a restart signal (`{ restart: true }`) instead of a plain exit code.

The CLI entry point SHALL detect the restart signal and re-invoke the orchestrator with `--fresh`. The `--fresh` restart reads the roadmap, skips `[x]` items, and continues from where the session left off.

#### Scenario: Auto-restart after Morgan fix
- **WHEN** `run()` returns `{ restart: true }`
- **THEN** the CLI SHALL re-invoke `run()` with the `--fresh` flag
- **AND** the new session SHALL skip all previously completed (`[x]`) roadmap items

#### Scenario: Normal session end (no restart)
- **WHEN** `run()` returns a plain exit code (0 or 1)
- **THEN** the CLI SHALL exit normally without restarting

### Pair-Mode Fallback
When Morgan cannot fix the blocking issue, the orchestrator SHALL drop into interactive pair mode using the existing `pairCommand()` infrastructure.

After the pair session ends, the system SHALL prompt the user whether to restart the orchestrator in agent mode.

#### Scenario: Pair mode after Morgan failure
- **WHEN** Morgan's fix fails and pair mode begins
- **THEN** the user SHALL see Morgan's pair REPL with the blocking item's context pre-loaded

#### Scenario: User chooses restart after pair fix
- **WHEN** the pair session ends and the user responds "y" to the restart prompt
- **THEN** the orchestrator SHALL restart with `--fresh`

#### Scenario: User declines restart after pair fix
- **WHEN** the pair session ends and the user responds "n" to the restart prompt
- **THEN** the orchestrator SHALL exit normally

### Shared JSON Extraction Utility

The system SHALL provide a shared `extractJson()` function in `json-extractor.js` that extracts and parses a JSON object from text using three strategies in order: markdown code fence extraction, last-valid-JSON backward search for JSON embedded in text, and whole-text JSON parsing.

#### Scenario: Markdown code fence
- **WHEN** the input text contains JSON within ``` or ```json fences
- **THEN** `extractJson()` SHALL return the parsed JSON object

#### Scenario: JSON embedded in prose (last-valid-JSON strategy)
- **WHEN** the input text contains a JSON object surrounded by non-JSON text
- **THEN** `extractJson()` SHALL search backward from the last `}` to find a matching `{` that produces valid JSON, and return the parsed object

#### Scenario: Multiple JSON objects in output
- **GIVEN** text containing explanation with braces followed by the actual JSON result
- **WHEN** `extractJson()` is called
- **THEN** the last valid JSON object in the text SHALL be returned

#### Scenario: Braces inside JSON strings
- **GIVEN** a JSON object with string values containing `{` and `}`
- **WHEN** `extractJson()` is called
- **THEN** the complete valid JSON object SHALL be correctly extracted

#### Scenario: Clean JSON
- **WHEN** the entire input text (after trimming) is a valid JSON object
- **THEN** `extractJson()` SHALL return the parsed JSON object

#### Scenario: No valid JSON
- **WHEN** the input text contains no parseable JSON
- **THEN** `extractJson()` SHALL return null

### Template Engine — Variable Value Escaping

The `renderString()` and `renderAgentPrompt()` methods SHALL escape template syntax (`{{` and `}}`) in variable values before substitution to prevent variable values from being interpreted as template directives.

#### Scenario: Variable value containing template syntax
- **GIVEN** a template `Hello {{NAME}}`
- **WHEN** rendered with `{ NAME: 'test {{INJECTED}}' }`
- **THEN** the output SHALL be `Hello test \{\{INJECTED\}\}` (literal, not expanded)

### Agent Runner — SDK Invocation

The `AgentRunner` SHALL invoke agents via the Claude Agent SDK's `query()` function with `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true`. Environment variable management is handled by the SDK internally.

#### Scenario: Agent invocation via SDK
- **GIVEN** a runAgent call with model, prompt, and workingDir
- **WHEN** the agent is invoked
- **THEN** the SDK `query()` function SHALL be called with the prompt, model, cwd, and permission options

### Health Checker — Command Validation

The `runHealthCheck()` function SHALL validate commands before execution and log a warning for commands containing shell metacharacters (`;`, `&&`, `||`, `|`, `$()`, backticks). This is advisory only — commands are still executed.

#### Scenario: Command with shell metacharacters
- **GIVEN** a health check command `npm test; rm -rf /`
- **WHEN** the command is validated
- **THEN** a warning SHALL be logged but the command SHALL still execute

### Triage Response — Schema Validation

After extracting JSON from the triage agent's response, the orchestrator SHALL validate that `classifications` is an array and each entry has a string `id` and a `classification` value of `BLOCKING` or `NON_BLOCKING` before applying the classifications to state.

#### Scenario: Invalid triage response structure
- **GIVEN** the triage agent returns JSON without a `classifications` array
- **WHEN** the orchestrator processes the response
- **THEN** the response SHALL be rejected and all items SHALL be treated as blocking (fail-safe)

### Implementation Salvage Check
When an implementation agent fails (`success: false`), the microcycle SHALL attempt a salvage check before incrementing the retry counter. The salvage check SHALL run tests and check for commits on the work branch. If tests pass AND commits exist on the work branch (relative to the session branch), the microcycle SHALL treat the implementation as successful and proceed to the commit phase, skipping the retry.

The salvage check SHALL log an `implementation_salvaged` event at level `info` with the requirement ID and the original agent error message, so operators can observe when salvage occurs.

If the salvage check fails (tests do not pass OR no commits exist), the microcycle SHALL proceed with the existing retry logic unchanged.

#### Scenario: Agent fails but work is complete (salvage succeeds)
- **WHEN** the implementation agent returns `success: false` and tests pass in the working directory and git log shows commits on the work branch relative to the session branch
- **THEN** the microcycle SHALL log an `implementation_salvaged` event, skip the retry counter increment, and proceed to the commit phase

#### Scenario: Agent fails and work is incomplete (salvage fails — no commits)
- **WHEN** the implementation agent returns `success: false` and git log shows no commits on the work branch relative to the session branch
- **THEN** the microcycle SHALL proceed with the existing retry logic (increment counter, set lastError, loop)

#### Scenario: Agent fails and tests do not pass (salvage fails — tests fail)
- **WHEN** the implementation agent returns `success: false` and tests fail in the working directory (even if commits exist)
- **THEN** the microcycle SHALL proceed with the existing retry logic

#### Scenario: Salvage check error is non-fatal
- **WHEN** the salvage check itself throws an error (e.g., test runner crash, git error)
- **THEN** the microcycle SHALL catch the error, log a warning, and proceed with the existing retry logic as if salvage failed

### Post-Session Auto-Consolidation
The `run` command SHALL attempt to consolidate the session branch to main after the session completes, the summary is written, and the post-run digest is sent.

The consolidation step SHALL be performed in `run.js` (the command handler), not in the orchestrator state machine.

The consolidation SHALL pass the session's completed requirement IDs, session branch name, session ID, project ID, parked items, and total cost to `consolidateToMain()`.

The CLI SHALL accept a `--no-consolidate` boolean flag (default: false) that disables auto-consolidation when set.

The `--no-consolidate` flag SHALL be passed through the config object to `runCommand()`.

#### Scenario: Auto-consolidation after successful session
- **WHEN** a session completes via `runCommand()` with completed requirements and `--no-consolidate` is not set
- **THEN** `run.js` SHALL call `gitOps.consolidateToMain()` with the session data after `postRunDigest` completes

#### Scenario: Auto-consolidation disabled
- **WHEN** a session completes and `config.noConsolidate` is true
- **THEN** `run.js` SHALL skip the consolidation step

#### Scenario: Auto-consolidation after session with no completed work
- **WHEN** a session completes with 0 completed requirements
- **THEN** `run.js` SHALL skip consolidation (no branch to consolidate)

#### Scenario: Session exit code unaffected by consolidation
- **WHEN** consolidation succeeds or fails
- **THEN** the exit code from `runCommand()` SHALL remain based on parked items (1 if parked, 0 otherwise), not on consolidation status

