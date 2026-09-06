# Roadmap: d3vsh0p Agent Platform

## Phase I: Core Platform

### Group A: Orchestration Engine
- [x] `orchestrator-core` — State machine, microcycle loop, retry logic, crash recovery *(removed: remove-sdk-orchestrator)*
- [x] `consumption-monitoring` — Budget, time, invocation tracking with graceful shutdown *(removed: remove-sdk-orchestrator)*
- [x] `early-exit-no-work` — Skip session/branch/log creation when roadmap is fully complete

### Group B: Agent System
- [x] `agent-management` — Claude Agent SDK invocation, template engine, prompt building
- [x] `agent-pool` — Persona registry, round-robin assignment *(removed: remove-sdk-orchestrator)*

### Group C: Infrastructure
- [x] `git-workflow` — Session branches, work branches, merge flow, diff retrieval
- [x] `logging-observability` — JSONL run logs, session summaries, console output
- [x] `configuration-system` — Layered defaults, project overrides, CLI options

## Phase II: Project & Templates
<!-- depends: Phase I -->

### Group A: Project Infrastructure
- [x] `project-management` — Project registry, isolation, directory linking
- [x] `agent-templates` — System prompts, shared partials, variable substitution

## Phase III: Parallel & PM
<!-- depends: Phase II -->

### Group A: Parallel Execution
- [x] `parallel-execution` — Roadmap parsing, phase dependencies, group concurrency, merge lock *(partial removal: engine removed; roadmap parsing + Morgan delegation remain)*

### Group B: PM Workflow
- [x] `pm-workflow` — Brain dump with Riley, mid-project talk, session persistence

### Group C: CLI
- [x] `cli-interface` — Five commands, auto-detect parallel/sequential, option parsing

## Phase IV: Automation & Kickoff
<!-- depends: Phase III -->

### Group A: Project Kickoff
- [x] `project-kickoff` — Riley-guided project creation: Q&A, repo, scaffold, specs, roadmap, registry
- [x] `kickoff-bootstrap` — Post-spec bootstrap agent: install tech stack deps, create config files, verify build
- [x] `design-skills-kickoff` — Optional --design flag on kickoff to install Impeccable design skills for frontend projects
- [x] `design-aware-agents` — Conditional /polish + /audit in implementation agents, design_quality scoring in review, frontend tech stack detection

### Group B: Daily Scheduling
- [x] `schedule-config` — Per-project schedule schema in registry, window-config validation
- [x] `window-aware-run` — --window flag, budget/time overrides, window-end graceful shutdown
- [x] `tech-debt-runner` — Security scan + PE improvement pass for techdebt window *(removed: remove-sdk-orchestrator — use `devshop security --schedule weekly` instead)*
- [x] `launchd-integration` — Plist generation, install/remove via launchctl, cron fallback
- [x] `schedule-cli` — schedule install/remove/status/dry-run commands
- [x] `github-daily-digest` — Rolling daily Issue per project via gh CLI *(morning digest now posts a roadmap snapshot)*

### Group C: Cadence Automation
- [x] `weekly-cleanup` — Stale branch pruning, dead worktree removal
- [x] `monthly-review` — Archive old parked items, cost aggregation report *(disabled: summary data source removed; returns with token-estimator)*
- [x] `cadence-cli` — cadence run/status commands

## Phase V: Platform Quality
<!-- depends: Phase IV -->

### Group A: Reliability
- [x] `worktree-crash-recovery` — Detect and recover orphaned worktrees, stale branches, interrupted state
- [x] `predictive-budget-modeling` — Cost estimation from session history, pre-phase budget checks *(removed: remove-sdk-orchestrator — to be replaced by token-estimator)*

### Group B: Observability
- [x] `structured-review-scoring` — Dimensional review scores, ReviewParser, metrics in status output *(removed: remove-sdk-orchestrator)*
- [x] `microcycle-progress-events` — Real-time progress thoughts from agents during microcycle phases *(removed: remove-sdk-orchestrator)*

### Group C: Quality Guardrails
- [x] `review-architecture-validation` — Tech stack compliance in reviews, post-merge architecture check *(removed: remove-sdk-orchestrator)*

## Phase VI: Resilience & Diagnostics
<!-- depends: Phase V -->

### Group A: Worktree Safety
- [x] `worktree-test-isolation` — Ensure worktrees are .gitignored to prevent test runner interference

### Group B: Agent Diagnostics
- [x] `morgan-project-diagnostic` — Morgan as project doctor for stuck phases: diagnose, fix, retry *(removed: remove-sdk-orchestrator)*

### Group C: Convention Enforcement
- [x] `project-conventions` — Per-project conventions file generated at kickoff, injected into all agent prompts, enforced by Morgan

### Group D: Baseline Verification
- [x] `project-health-check` — Pre-work health check gate with auto-detection, Morgan auto-repair, and pair-mode fallback *(partial removal: reworked as pre-run preflight in run command)*

### Group E: Security Hardening
- [x] `security-hardening` — Template injection prevention, env whitelist, JSON extraction robustness, command validation, triage schema validation

### Group F: Session Lifecycle
- [x] `session-auto-consolidation` — Auto-consolidate session branches to main via PR at session end

### Group G: Microcycle Resilience
- [x] `microcycle-salvage-check` — Salvage completed work when agent fails due to context overflow (tests pass + commits exist) *(removed: remove-sdk-orchestrator)*

## Phase VII: Platform Services
<!-- depends: Phase III -->

### Group A: API Layer
- [x] `rest-api` — REST API for programmatic access to DevShop

### Group B: Real-time
- [x] `live-broadcast` — WebSocket broadcast server, stream-json agent output, watch command *(removed: remove-sdk-orchestrator)*
- [x] `session-progress-visibility` — Milestone notifications, progress line, "go look" alerts in watch command *(removed: remove-sdk-orchestrator)*
- [x] `inline-watch-mode` — `--watch` flag showing live agent activity inline during run, shared event formatter extracted from watch command *(removed: remove-sdk-orchestrator)*

## Phase VIII: Roadmap Integrity
<!-- depends: Phase VI -->

### Group A: Salvage Marking
- [x] `salvage-roadmap-mark` — Mark roadmap items complete when salvaged work is successfully merged on park *(removed: remove-sdk-orchestrator)*

### Group B: Consolidation Audit
- [x] `consolidation-roadmap-audit` — Post-consolidation scan for merged items not marked complete in roadmap

### Group C: Session Reconciliation
- [x] `session-start-reconciliation` — Pre-session git log scan to detect and mark already-completed pending items *(removed: remove-sdk-orchestrator)*

### Group D: Integration Quality Gates
- [x] `integration-quality-gates` — Post-merge smoke test, end-of-phase health gate, and review context enrichment for catching integration bugs *(removed: remove-sdk-orchestrator)*

### Group E: Roadmap Format Validation
- [x] `roadmap-format-validation` — Detect and fix malformed roadmap items after generation, with retry loop in kickoff and pre-commit gate in plan

## Phase IX: Agent Intelligence
<!-- depends: Phase VI -->

### Group A: Codebase Context
- [x] `codebase-grounding` — Pre-read key project files and inject into implementation prompts so agents build on real code, not hallucinated patterns *(removed: remove-sdk-orchestrator)*
- [x] `codebase-gotchas` — Replace CodebaseScanner with lightweight human-curated gotchas system; agents explore codebases with their own tools

### Group B: Risk Preflight
- [x] `risk-preflight` — Lightweight read-only planning step before implementation: identify files, risks, and strategy before writing code *(removed: remove-sdk-orchestrator)*

### Group C: Adaptive Retry
- [x] `adaptive-retry` — Strategy-shift instructions on retry, attempt history tracking, and failure pattern detection when parking *(removed: remove-sdk-orchestrator)*
- [x] `adaptive-retry-stall-detection` — Stall vs progress detection via git snapshots, dual-counter parking (stall limit + max attempts), progress-aware retry prompts *(removed: remove-sdk-orchestrator)*

### Group D: PM Prompt Quality
- [x] `pm-roadmap-granularity` — Spec-roadmap alignment rules and self-audit checklist in PM prompts to prevent over-coarse roadmap items that block parallel execution
- [x] `pm-roadmap-template` — Complete roadmap template example in PM prompts replacing verbose scattered examples

### Group E: Spike Phases
- [x] `spike-phases` — Technical uncertainty investigation before implementation with auto-pause for human review *(partial removal: spike-agent removed; [SPIKE] notation remains)*

### Group F: Project Context Injection
- [x] `project-context-injection` — Auto-load user-provided context files from `context/` directory into Riley's first-turn prompt for kickoff and plan sessions

## Phase X: Agent Coordination & Compliance
<!-- depends: Phase IX -->

### Group A: Parallel Agent Coordination
- [x] `parallel-agent-coordination` — Peer context injection for parallel agents, shared file warnings, phase context for implementation agents *(removed: remove-sdk-orchestrator)*

### Group B: Automated Convention Check
- [x] `automated-convention-check` — Zero-cost grep-based framework/convention compliance check before review, catching wrong test runner, styling lib, or ORM *(removed: remove-sdk-orchestrator)*

### Group C: Import Verification
- [x] `import-verification` — Zero-cost file-system check that all imports resolve to real modules, catching hallucinated imports before tests run *(removed: remove-sdk-orchestrator)*

## Phase XI: Session Resilience
<!-- depends: Phase IX -->

### Group A: Context Refresh
- [x] `context-refresh` — Periodic re-injection of key context (persona, project, conventions) during long interactive sessions to prevent context rot

### Group B: Exit Safety
- [x] `session-exit-push` — Auto-detect and push uncommitted changes when exiting interactive sessions (talk, kickoff) to prevent data loss

## Phase XII: Platform Hygiene
<!-- depends: Phase VIII -->

### Group A: Conventions
- [x] `devshop-conventions` — DevShop's own conventions: test framework, zero deps, module organization, naming, git hooks

### Group B: Test Coverage
- [x] `test-coverage-integrity` — Comprehensive test coverage with test integrity guardrails, priority-ordered by module criticality

## Phase XIII: Build & Quality Validation
<!-- depends: Phase VI -->

### Group A: Native Build Detection
- [x] `native-build-validation` — Auto-detect iOS/Android projects and add native build validation (xcodebuild, Gradle) to health check gate; introduces shared `detectProjectType` infrastructure

## Phase XIV: Runtime Intervention
<!-- depends: Phase IX -->

### Group A: Intervention Classification
- [x] `runtime-human-intervention` — Classify parked items as human-needed vs code-bug, generate actionable instructions, update roadmap, surface in action command *(partial removal: classifier removed; action command remains)*
- [x] `human-prerequisite-blocking` — Block orchestrator on prerequisite HUMAN items (non-Group-Z), pause for human action before dependent phases start

## Phase XV: Interactive Agent Sessions
<!-- depends: Phase XI -->

### Group A: Riley CLI Mode
- [x] `riley-cli-session` — Replace Riley's in-process agent chat with spawning Claude Code CLI (like Morgan pair mode), enabling native tool use, streaming output, and consistent interactive experience across kickoff and talk commands

## Phase XVI: Morgan Orchestrator
<!-- depends: Phase XV -->

### Group A: Morgan Run Mode
- [x] `morgan-orchestrator` — Replace SDK-based isolated agent spawning in `run` command with Morgan as a persistent CLI session that reads the roadmap, implements items sequentially, and delegates to sub-agents for parallel groups

## Phase XVII: Platform Simplification
<!-- depends: Phase XVI -->

### Group A: Dead Code Removal
- [x] `remove-sdk-orchestrator` — Remove the dead SDK orchestration engine (parallel-orchestrator, microcycle, agent pool, triage, health-gate machinery), the watch/broadcast and report features, and unused agent templates; re-home the health check as a pre-run preflight that injects failures into Morgan's prompt

### Group B: Token Estimation
<!-- depends: Phase XVII Group A -->
- [ ] `token-estimator` — Replace the removed dollar-based cost estimator with a token-based estimator: clearer units, model-price independent, sourced from Claude Code session usage instead of orchestrator summaries; re-enables run/status estimates and the monthly review

### Group C: Scheduling Validation
<!-- depends: Phase XVII Group A -->
- [ ] `scheduled-terminal-run` — Scheduled windows open a real Terminal window instead of running headless: `schedule install` generates a `.command` wrapper per run window and the launchd plist invokes `open -a Terminal <wrapper>.command`, giving the scheduled run a real TTY so the identical interactive Morgan flow (health gates, window boundaries, consolidation) runs unchanged; wrapper exits cleanly to allow window auto-close; macOS-only (cron fallback keeps direct invocation and is documented as unsupported for run windows)
- [ ] `scheduling-e2e-validation` — [HUMAN] Full end-to-end test of the never-yet-used scheduling subsystem (after `scheduled-terminal-run`): `schedule install` → launchd plist fires → Terminal window opens with `run --window night` → autonomous Morgan session → post-session health gate → consolidation → morning digest; verify first-fire permissions, behavior while screen-locked, and pause/resume/remove lifecycle

## Phase XVIII: Usage-Limit Resilience
<!-- depends: Phase XVII Group A -->

### Group A: Auto-Resume
- [x] `limit-aware-resume` — When the account usage limit stops Morgan (frozen interactive session detected via transcript-mtime stall, or early exit), `run` confirms it with a cheap availability probe, polls until the limit window resets, then respawns Morgan with `--resume` (context intact); time limit counts active session time only, respects window end, caps resume attempts, and can be disabled with `--no-auto-resume`

### Group B: Unattended Reliability
<!-- depends: Phase XVIII Group A -->
- [x] `run-until-done` — Continue an idle Morgan automatically: when the transcript stalls and the probe says the account is available (e.g. after Claude Code's "usage limit approaching — checkpoint now" injection makes Morgan summarize and wait for input), terminate and respawn with `--resume` plus a keep-going prompt, while unblocked roadmap work remains; bounded by a futile-continuation cap (3 with no roadmap/commit progress) and the `--no-auto-resume` opt-out
- [x] `limit-detection-hardening` — Fix field failure where a limit-frozen session was never detected: probe reads stdout+stderr with a broadened limit pattern, probes with Morgan's configured model (catches model-specific caps), the stall watcher re-probes on a 15-min interval instead of disarming after one non-limited verdict, and transcript tracking follows the newest `.jsonl` in the project dir so detection survives `--resume`

## Phase XIX: Unbounded Runs
<!-- depends: Phase XVIII -->

### Group A: Remove Session Limits
- [x] `remove-run-time-limit` — Strip the session time-limit concept (`--time-limit`, 7h default, SIGTERM timer, active-time accounting) and the unenforced run budget (`--budget` for run, header/prompt/defaults) so `./devshop run` continues until the project is done or the operator stops it; windowed runs keep their end-of-window boundary via `windowEndTimeMs`; usage-limit auto-resume caps and the security scan budget are unchanged
- [x] `morgan-continue-until-blocked` — Prompt hardening so Morgan doesn't stall mid-run: continue-by-default stop rules (stop only when every remaining item is complete, parked, or blocked by a `[HUMAN]` prerequisite / parked dependency), Group Z checkpoints and phase boundaries are explicitly not stopping points, no end-of-turn status summaries while unblocked work remains, and the interactive initial/continuation prompts tell Morgan not to pause for input

## Phase XX: Remote Operation
<!-- depends: Phase XIX -->

### Group A: Phone Access
- [ ] `remote-control-sessions` — Start `kickoff`/`talk`/`pair`/`run` sessions with Claude Code Remote Control (`remoteControl.enabled` config or `--remote-control` flag, named per agent and project, kept across run-loop respawns) so the same local session is reachable from the Claude mobile app with full transcript sync, forwarded questions, and push notifications

### Group B: Control Server
<!-- depends: Phase XX Group A -->
- [ ] `remote-control-server` — `devshop remote` command family: a persistent `claude remote-control` control session in `active-agents/remote/` with a generated CLAUDE.md and narrow permissions, `launch` that starts orchestrator commands detached in named tmux sessions with `--remote-control`, `sessions` and graceful `stop`, and launchd `install`/`remove`/`status` (server runs inside tmux, restart loop with `--continue`)
