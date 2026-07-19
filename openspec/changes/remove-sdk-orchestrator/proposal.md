# Proposal: remove-sdk-orchestrator

## Why

The `run` command was rewritten to spawn Morgan as a persistent Claude Code CLI session (`morgan-orchestrator`), and kickoff/talk/pair spawn Riley/Morgan CLIs. The old SDK-driven orchestration engine — `parallel-orchestrator.js` and everything reachable only through it (microcycle, state machine, agent pool, triage, repair orchestrator, health gate, consumption monitor, merge lock) — has zero production importers and is dead weight: ~40 source/test files, stale config keys, and unused agent templates that mislead both humans and agents reading the codebase.

Two features are also removed by decision: the watch command + WebSocket broadcast server (Morgan streams inline via inherited stdio; the broadcast path's only remaining producer was plan sessions) and the report command (queued reports were only ever drained by the dead orchestrator).

The health-check gate capability is retained but re-homed: `run` now executes the project's health check before spawning Morgan and, on failure, injects the failure output into Morgan's prompt so repairing the baseline is his first task — the CLI-native replacement for the SDK RepairOrchestrator.

## What Changes

- Delete the dead SDK orchestration cluster from `platform/orchestrator/src/`: parallel-orchestrator, microcycle, state-machine, consumption-monitor, agent-pool, merge-lock, item-triage, intervention-classifier, repair-orchestrator, health-gate, preview/convention/import/completeness checkers, roadmap-reconciler — plus all their tests.
- Remove the watch + broadcast feature: `commands/watch.js`, `infra/broadcast-server.js`, `infra/format-events.js`, the `--watch`/`--watch-port`/`--status` flags, and the `ws` dependency. Strip broadcasting from `plan.js`.
- Remove the report feature: `commands/report.js`, `runners/report-processor.js`, related templates.
- Delete unused agent templates: `implementation-agent/`, `spike-agent/`, `triage-agent/`, and dead principal-engineer/pm-agent prompt files.
- Delete `platform/pm/src/pm-runner.js` and `sandbox-hooks.js` (superseded by Riley CLI sessions); keep `devshop-context.js`.
- Prune dead `config/defaults.json` keys: `personas`, `parallelism`, `retryLimits`, `git`, `maxAgentInvocations`, `warningThresholdPct`, `agents.{implementation,spike,triage,diagnostic}`.
- Add pre-run health check to `run.js` (`runPreflightHealthCheck`) using the live `quality/health-checker.js`, with `{{HEALTH_STATUS}}` injection into Morgan's run prompt (and into the initial prompt on `--resume`).

## Capabilities

### Removed
`orchestrator-core`, `consumption-monitoring`, `agent-pool`, `adaptive-retry`, `microcycle-salvage-check`, `triage-classification`, `automated-convention-check`, `import-verification`, `roadmap-reconciliation`, `live-broadcast`, `inline-watch-mode`, `report-command`, `graceful-pause`, `parallel-agent-coordination`, `codebase-grounding`, `risk-preflight`, `integration-quality-gates`

### Modified
`cli-interface`, `parallel-execution`, `project-health-check`, `native-build-validation`, `agent-templates`, `configuration-system`, `devshop-aware-pm`, `spike-phases`, `human-prerequisite-blocking`, `codebase-gotchas`, `design-aware-agents`, `git-workflow`, `logging-observability`, `test-coverage-integrity`

### New
None (the health-check preflight is a modification of `project-health-check`).

## Impact

- ~60 files deleted; no behavioral change to live commands except: `watch`/`report` commands removed, `run` gains the pre-flight health check.
- The SDK path (`agent-runner`/`agent-session`, `@anthropic-ai/claude-agent-sdk`) remains — still used by plan, kickoff bootstrap, security, and techdebt runners.
- Docs updated: README, llms.txt, roadmap annotations.
