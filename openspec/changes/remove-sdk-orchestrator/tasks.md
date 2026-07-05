# Tasks: remove-sdk-orchestrator

## 1. Code Removal

- [x] 1.1 Delete dead SDK orchestration cluster (parallel-orchestrator, microcycle, state-machine, consumption-monitor, agent-pool, merge-lock, item-triage, intervention-classifier, repair-orchestrator, health-gate, preview/convention/import/completeness checkers, roadmap-reconciler) + all tests
- [x] 1.2 Delete watch/broadcast: commands/watch.js, infra/broadcast-server.js, infra/format-events.js + tests; remove `ws` dependency
- [x] 1.3 Delete report feature: commands/report.js, runners/report-processor.js + tests
- [x] 1.4 Delete templates: implementation-agent/, spike-agent/, triage-agent/, principal-engineer/{diagnostic,blocking-fix,project-repair,report-fix}-prompt.md, pm-agent/report-feature-prompt.md
- [x] 1.5 Delete platform/pm pm-runner.js + sandbox-hooks.js (keep devshop-context.js)

## 2. Surviving-File Edits

- [x] 2.1 index.js: remove watch/report commands, dead flags (--watch, --watch-port, --status), config keys, help text; keep --port for api
- [x] 2.2 plan.js: strip BroadcastServer + onEvent threading
- [x] 2.3 devshop-context.js: remove implementation-agent CONTEXT_FILES entry
- [x] 2.4 defaults.json: prune dead keys; update config.test.js assertions

## 3. Health-Check Preflight

- [x] 3.1 Add runPreflightHealthCheck to run.js using quality/health-checker
- [x] 3.2 Inject {{HEALTH_STATUS}} into run-prompt.md; repair-first initial prompt; resume-path injection
- [x] 3.3 Unit tests for preflight (pass/fail/skip/error paths)

## 4. Docs & Specs

- [x] 4.1 Delete 17 removed-capability specs
- [x] 4.2 Update 14 partially-affected specs
- [x] 4.3 Annotate roadmap entries; add Platform Simplification phase
- [x] 4.4 Update README (report section, health gate, window names)
- [x] 4.5 Update llms.txt (triage-agent, quality/runners descriptions)

## 5. Verification

- [x] 5.1 npm test green in orchestrator + pm packages
- [x] 5.2 Grep sweeps: no dangling references to deleted modules
- [x] 5.3 Smoke: devshop help, syntax checks, defaults.json parses
