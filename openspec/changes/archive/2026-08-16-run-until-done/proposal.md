# Proposal: run-until-done

## Why

Morgan reliably stops mid-run with "Checkpoint reached … Most impactful remaining work:" and never continues. Transcript evidence shows the cause is not Morgan's judgment and not the orchestrator's prompts: Claude Code injects a message when the account's usage limit is **approaching** —

```
[Usage limit approaching. Checkpoint now: finish the current step, then list up to 3 short bullets of the most impactful remaining work. Don't start subagents or long-running work.]
```

— and Morgan correctly obeys it, wrapping up and ending his turn. An interactive `claude` process does not exit when a turn ends; it waits for input forever. That produces a deadlock no existing mechanism can break: the early-exit path never fires (no exit), and the stall watcher probes, gets `available` (the limit was only *approaching*, never hit), and takes no action — the limit may never actually be hit precisely because Morgan stopped working. Prompt guidance cannot fix this: the injected instruction is harness-level and outranks the system prompt, and it is reasonable behavior on its own terms.

## What Changes

- The stall watcher gains an idle-with-work outcome: when the transcript is stalled and the probe returns `available`, the orchestrator asks the caller whether to nudge.
- The run loop **nudges** an idle Morgan: terminate the waiting process and respawn with `--resume` plus an explicit continue prompt, so the conversation and context carry over. Same proven mechanism as limit-resume, applied to voluntary/checkpoint stops.
- Nudging is bounded: it only fires while unblocked pending roadmap work remains, and a futile-nudge cap (default 3 consecutive nudges producing no roadmap or commit progress) stops ping-ponging when Morgan is genuinely stuck. Progress resets the counter, so a long healthy run can be nudged any number of times.
- Nudging follows the `--no-auto-resume` opt-out (same "keep the run alive unattended" intent) and never fires past a scheduled window's end.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `limit-aware-resume`: stall detection gains the idle-available outcome; the session loop gains bounded idle nudging with `--resume` respawn.
- `morgan-orchestrator`: the run lifecycle wrapper continues an idle Morgan while unblocked work remains, rather than ending the run.

## Impact

- `platform/orchestrator/src/commands/limit-resume.js` — watcher outcome, nudge loop
- `platform/orchestrator/src/commands/run.js` — pending-work and progress-signature callbacks, nudge prompt, session summary
- `platform/orchestrator/src/commands/limit-resume.test.js` — nudge tests
- Builds on `limit-detection-hardening` (PR #46); branched from it.
