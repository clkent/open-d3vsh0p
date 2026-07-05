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

## 5. Method-Level Prune (follow-up pass)

- [x] 5.1 Delete dead methods: git-ops (15), roadmap-reader (8), openspec-reader (14), logger (15 incl. writeSummary), cost-estimator.estimatePhaseCost — plus their tests
- [x] 5.2 Delete transitively-dead modules: quality/review-parser.js, infra/json-extractor.js (+ tests)
- [x] 5.3 Remove non-functional POST /agents/:role/invoke API stub
- [x] 5.4 Fix pair.js to pass project config to health checks (was passing {})
- [x] 5.5 Update affected specs (git-workflow, logging-observability, parallel-execution, spike-phases, agent-management, design-aware-agents, codebase-gotchas, rest-api, human-prerequisite-blocking) and roadmap annotation

## 7. Estimator Removal (follow-up pass)

- [x] 7.1 Delete session/cost-estimator.js and api/session-aggregator.js (+ tests) — summary files they read are no longer generated
- [x] 7.2 Remove cost-estimate displays from run and status; remove status last-session summary display
- [x] 7.3 Morning digest rebuilt from roadmap snapshot (no summary dependency)
- [x] 7.4 Disable monthly cadence review with notice; remove postMonthlyReport from github-notifier
- [x] 7.5 Stub session/token-estimator.js for the future token-based estimator; add pending roadmap item + project.md requirement
- [x] 7.6 Update specs: cadence-automation, daily-scheduling, cli-interface; annotate roadmap

## 8. Post-Session Health Gate (follow-up pass)

- [x] 8.1 Add runHealthCheckReport shared helper; refactor preflight onto it
- [x] 8.2 Post-session health verification: runs when the session changed the project, re-enters Morgan to repair (max 2 attempts, 15 min cap each)
- [x] 8.3 Skip consolidation to main when post-session health still failing; direct to pair + run --resume
- [x] 8.4 Tests for runHealthCheckReport and didSessionChangeProject
- [x] 8.5 Update project-health-check + git-workflow specs and README

## 9. Tech Debt Runner Removal (follow-up pass)

- [x] 9.1 Delete runners/tech-debt-runner.js (+ test) and tech-debt-prompt.md template
- [x] 9.2 Remove handleTechDebt + techdebt branch from run.js; drop 'techdebt' from VALID_WINDOWS and schedule-defaults.json
- [x] 9.3 Update specs (daily-scheduling, security-scan, agent-templates, test-coverage-integrity), README, llms.txt, help text; annotate roadmap

## 10. Verification

- [x] 10.1 npm test green in orchestrator + pm packages
- [x] 10.2 Grep sweeps: no dangling references to deleted modules
- [x] 10.3 Smoke: devshop help, syntax checks, defaults.json parses
