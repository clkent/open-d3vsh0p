# Morgan Orchestrator — Delta

## MODIFIED Requirements

### Requirement: Autonomous Mode for Scheduler
Morgan SHALL operate autonomously when invoked by the scheduler, making decisions independently without waiting for user input.

The system SHALL include a flag or context in Morgan's prompt indicating autonomous mode when a `--window` flag is present, instructing Morgan to proceed without asking questions and to work through roadmap items until everything is complete or blocked.

#### Scenario: Scheduled run is autonomous
- **WHEN** `./devshop run my-project --window morning` is executed by the scheduler
- **THEN** Morgan's system prompt SHALL include instructions to work autonomously without waiting for user input

#### Scenario: Autonomous Morgan commits and marks progress
- **WHEN** Morgan completes an item in autonomous mode
- **THEN** Morgan SHALL commit, mark the item complete in roadmap.md, and proceed to the next item without pausing

#### Scenario: Autonomous Morgan works until done or blocked
- **WHEN** Morgan works in autonomous mode
- **THEN** Morgan SHALL continue through pending items until everything is complete or blocked, parking blockers and moving on, without budget- or time-based stopping guidance

### Requirement: Run Lifecycle Wrapper
The `run.js` command handler SHALL manage the session lifecycle around Morgan's CLI session: lock acquisition, session branch creation, Morgan spawn wrapped in the limit-aware resume loop, and post-session consolidation. Morgan's exit is not unconditionally terminal: when auto-resume is enabled and a usage-limit condition is detected (per the `limit-aware-resume` capability), the wrapper SHALL wait for the limit window to reset and respawn Morgan with `--resume`, within the bounds defined by that capability. The session ID SHALL be saved after every Morgan exit; the post-session health gate and consolidation SHALL run exactly once, after the final Morgan exit of the run.

The wrapper SHALL NOT enforce a session time limit. For windowed runs only, the wrapper SHALL terminate the `claude` CLI process when the window end time (`windowEndTimeMs`) is reached.

#### Scenario: Pre-session setup
- **WHEN** the `run` command starts
- **THEN** the system SHALL acquire a run lock, create a session branch from main, and apply any window/schedule configuration before spawning Morgan

#### Scenario: Post-session consolidation
- **WHEN** the final Morgan CLI session of the run exits and completed items exist
- **THEN** the system SHALL consolidate the session branch to main via a PR (push, create PR, wait for CI, merge)

#### Scenario: Lock released on exit
- **WHEN** the run concludes (normally, via error, or after auto-resume cycles)
- **THEN** the system SHALL release the run lock in a finally block, held continuously across any limit waits and resumes

#### Scenario: No time limit on plain runs
- **WHEN** a run without `--window` is in progress
- **THEN** the system SHALL NOT terminate the `claude` CLI process based on elapsed time

#### Scenario: Window end terminates a windowed run
- **WHEN** a run with `--window` reaches `windowEndTimeMs` while Morgan's session is active
- **THEN** the system SHALL terminate the `claude` CLI process

#### Scenario: Limit-interrupted session resumes within one run
- **WHEN** auto-resume is enabled and a usage-limit condition interrupts Morgan
- **THEN** the wrapper SHALL keep the run open (lock held, session branch unchanged), wait per the limit wait loop, respawn Morgan with `--resume`, and defer the health gate and consolidation until the final exit

### Requirement: Morgan Orchestration Prompt Template
The system SHALL provide a prompt template at `templates/agents/principal-engineer/run-prompt.md` that instructs Morgan on the orchestration workflow.

The template SHALL include: role description (Morgan as orchestrator), roadmap content, conventions, phase/group execution rules, sub-agent delegation guidelines, commit and test conventions, and roadmap marking instructions. The template SHALL NOT include budget or time-limit constraints or guidance to stop early because of them.

#### Scenario: Template rendered with project context
- **WHEN** the run command prepares Morgan's prompt
- **THEN** it SHALL render the template with variables for PROJECT_ID, PROJECT_DIR, GITHUB_REPO, TECH_STACK, ROADMAP_CONTENT, CONVENTIONS, and AUTONOMOUS_MODE, with no BUDGET_USD or TIME_LIMIT_HOURS variables

#### Scenario: Template includes delegation instructions
- **WHEN** Morgan reads its system prompt
- **THEN** it SHALL find instructions on when to delegate to sub-agents (multiple independent groups) vs. when to implement directly (single group or simple items)
