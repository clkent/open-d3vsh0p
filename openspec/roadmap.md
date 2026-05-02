# Roadmap: d3vsh0p Agent Platform

## Phase I: Core Platform

### Group A: Orchestration Engine
- [x] `orchestrator-core` — State machine, microcycle loop, retry logic, crash recovery
- [x] `consumption-monitoring` — Budget, time, invocation tracking with graceful shutdown
- [x] `early-exit-no-work` — Skip session/branch/log creation when roadmap is fully complete

### Group B: Agent System
- [x] `agent-management` — Claude Agent SDK invocation, template engine, prompt building
- [x] `agent-pool` — Persona registry, round-robin assignment

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
- [x] `parallel-execution` — Roadmap parsing, phase dependencies, group concurrency, merge lock

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
- [x] `tech-debt-runner` — Security scan + PE improvement pass for techdebt window
- [x] `launchd-integration` — Plist generation, install/remove via launchctl, cron fallback
- [x] `schedule-cli` — schedule install/remove/status/dry-run commands
- [x] `github-daily-digest` — Rolling daily Issue per project via gh CLI

### Group C: Cadence Automation
- [x] `weekly-cleanup` — Stale branch pruning, dead worktree removal
- [x] `monthly-review` — Archive old parked items, cost aggregation report
- [x] `cadence-cli` — cadence run/status commands

## Phase V: Platform Quality
<!-- depends: Phase IV -->

### Group A: Reliability
- [x] `worktree-crash-recovery` — Detect and recover orphaned worktrees, stale branches, interrupted state
- [x] `predictive-budget-modeling` — Cost estimation from session history, pre-phase budget checks

### Group B: Observability
- [x] `structured-review-scoring` — Dimensional review scores, ReviewParser, metrics in status output
- [x] `microcycle-progress-events` — Real-time progress thoughts from agents during microcycle phases

### Group C: Quality Guardrails
- [x] `review-architecture-validation` — Tech stack compliance in reviews, post-merge architecture check

## Phase VI: Resilience & Diagnostics
<!-- depends: Phase V -->

### Group A: Worktree Safety
- [x] `worktree-test-isolation` — Ensure worktrees are .gitignored to prevent test runner interference

### Group B: Agent Diagnostics
- [x] `morgan-project-diagnostic` — Morgan as project doctor for stuck phases: diagnose, fix, retry

### Group C: Convention Enforcement
- [x] `project-conventions` — Per-project conventions file generated at kickoff, injected into all agent prompts, enforced by Morgan

### Group D: Baseline Verification
- [x] `project-health-check` — Pre-work health check gate with auto-detection, Morgan auto-repair, and pair-mode fallback

### Group E: Security Hardening
- [x] `security-hardening` — Template injection prevention, env whitelist, JSON extraction robustness, command validation, triage schema validation

### Group F: Session Lifecycle
- [x] `session-auto-consolidation` — Auto-consolidate session branches to main via PR at session end

### Group G: Microcycle Resilience
- [x] `microcycle-salvage-check` — Salvage completed work when agent fails due to context overflow (tests pass + commits exist)

## Phase VII: Platform Services
<!-- depends: Phase III -->

### Group A: API Layer
- [x] `rest-api` — REST API for programmatic access to DevShop

### Group B: Real-time
- [x] `live-broadcast` — WebSocket broadcast server, stream-json agent output, watch command
- [x] `session-progress-visibility` — Milestone notifications, progress line, "go look" alerts in watch command
- [ ] `realtime-updates` — Web dashboard, agent activity visualization (depends on live-broadcast)

## Phase VIII: Roadmap Integrity
<!-- depends: Phase VI -->

### Group A: Salvage Marking
- [x] `salvage-roadmap-mark` — Mark roadmap items complete when salvaged work is successfully merged on park

### Group B: Consolidation Audit
- [x] `consolidation-roadmap-audit` — Post-consolidation scan for merged items not marked complete in roadmap

### Group C: Session Reconciliation
- [x] `session-start-reconciliation` — Pre-session git log scan to detect and mark already-completed pending items

### Group D: Integration Quality Gates
- [x] `integration-quality-gates` — Post-merge smoke test, end-of-phase health gate, and review context enrichment for catching integration bugs

### Group E: Roadmap Format Validation
- [x] `roadmap-format-validation` — Detect and fix malformed roadmap items after generation, with retry loop in kickoff and pre-commit gate in plan

## Phase IX: Agent Intelligence
<!-- depends: Phase VI -->

### Group A: Codebase Context
- [x] `codebase-grounding` — Pre-read key project files and inject into implementation prompts so agents build on real code, not hallucinated patterns
- [x] `codebase-gotchas` — Replace CodebaseScanner with lightweight human-curated gotchas system; agents explore codebases with their own tools

### Group B: Risk Preflight
- [x] `risk-preflight` — Lightweight read-only planning step before implementation: identify files, risks, and strategy before writing code

### Group C: Adaptive Retry
- [x] `adaptive-retry` — Strategy-shift instructions on retry, attempt history tracking, and failure pattern detection when parking
- [x] `adaptive-retry-stall-detection` — Stall vs progress detection via git snapshots, dual-counter parking (stall limit + max attempts), progress-aware retry prompts

### Group D: PM Prompt Quality
- [x] `pm-roadmap-granularity` — Spec-roadmap alignment rules and self-audit checklist in PM prompts to prevent over-coarse roadmap items that block parallel execution
- [x] `pm-roadmap-template` — Complete roadmap template example in PM prompts replacing verbose scattered examples

### Group E: Spike Phases
- [x] `spike-phases` — Technical uncertainty investigation before implementation with auto-pause for human review

### Group F: Project Context Injection
- [x] `project-context-injection` — Auto-load user-provided context files from `context/` directory into Riley's first-turn prompt for kickoff and plan sessions

## Phase X: Agent Coordination & Compliance
<!-- depends: Phase IX -->

### Group A: Parallel Agent Coordination
- [x] `parallel-agent-coordination` — Peer context injection for parallel agents, shared file warnings, phase context for implementation agents

### Group B: Automated Convention Check
- [x] `automated-convention-check` — Zero-cost grep-based framework/convention compliance check before review, catching wrong test runner, styling lib, or ORM

### Group C: Import Verification
- [x] `import-verification` — Zero-cost file-system check that all imports resolve to real modules, catching hallucinated imports before tests run

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

### Group B: Quality Gates
<!-- depends: Phase XIII Group A -->
- [ ] `post-merge-build-gate` — Run full build validation (JS + native) after each merge instead of tests-only; uses shared project-type detection for command selection and per-command timeouts
- [ ] `code-quality-lint-gate` — Grep-based code quality checks (console.log, debugger, .bak files, debug UI) with project-type-aware default rules; advisory at review, warning at phase gate

## Phase XIV: Runtime Intervention
<!-- depends: Phase IX -->

### Group A: Intervention Classification
- [ ] `runtime-human-intervention` — Classify parked items as human-needed vs code-bug, generate actionable instructions, update roadmap, surface in action command
- [ ] `human-prerequisite-blocking` — Block orchestrator on prerequisite HUMAN items (non-Group-Z), pause for human action before dependent phases start

## Phase XV: Interactive Agent Sessions
<!-- depends: Phase XI -->

### Group A: Riley CLI Mode
- [ ] `riley-cli-session` — Replace Riley's in-process agent chat with spawning Claude Code CLI (like Morgan pair mode), enabling native tool use, streaming output, and consistent interactive experience across kickoff and plan commands

## Phase XVI: Figma Design Workflow
<!-- depends: Phase IX -->

### Group A: Design Foundations
- [ ] `design-tokens` — Canonical design token generation at kickoff, tech-stack-specific compilation, token injection into agent prompts

### Group B: Figma Integration
- [ ] `figma-design-workflow` — Design capture command, Figma MCP client, snapshot system, design reconciliation with Riley
