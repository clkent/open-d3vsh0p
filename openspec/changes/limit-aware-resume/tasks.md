# Tasks: limit-aware-resume

## 1. Limit-Resume Module (probe)

- [ ] 1.1 Create `platform/orchestrator/src/commands/limit-resume.js` with `probeAvailability()`: spawn `claude -p "ok" --model <cheap model>` with piped stdio and ~60s timeout; classify exit/stderr into `available` / `limited` / `unknown` per the spec's pattern; export constants (`STALL_THRESHOLD_MS`, `PROBE_INTERVAL_MS`, `MAX_WAIT_MS`, `MAX_AUTO_RESUMES`)
- [ ] 1.2 Unit tests for probe classification (exit 0 → available; non-zero + limit-pattern stderr → limited; non-zero other / timeout → unknown), injecting a fake spawn

## 2. Stall Detection

- [ ] 2.1 Add transcript path resolution: sanitize `projectDir` (non-alphanumerics → `-`) and build `~/.claude/projects/<sanitized>/<sessionId>.jsonl`; unit test the sanitization against a real path example
- [ ] 2.2 Add `watchForStall()`: poll transcript mtime every ~60s; after `STALL_THRESHOLD_MS` without change, invoke probe; on `limited` signal limit-condition (caller kills Morgan); on `available` back off until new activity + fresh stall; self-disable with warning if transcript file never appears
- [ ] 2.3 Unit tests for stall watcher (stall → probe; benign-idle backoff — no second probe without new activity; missing-file self-disable), using temp files and injected probe/clock

## 3. Wait Loop

- [ ] 3.1 Add `waitForLimitReset()`: probe every `PROBE_INTERVAL_MS`, print "usage limit hit — next probe at HH:MM (Ctrl+C to stop)"; return `resume` on `available`; return `giveUp` when `MAX_WAIT_MS` exceeded, resume cap reached, or (`windowEndTimeMs` set and projected resume past window end / <15 min left); `unknown` continues loop
- [ ] 3.2 SIGINT handling during wait: cancel wait, return `giveUp` so the run falls through to normal post-session steps; restore prior SIGINT disposition afterwards
- [ ] 3.3 Unit tests for wait-loop bounds and SIGINT (injected probe results, fake timers)

## 4. run.js Integration

- [ ] 4.1 Wrap the Morgan spawn in a resume loop: start stall watcher alongside `morganPromise`; on limit-condition SIGTERM (then SIGKILL after grace) the frozen process; on early exit (>15 min budget left) probe once; enter `waitForLimitReset()` only on `limited`; respawn via existing `--resume` path with continuation prompt; skip everything when `config.autoResume` is false
- [ ] 4.2 Active-time accounting: track cumulative active session time across spawns; re-arm the SIGTERM timer with the remainder on each resume; never count wait time
- [ ] 4.3 Sequencing: save session ID after every Morgan exit; run post-session health gate + consolidation exactly once after the final exit; hold the run lock across waits/resumes (verify the existing finally still releases it)
- [ ] 4.4 Integration-style tests for the loop (mock spawn/probe): limit → wait → resume → final exit runs post-session once; intentional early exit resumes nothing; `--no-auto-resume` bypasses detection

## 5. CLI Flag & Help

- [ ] 5.1 Add `--no-auto-resume` (boolean, default false) to `parseArgs` in `platform/orchestrator/src/index.js`; expose `config.autoResume` (default true); update `--help` text for `run`
- [ ] 5.2 Unit test option parsing (default true; flag → false)

## 6. Docs & Verification

- [ ] 6.1 Update `README.md` run usage: auto-resume behavior, `--no-auto-resume`, waiting-state output
- [ ] 6.2 Confirm `openspec/roadmap.md` Phase XVIII entry still matches final behavior; adjust wording if implementation deviated
- [ ] 6.3 Manual verification: simulate a limit (stub probe to return `limited`, or run with a nearly-exhausted account) and observe kill → wait banner → resume with context intact; verify Ctrl+C during wait ends the run cleanly through health gate/consolidation
- [ ] 6.4 Resolve design open questions during implementation (probe model choice; constants stay internal; continuation prompt adequacy after mid-turn interruption) and note outcomes in design.md
