## Context

`consolidateToMain()` in `git-ops.js` is the single function all code paths use to merge session work into main. It creates a PR and immediately merges it. Three callers: `run.js` (auto-consolidation at session end), `pair.js` (stale branch cleanup), and `repair-orchestrator.js` (blocking fix recovery).

The `gh pr checks` command supports `--watch` to block until checks complete, and exits with code 0 (all pass), 1 (error), or 8 (pending/timeout). It also supports `--json` for structured output and `--fail-fast` to exit on first failure.

## Goals / Non-Goals

**Goals:**
- Gate PR merges on CI check passage inside `consolidateToMain()`
- Surface check failures clearly with PR URL and failing check names
- Leave the PR open on failure so the developer can fix it in pair mode
- Remain backwards compatible when repos have no CI checks configured

**Non-Goals:**
- Auto-fixing CI failures (that's the developer's job in pair mode)
- Adding new CI checks or configuring branch protection rules
- Changing the merge strategy (stays `--merge`)
- Gating work-to-session merges (only session-to-main is affected)

## Decisions

### 1. Use `gh pr checks --watch --fail-fast` with a timeout

Poll for check completion using the `gh` CLI's built-in watch mode rather than implementing custom polling. `--fail-fast` exits early on the first failure instead of waiting for all checks.

The `--watch` flag handles retry/polling internally (default 10s interval). We pass a process-level timeout to `_exec()` to bound the wait.

**Alternative considered:** Custom polling loop with `gh pr checks --json`. More control but reimplements what `--watch` already does. Not worth the complexity.

### 2. Extract PR number from `gh pr create` output for check polling

`gh pr create` returns the PR URL. Parse the PR number from it (or use the URL directly — `gh pr checks` accepts URLs). This avoids a separate lookup.

### 3. Treat "no checks" as a pass

When a repo has no CI checks configured, `gh pr checks --watch` exits immediately with code 0. No special handling needed — merge proceeds as before.

### 4. On check failure: skip merge, log warning, return context

When checks fail:
1. Log the failing check names and PR URL
2. Print a console warning: `CI checks failed on <PR URL>. Fix in pair mode and merge manually.`
3. Do NOT merge — leave the PR open
4. Do NOT throw — consolidation failure is already non-fatal per the existing spec
5. Return a result object indicating failure so callers can act on it if needed

**Alternative considered:** Throwing an error on failure. Rejected because the existing spec says consolidation failure is non-fatal, and all callers already handle the no-merge case gracefully.

### 5. Configurable timeout, default 10 minutes

Pass timeout via the existing `_exec()` timeout mechanism. Default to 600000ms (10 minutes). Callers can override via the `context` parameter if needed.

**Why 10 minutes:** Long enough for most CI pipelines (build + test), short enough that the developer isn't waiting forever at session end.

## Risks / Trade-offs

- **Slower session exit** — Developer waits for CI instead of exiting immediately. Mitigated by `--fail-fast` (exits early on failure) and the 10-minute timeout cap.
- **Flaky CI** — A flaky check could block merges that would otherwise succeed. Mitigated by leaving the PR open so it can be retried or merged manually.
- **Timeout with long CI** — Some pipelines exceed 10 minutes. Mitigated by making timeout configurable. The PR remains open on timeout, same as a failure.
- **`gh pr checks` exit code 8** — Returned when checks are still pending at exit (timeout). We treat this the same as failure: skip merge, warn, leave PR open.
