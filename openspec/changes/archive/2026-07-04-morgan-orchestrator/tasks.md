## 1. Morgan Orchestration Prompt

- [x] 1.1 Create `templates/agents/principal-engineer/run-prompt.md` — Morgan's orchestration prompt with: role description, roadmap execution rules (phase deps, group structure), commit/test conventions, roadmap marking instructions (`[ ]` → `[x]`), sub-agent delegation guidelines (when to delegate vs. do directly, how to write scoped briefs, use Agent tool with `isolation: "worktree"`), and budget/time awareness
- [x] 1.2 Add template variables: `{{PROJECT_ID}}`, `{{PROJECT_DIR}}`, `{{GITHUB_REPO}}`, `{{TECH_STACK}}`, `{{ROADMAP_CONTENT}}`, `{{CONVENTIONS}}`, `{{BUDGET_USD}}`, `{{TIME_LIMIT_HOURS}}`, `{{AUTONOMOUS_MODE}}`
- [x] 1.3 Add autonomous mode section — when `{{AUTONOMOUS_MODE}}` is set, instruct Morgan to work without waiting for user input

## 2. Rewrite Run Command

- [x] 2.1 Rewrite `platform/orchestrator/src/commands/run.js` — replace `ParallelOrchestrator` invocation with Morgan CLI spawn. Keep existing lifecycle: lock acquisition, session branch creation, window/schedule config, cost estimation header
- [x] 2.2 Render orchestration prompt — load `run-prompt.md` template, read `roadmap.md` and `conventions.md` from project dir, render with template variables including budget/time from CLI config
- [x] 2.3 Spawn Morgan via `spawnClaudeTerminal()` from `cli-spawn.js` with rendered prompt, initial prompt ("Read the roadmap and start working through the pending items"), and session ID
- [x] 2.4 Add autonomous mode detection — when `--window` flag is present, set `AUTONOMOUS_MODE` template variable and add autonomous instructions to the initial prompt
- [x] 2.5 Add time limit enforcement — set a `setTimeout` that kills the `claude` process after `timeLimitMs`, with a warning message printed before termination
- [x] 2.6 Add session persistence — save Morgan's session ID to `run-session.json` after CLI exit using `saveCliSession()`, support `--resume` flag to restore previous session via `loadCliSession()`

## 3. Post-Session Lifecycle

- [x] 3.1 Detect completed work — after Morgan exits, compare roadmap state (count `[x]` items) before and after the session to determine if any items were completed
- [x] 3.2 Consolidate to main — if items were completed, push session branch and consolidate to main via PR (reuse existing `gitOps.consolidateToMain()`)
- [x] 3.3 Post-consolidation roadmap audit — run existing audit to catch any items merged but not marked `[x]` in roadmap
- [x] 3.4 Release run lock and update registry — release lock in finally block, update `project.lastSessionId` in registry

## 4. Prompt Partials and Context

- [x] 4.1 Create roadmap-execution partial `{{>roadmap-execution-rules}}` — phase dependency rules, group concurrency guidance, item lifecycle (implement → test → commit → mark complete)
- [x] 4.2 Create sub-agent delegation partial `{{>sub-agent-delegation}}` — when to delegate (multiple independent groups), how to write briefs (specific files, patterns, boundaries), Agent tool usage with `isolation: "worktree"`, reviewing sub-agent output before accepting

## 5. Testing

- [x] 5.1 Add tests for run command rewrite — verify prompt rendering with all template variables, verify spawn args include correct flags, verify autonomous mode detection from `--window`, verify time limit timeout setup
- [x] 5.2 Add tests for session persistence — verify save/load of run session ID, verify `--resume` passes correct flag to CLI
- [x] 5.3 Add tests for post-session lifecycle — verify roadmap diff detection (items completed vs. not), verify consolidation called only when items completed, verify lock release on error

## 6. Update Roadmap and Specs

- [x] 6.1 Add `morgan-orchestrator` to the d3vsh0p roadmap under a new phase with appropriate dependencies
- [x] 6.2 Create main spec at `openspec/specs/morgan-orchestrator/spec.md` from the change delta spec
