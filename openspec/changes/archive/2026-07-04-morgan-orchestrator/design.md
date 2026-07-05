## Context

The current `run` command launches `ParallelOrchestrator`, a Node.js state machine that spawns isolated SDK agents per roadmap item. Each agent gets a generic system prompt, works in a worktree, and has no visibility into the broader project or what other agents are building. The orchestrator handles all coordination: phase sequencing, group concurrency, merge locking, health checks, and state persistence.

The `pair` command takes a different approach: it spawns Morgan (Principal Engineer) as a persistent Claude Code CLI session with full project context. The user interacts directly. This consistently produces better code because Morgan has continuity and can make architectural decisions informed by the full codebase.

This design replaces the state-machine orchestrator with Morgan as a persistent CLI session that drives the `run` command, while preserving the existing git infrastructure (worktrees, session branches, merge flow, health checks).

## Goals / Non-Goals

**Goals:**
- Morgan runs as a persistent CLI session during `run`, reading the roadmap and working through items with full project context
- Morgan implements items directly (sequential) and can delegate to sub-agents for parallel group work
- The user can interact with Morgan during a run or let it work autonomously
- Existing scheduler (`launchd`/`cron`) works without changes — it invokes `./devshop run` which spawns Morgan
- Roadmap items are marked complete as Morgan finishes them, providing resumability
- Budget and time limits are enforced on the Morgan session

**Non-Goals:**
- Rewriting git-ops, worktree management, or merge infrastructure
- Changing the roadmap format or phase/group structure
- Building a new scheduler — the existing one already invokes `run`
- Real-time broadcast/watch integration (Morgan's CLI handles its own output)
- Changing how kickoff, plan, talk, or pair commands work

## Decisions

### 1. Morgan spawned via CLI, not SDK

**Decision:** Spawn Morgan using `spawnClaudeTerminal()` (like pair/talk/kickoff) rather than the Agent SDK.

**Why:** CLI spawn gives Morgan native tool use (Bash, Edit, Read, Write), streaming output, slash commands, and the ability for the user to interact. The SDK provides none of these — it's a message-in/message-out interface designed for non-interactive agents. Morgan needs to be interactive for the user to steer during runs.

**Alternative considered:** SDK with tool passthrough. Rejected because it would require reimplementing what Claude Code CLI already provides.

### 2. Orchestration logic moves into Morgan's system prompt

**Decision:** The phase sequencing, group selection, and work-item lifecycle logic moves from Node.js code (`parallel-orchestrator.js`) into Morgan's system prompt. Morgan reads the roadmap directly and decides what to work on next.

**Why:** The core insight is that Morgan can read a roadmap and make the same sequencing decisions the state machine makes — which phase is next, which groups are independent, what's already done. Moving this into the prompt eliminates the state machine as a middleman and gives Morgan the context to make better decisions (e.g., "this group is simple enough to do myself" vs. "this group is independent, I'll delegate it").

**Alternative considered:** Keep the state machine and have Morgan work within it (Option A from earlier discussion). Rejected because it doesn't solve the fundamental context problem — agents would still be isolated.

### 3. Sub-agent delegation via Claude Code Agent tool

**Decision:** When Morgan encounters a phase with multiple independent groups, it can use Claude Code's built-in Agent tool to spawn sub-agents. Morgan writes the brief for each sub-agent based on its knowledge of the codebase and specs.

**Why:** The Agent tool provides process isolation and can run agents in worktrees (`isolation: "worktree"`). Morgan writes targeted briefs ("create this file, follow this pattern from src/routes/auth.js") rather than the current generic system prompts. This addresses the over-engineering problem directly.

**Trade-off:** Sub-agents spawned via the Agent tool don't have the same merge-lock infrastructure the current orchestrator uses. Morgan will need to handle merging sub-agent work back. However, worktree isolation prevents conflicts at the filesystem level, and Morgan can review and merge sequentially.

### 4. Roadmap checkmarks as source of truth for progress

**Decision:** Morgan marks roadmap items complete (`[x]`) directly by editing `roadmap.md` after finishing each item and committing. On resume, Morgan reads the roadmap to see what's done and what's pending. No separate state machine file.

**Why:** The roadmap is already the canonical list of work. Adding a separate `state.json` creates a sync problem. If the roadmap says `[x]` and state says pending, which is right? Using one source of truth eliminates this. Morgan can also read `[!]` (parked) items and decide whether to retry them.

**How resume works:** The `run` command saves Morgan's Claude session ID. On `--resume`, it passes `--resume <id>` to the CLI, and Morgan picks up where it left off with its full conversation history. The roadmap shows what's already been completed.

### 5. `run.js` becomes a thin launcher

**Decision:** `run.js` handles pre-session setup (lock acquisition, session branch creation, schedule/window config) and post-session cleanup (consolidation to main, lock release). Between those, it spawns Morgan and waits.

**Why:** The existing pre/post lifecycle in `run.js` (locking, branching, consolidation, cost estimation) is valuable and doesn't need to change. Morgan just replaces the `orchestrator.run()` call in the middle.

**What `run.js` still does:**
- Acquire run lock (prevent concurrent runs)
- Create session branch from main
- Apply window/schedule config (budget, time limits)
- Spawn Morgan CLI with orchestration prompt + project context
- After Morgan exits: consolidate session branch to main via PR
- Release run lock
- Post-consolidation roadmap audit

### 6. Budget enforcement via session-level controls

**Decision:** Pass `--max-turns` or time-based limits to the Morgan CLI session. The `run.js` wrapper also enforces a hard timeout by killing the process after `timeLimitMs`.

**Why:** The CLI's `--max-budget-usd` flag only works in `--print` (non-interactive) mode. For interactive/autonomous sessions, we rely on external enforcement: `run.js` sets a process timeout, and the system prompt tells Morgan its budget/time constraints so it can self-regulate.

**Alternative considered:** Using SDK for budget tracking. Rejected because Morgan runs as CLI, not SDK.

### 7. Health checks invoked by Morgan via Bash

**Decision:** Morgan runs health checks (tests, build) directly via its Bash tool rather than through the orchestrator's health-checker module.

**Why:** Health checks are simple CLI commands (`npm test`, `npm run build`). Morgan can run them naturally as part of its workflow — test after implementing, build-check before marking complete. No special integration needed. The orchestration prompt tells Morgan what commands to run based on the project's conventions.

### 8. Autonomous mode for scheduler

**Decision:** When the scheduler invokes `run`, Morgan works autonomously — no human interaction expected. The system prompt includes a flag or context indicating autonomous mode, telling Morgan to make decisions independently rather than asking the user.

**Why:** The scheduler already invokes `./devshop run <project> --window <name>`. Morgan's prompt can detect the window context and behave accordingly. No code changes to the scheduler needed.

## Risks / Trade-offs

**Context window limits** — Morgan working through a large roadmap (20+ items) may hit context limits. Mitigation: Morgan commits frequently, and Claude Code handles context compression automatically. If needed, the prompt can instruct Morgan to be concise.

**Sub-agent merge conflicts** — When Morgan delegates to sub-agents in parallel, their worktree branches need merging back. Without the merge lock, conflicts could arise. Mitigation: Agent tool's `isolation: "worktree"` gives each sub-agent a clean copy. Morgan merges them sequentially after they complete and resolves any conflicts.

**Cost unpredictability** — Morgan as a persistent session may use more tokens than isolated agents for simple tasks. Mitigation: the `run.js` wrapper enforces a hard timeout, and the prompt tells Morgan its budget. Monitor actual costs vs. the old model and adjust.

**Scheduler reliability** — If Morgan hits an error mid-run, the scheduler can't retry individual items like the state machine could. Mitigation: roadmap checkmarks provide resumability. The next scheduled run picks up where Morgan left off.

**No streaming cost tracking** — With SDK agents, the orchestrator tracked per-agent costs. With CLI spawn, we lose granular cost reporting. Mitigation: Claude Code tracks session cost internally; post-session we can log the total.

## Open Questions

1. **Sub-agent worktree cleanup** — Does Claude Code's Agent tool with `isolation: "worktree"` automatically clean up worktrees, or does Morgan need to handle that?
2. **Session resume across scheduler runs** — Should each scheduled run resume the previous Morgan session (continuing the conversation), or start fresh with roadmap state as context? Fresh starts are simpler but lose conversation history.
3. **Parallel group limit** — Should Morgan be told to limit how many sub-agents it spawns at once, or let it decide based on the phase structure?
