# Design: limit-detection-hardening

## Context

A limit-frozen interactive session never exits and never writes its transcript again. Early-exit detection therefore can't fire; everything rides on the stall watcher, which today probes exactly once per stall and permanently disarms on any verdict except `limited`. That makes the whole feature a single point of failure with no retry. Field failure confirmed: Morgan sat at the limit dialog all night with no polling.

## Goals / Non-Goals

**Goals:**
- Unattended operation: a limit hit mid-run is detected and recovered without the operator selecting anything in the dialog.
- Detection is eventually correct: transient probe misclassification delays detection but never kills it.
- Detection survives `--resume` (new transcript file).

**Non-Goals:**
- No parsing of reset timestamps from CLI output (unchanged; the wait loop polls).
- No change to the wait-loop bounds (15-min interval, 5.5h max, 2 resumes) or the dialog itself.
- No handling of machine sleep — an unattended run still requires the host to stay awake (`caffeinate` or power settings); documented, not solved.

## Decisions

1. **Classify from stdout + stderr.** Headless `-p` output routing is undocumented and has changed across CLI versions; the limit text may land on either stream. Both are captured (8KB cap each) and matched; neither is ever echoed to the orchestrator's output (ANSI-escape hygiene preserved).

2. **Probe with Morgan's model.** The probe's question is "can Morgan continue," and limits can be model-specific (the docs list a separate Opus cap). A hard-coded haiku probe answers the wrong question when Morgan runs Opus: it returns `available`, and a real limit reads as benign idle. The probe now mirrors Morgan's `--model` flag exactly — including omitting it when Morgan uses the account default. Cost: one one-word completion per probe on Morgan's model, only during stalls/waits — negligible.
   *Alternative:* probe haiku first, escalate to Morgan's model on `available` — rejected as complexity without meaningful savings.

3. **Re-probe on an interval instead of one-shot disarm.** While the transcript stays stalled past the threshold, the watcher re-probes every `REPROBE_INTERVAL_MS` (15 min, matching the wait loop's cadence). Fresh activity resets the cycle as before. This is the load-bearing fix: every other defect (wording drift, stream routing, transient network failure at probe time) becomes a delay instead of a permanent miss. A benign genuinely-idle session costs one cheap probe per 15 minutes, and probes are never echoed, so the cost of over-probing is trivial.

4. **Watch the transcript directory, not one file.** `--resume` forks a new session ID and writes a new `.jsonl`; the old file never advances, so a fixed-path watcher sees an eternal stall on resumed runs. The watcher now takes an mtime source that returns the max mtime across `*.jsonl` files in the project's sanitized transcript directory (`latestTranscriptMtime(projectDir)`). Only mtimes are read, never file contents (unchanged invariant).
   *Trade-off:* a concurrent `pair`/`talk` session in the same project would register as activity and suppress stall detection — acceptable, since a concurrently-interacting operator is present by definition.

## Risks / Trade-offs

- [Broadened pattern can match transient API errors (e.g. rate-limit 429s) as `limited`] → Benign: the wait loop probes every 15 minutes and resumes on the first `available`; a false `limited` costs minutes, while a false `unknown` used to cost the whole run.
- [Probing with a large model costs more than haiku] → One-word completions during stalls only; negligible against an idle-forever run.
- [Directory mtime scan each poll] → A handful of stats once a minute; noise.

## Migration Plan

Single PR, stacked on #45 (which stacks on #44). `PROBE_MODEL` constant is removed; `watchForStall`/`runSessionWithAutoResume` signatures change (internal API, only `run.js` consumes them).
