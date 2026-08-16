# Design: run-until-done

## Context

Confirmed from `~/.claude/projects/<project>/<session>.jsonl`: Claude Code injects `[Usage limit approaching. Checkpoint now: … list up to 3 short bullets of the most impactful remaining work. …]` as a user-role message. Morgan complies and ends his turn — in the observed transcript, on his *first* turn, before starting any work ("No work started yet"). The operator's manual recovery was typing `continue`, which worked immediately.

Why nothing recovers automatically today:
- An interactive `claude` process does not exit at end of turn, so `await promise` in the session loop never resolves and early-exit detection cannot fire.
- The stall watcher fires (transcript stops advancing) but its probe returns `available` — the limit was approaching, not reached — and `available` is treated as benign idle. With `limit-detection-hardening` it re-probes every 15 minutes, which correctly keeps returning `available` forever, because an idle account never consumes quota.

So the run deadlocks with the account healthy and work pending. This change adds the missing action for exactly that state.

## Goals / Non-Goals

**Goals:**
- An idle Morgan with unblocked pending work is automatically continued, with full context.
- Bounded: no infinite respawn when Morgan is genuinely stuck or the roadmap is done/blocked.
- Composes with limit-resume: if continuing burns the last quota and the real limit lands, the existing wait-for-reset path takes over.

**Non-Goals:**
- Suppressing Claude Code's checkpoint injection (not ours to change, and it's protective — it makes Morgan commit and summarize before a hard cutoff).
- Writing to the running session's stdin (stdio is `inherit`; terminate-and-resume is the proven path).
- Changing `[HUMAN]` blocking, parking, or consolidation semantics.

## Decisions

1. **Nudge = terminate + `--resume` + explicit continue prompt.** Identical machinery to limit-resume, so context is preserved and the code path is already battle-tested. The prompt names the situation ("you stopped with pending work remaining; a checkpoint is not a stopping point") so Morgan doesn't immediately re-summarize.
   *Alternative:* inject "continue" into stdin — rejected: with `stdio: 'inherit'` the child shares the terminal's stdin; the orchestrator has no writable handle, and faking one would break interactive use.

2. **Trigger on `available` + stalled + pending work — never on `unknown`.** `limited` keeps its existing meaning (wait for reset). `unknown` continues re-probing rather than nudging, so a network blip can't cause a spurious respawn. The watcher reports the idle-available condition through an `onIdleAvailable` callback that returns whether the caller is handling it; when handled, the watcher stops (the process is being terminated).

3. **Two independent bounds, not a global cap.** (a) *Pending-work gate*: never nudge unless the roadmap has at least one pending item that isn't `[HUMAN]`-blocked — this is what makes "run until done" terminate naturally. (b) *Futile-nudge cap* (default 3): consecutive nudges that produce no change in the progress signature (roadmap complete-count + git HEAD) end the run. Any progress resets the counter, so a healthy 12-hour run can be nudged a dozen times while a wedged one gives up in three.
   *Alternative:* a flat max-nudges-per-run — rejected: it either strangles long healthy runs or permits long useless ones.

4. **Reuse `autoResume` as the opt-out; respect `windowEndTimeMs`.** `--no-auto-resume` already means "don't keep this run alive on your own." A nudge is never issued when the window deadline has passed (the deadline timer terminates the run anyway).

5. **Report nudges in the session summary** (`Continues: N (idle with work remaining)`), so a stalled-and-recovered overnight run is visible after the fact rather than silent.

## Risks / Trade-offs

- [Nudging right after a "limit approaching" checkpoint burns the remaining quota, then hits the real limit] → Intended for unattended runs: quota is used, the limit lands, limit-resume waits for reset and resumes. Net effect is more work per day, not less.
- [Rapid checkpoint→nudge→checkpoint loops near the limit boundary each cost a session start] → The futile-nudge cap bounds this to 3 when no work lands; when work does land, the cost is justified by progress.
- [A nudge terminates a session that was merely thinking for >10 minutes] → The stall threshold measures transcript *writes*; a working Morgan writes tool calls and results continuously. A 10-minute silent gap with no tool activity is not normal work.
- [Roadmap-based pending detection can misread a malformed roadmap] → Falls back to "no pending work" (no nudge), preserving today's behavior rather than looping.
