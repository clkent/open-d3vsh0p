## Why

The current `run` command spawns isolated agents per roadmap item via the SDK. Each agent lacks big-picture context — they don't see the full codebase architecture, what other agents built, or how their piece fits. This leads to over-engineered implementations, inconsistent patterns across items, and quality low enough that the scheduler has never been viable for unattended runs.

Meanwhile, `pair` mode (Morgan as a persistent CLI session) consistently produces better code because Morgan has full project context, continuity across tasks, and a human can steer. The gap between pair quality and run quality is the core problem.

## What Changes

- **New `run` flow**: Instead of the orchestrator spawning isolated SDK agents per item, `run` spawns Morgan as a persistent Claude Code CLI session. Morgan reads the full roadmap and specs, works through items sequentially, and can delegate parallel group work to sub-agents when appropriate.
- **Morgan as orchestrator**: Morgan replaces the state machine as the decision-maker. Morgan reads the roadmap, picks the next phase/group, implements items directly, and decides when to spin up sub-agents for parallelism vs. doing the work itself.
- **Sub-agent delegation**: When Morgan encounters a phase with multiple independent groups, it can spawn sub-agents (via Claude Code's Agent tool) with specific, scoped briefs — not generic system prompts, but "here's exactly what to build, here's the pattern to follow from what I've already built."
- **Interactive during run**: The user can interact with Morgan during the run — ask questions, course-correct, or let it work autonomously.
- **Scheduler compatibility**: For unattended scheduled runs, Morgan runs autonomously (no human input) with the same flow. The scheduler invokes the same `run` command; Morgan just doesn't wait for human input.
- **Preserve infrastructure**: Worktree isolation, merge flow, git ops, session branches, health checks, and the existing post-merge validation all remain. Morgan uses these as tools rather than being orchestrated by them.

## Capabilities

### New Capabilities
- `morgan-orchestrator`: Morgan as the persistent CLI-based orchestrator for the `run` command — roadmap-driven sequential execution with sub-agent delegation for parallel groups, replacing the SDK-based isolated agent spawning model

### Modified Capabilities
- `parallel-execution`: Parallel group execution shifts from orchestrator-spawned SDK agents to Morgan-delegated sub-agents with richer context and scoped briefs
- `cli-interface`: The `run` command changes from launching ParallelOrchestrator to spawning Morgan CLI with orchestration context

## Impact

- **`platform/orchestrator/src/commands/run.js`**: Rewritten to spawn Morgan CLI instead of ParallelOrchestrator
- **`platform/orchestrator/src/parallel-orchestrator.js`**: Largely replaced — phase/group logic moves into Morgan's prompt and behavior. Some utilities (worktree management, merge lock, health checks) may be extracted for Morgan to invoke via Bash
- **`templates/agents/principal-engineer/`**: New orchestration prompt template for Morgan's run-mode role
- **`platform/orchestrator/src/microcycle.js`**: Simplified or removed — Morgan handles the implement/test/review cycle directly
- **Agent pool / persona system**: Simplified — Morgan is the primary agent, sub-agents are ad-hoc
- **Scheduler**: No changes needed — it already invokes `./devshop run`, which will now spawn Morgan
- **State persistence**: Needs rethinking — currently a state machine file; may shift to Morgan's session state + roadmap checkmarks as source of truth
- **Consumption monitoring**: Must still enforce budget/time limits on the Morgan CLI session
- **Existing infra preserved**: git-ops (worktrees, merges, session branches), health checks, broadcast server, roadmap reader/writer, review scoring
