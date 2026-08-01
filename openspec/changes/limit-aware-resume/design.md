# Design: limit-aware-resume

## Context

`run` spawns the `claude` CLI interactively (`stdio: 'inherit'`, real TTY) via `spawnClaudeTerminal()` (`cli-spawn.js:46`). Verified behavior of the CLI (v2.1.215) when the account usage limit is hit:

- **Interactive mode: the process does NOT exit.** It stays open, frozen, showing "You've hit your session limit · resets 3:45pm". No auto-continue after reset; it waits for user input.
- **Headless mode (`claude -p`): exits non-zero** with the limit message on stderr. The reset timestamp appears only in the human-readable message, not in structured output.
- There is no documented programmatic way to query limit status or reset time.

Consequence: the common failure shape is not an early *exit* but a **frozen child process** that sits idle until the `timeLimitMs` SIGTERM fires hours later. The design must detect both shapes: (a) frozen-but-alive, (b) early exit (user closed the stuck session, or CLI behavior differs by version/mode).

Existing building blocks: session persistence + `--resume` with a continuation prompt (`run.js:199-227`), the time-limit SIGTERM timer (`run.js:213-219`), the run lock, and the post-session health gate + consolidation.

## Goals / Non-Goals

**Goals:**
- Detect a usage-limit condition during a Morgan run — whether the child froze or exited — without parsing CLI output.
- Wait out the limit window bounded by clear caps, then resume Morgan with full context.
- Never auto-resume an intentionally ended session; always leave the operator an immediate escape hatch.
- Run post-session steps (health gate, consolidation) exactly once, after the final exit.

**Non-Goals:**
- Parsing the reset timestamp from error messages (format is unstable; fixed-interval polling is enough).
- Budget/token enforcement (separate `token-estimator` work).
- Handling weekly-limit exhaustion beyond bounding the wait (a capped wait naturally gives up).
- Parsing session transcript *content* (internal format; we only stat mtime).

## Decisions

### 1. Availability probe: headless `claude -p` call, classified by exit code + stderr pattern

`probeAvailability()` runs `claude -p "ok" --model <cheap model>` with piped stdio, short timeout (~60s), and classifies:

- exit 0 → `available`
- non-zero + stderr matching `/hit your (session|weekly)? ?limit|resets /i` → `limited`
- anything else (network error, timeout) → `unknown`

Rationale: it's the only reliable signal — there is no status API or local file with limit state. A failed probe while limited costs nothing (request is refused); a successful probe costs one minimal cheap-model call.

Alternatives considered: parsing the frozen interactive session's screen (impossible — `stdio: 'inherit'`); reading `~/.claude` state files (none documented); parsing reset time and sleeping until it (message format unstable; polling is simpler and self-correcting).

`unknown` is treated as "keep waiting/watching, retry sooner" — never as confirmation in either direction.

### 2. Frozen-session detection: transcript mtime stall + probe confirmation

Claude Code appends to `~/.claude/projects/<sanitized-projectDir>/<sessionId>.jsonl` as the session progresses (path sanitization: non-alphanumerics in the project path → `-`). We know both components, so a watcher `fs.stat`s the file every minute:

- mtime stalls for `STALL_THRESHOLD_MS` (default 10 min) → run the probe.
- Probe `limited` → limit condition: SIGTERM Morgan, enter the wait loop.
- Probe `available` → Morgan is merely idle (finished its turn, or an interactive user is at the prompt). Take no action, and **don't re-probe until the transcript shows new activity followed by another stall** — this prevents repeated probe calls while a user idles at the prompt.

We stat mtime only — never parse content — so the documented instability of the JSONL format doesn't apply. If the transcript file can't be found after session start (path convention changed, `--no-session-persistence`, etc.), stall detection disables itself with a logged warning and only exit-based detection remains.

Alternative considered: relying solely on the time-limit SIGTERM (status quo) — wastes the whole remaining window.

### 3. Exit-path detection: probe on early exit

If Morgan exits with >15 min of session time remaining: probe once. `limited` → wait loop. `available` → intentional/normal end, conclude the run (this is the "operator quit the session" path — no resume). Exits at/after the time limit skip the probe entirely.

### 4. Wait loop: fixed-interval polling with hard bounds

While limited: print `usage limit hit — next probe at HH:MM (Ctrl+C to stop)`, sleep `PROBE_INTERVAL_MS` (default 15 min), re-probe. Exit conditions:

- probe `available` → resume Morgan
- total wait exceeds `MAX_WAIT_MS` (default 5.5 h — one full reset window plus slack) → give up, conclude run (covers weekly-limit exhaustion)
- auto-resume count would exceed `MAX_AUTO_RESUMES` (default 2 per run) → conclude run
- scheduled runs: projected resume time past `windowEndTimeMs` (or less than 15 min of window left) → conclude run
- SIGINT → conclude run

During the wait, a SIGINT handler cancels the wait and falls through to the normal post-session sequence (health gate, consolidation) rather than killing the orchestrator dead — cancel still produces a clean run end.

### 5. Time accounting: `timeLimitMs` measures active session time; windows stay absolute

The wait pauses the session clock: on resume, the remaining time budget is `timeLimitMs − active time already used`, and the SIGTERM timer is re-armed with that remainder. Rationale: with an absolute deadline, a limit hit at hour 2 of a 7-hour run would leave nothing after a 5-hour wait — auto-resume would never fire, defeating the feature.

Scheduled window runs get the additional absolute cap from `windowEndTimeMs` (Decision 4), so a night window can never bleed into the day.

### 6. Resume reuses the existing path unchanged

Resume = respawn via `spawnClaudeTerminal({ resume: sessionId, initialPrompt: <existing continuation prompt> })`, exactly like `--resume` today (`run.js:204-208`). Session ID is saved after every Morgan exit (already idempotent); health gate and consolidation run once, after the loop concludes.

### 7. Opt-out flag, on by default

`--no-auto-resume` disables both detection paths for the run. Default-on because the feature is inert unless a probe confirms the account is limited, and the flag plus Ctrl+C cover every "I meant to stop" case. Structure: new module `src/commands/limit-resume.js` (probe, stall watcher, wait loop) so `run.js` gains only the loop wiring; constants live there, not in user config, until real usage says otherwise.

## Risks / Trade-offs

- [Limit-message wording changes across CLI versions → probe misclassifies `limited` as `unknown`] → `unknown` keeps the watcher alive and retries; worst case behavior degrades to today's status quo (frozen until time limit), never to a wrong resume. Pattern kept broad and case-insensitive.
- [Transcript path convention changes] → stall detection self-disables with a warning; exit-path detection still works.
- [Stall threshold too aggressive during legitimately long silent operations (big builds)] → transcript gets tool-result writes during activity, and even a false stall only triggers a probe; probe returns `available` → no action taken.
- [Interactive user walks away mid-run, limit hits, orchestrator kills the frozen session and later resumes] → intended behavior, but the terminal now shows a new Morgan session the user didn't start; the waiting-state banner and resume banner make the transition legible.
- [SIGTERM on a frozen claude process fails to kill it] → follow with SIGKILL after a grace period (same pattern as any supervisor).
- [Probe spends tokens when account is not limited] → one minimal cheap-model call per confirmed stall episode; bounded by the re-probe backoff in Decision 2.

## Migration Plan

Pure additive change to `run`; no state or schema migration. Rollback = revert; `--no-auto-resume` provides a runtime kill-switch without rollback.

## Open Questions

All resolved during implementation:

- **Probe model** → the `haiku` model alias, hardcoded (`PROBE_MODEL` in `limit-resume.js`). The alias is version-independent — the CLI resolves it to the current cheapest tier — so it can't go stale like a dated model id.
- **Constants** → stay internal to `limit-resume.js` (not surfaced in `schedule-defaults.json`); all are injectable via the `deps` parameter for tests, and can be promoted to config later if real scheduled usage demands it.
- **Continuation prompt after a mid-turn interruption** → reuses the existing resume prompt ("continue from where you left off; check roadmap.md"), which re-grounds Morgan in the roadmap rather than trusting interrupted-turn state; adequacy to be confirmed in the live limit test (task 6.3, run jointly with the operator).
