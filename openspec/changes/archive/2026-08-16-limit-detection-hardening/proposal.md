# Proposal: limit-detection-hardening

## Why

The limit-aware resume feature failed in the field: a usage limit froze Morgan's interactive session at the wait/upgrade dialog and the orchestrator never intervened — no wait loop, no resume. Detection rests on a single stall-triggered probe whose verdict must be `limited`; any misclassification permanently disarms the watcher until new transcript activity (which never comes from a frozen session). The probe misclassifies in several known ways: it discards stdout (headless limit text may not be on stderr), it hard-codes haiku (misses model-specific caps like the Opus limit when Morgan runs a bigger model), and its regex is coupled to one interactive wording. Separately, on resumed runs the watcher watches the pre-resume session's transcript, which `--resume` never writes again, so detection dies ~10 minutes into any resumed session.

## What Changes

- Probe classification reads **stdout and stderr** and matches a broadened limit pattern (`usage limit`, `limit reached`, `hit/reached your … limit`, `resets`), keeping the existing forms.
- The probe runs with **Morgan's configured model** (omitting `--model` when Morgan uses the account default) so the probe answers "can Morgan continue," catching model-specific caps.
- The stall watcher's one-shot disarm is replaced with **periodic re-probing**: while the transcript stays stalled, re-probe on an interval (default 15 minutes) instead of never. Any transient misclassification self-heals.
- The watcher tracks the **newest `.jsonl` transcript in the project's transcript directory** instead of one fixed session file, so resumed sessions (new transcript file) stay watched.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `limit-aware-resume`: Availability Probe requirement (streams read, model, pattern) and Frozen-Session Stall Detection requirement (re-probe instead of disarm, directory-based transcript tracking).

## Impact

- `platform/orchestrator/src/commands/limit-resume.js` — probe, watcher, session-loop wiring
- `platform/orchestrator/src/commands/run.js` — pass Morgan's model and the transcript-directory mtime source
- `platform/orchestrator/src/commands/limit-resume.test.js` — probe/watcher tests
- Builds on `remove-run-time-limit` (PR #44) and `morgan-continue-until-blocked` (PR #45); branched from the latter.
