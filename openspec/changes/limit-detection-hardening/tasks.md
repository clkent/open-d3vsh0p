# Tasks: limit-detection-hardening

## 1. Probe

- [x] 1.1 Broaden `LIMIT_PATTERN` (`hit/reached your … limit`, `usage limit`, `limit reached`, `resets`) and match against combined stdout+stderr; capture stdout (8KB cap) alongside stderr, never echo either
- [x] 1.2 `probeAvailability` accepts a `model` option: pass `--model <model>` when set, omit otherwise; remove the hard-coded `PROBE_MODEL` haiku constant

## 2. Stall Watcher

- [x] 2.1 Replace the one-shot disarm with interval re-probing: while stalled past the threshold, probe at most once per `REPROBE_INTERVAL_MS` (15 min); fresh activity resets the cycle
- [x] 2.2 Watch the newest `*.jsonl` mtime in the project transcript directory via a `latestTranscriptMtime(projectDir)` source instead of a fixed transcript file; keep the three-strikes missing-transcript fallback

## 3. Wiring

- [x] 3.1 `runSessionWithAutoResume` takes `getTranscriptMtime` and `model`; default probe (watcher, early-exit, wait loop) uses Morgan's model; `run.js` passes both

## 4. Tests and Docs

- [x] 4.1 Update `limit-resume.test.js`: stdout classification, model flag pass-through/omission, re-probe-while-stalled, resume-survival via directory mtime source, missing-directory fallback
- [x] 4.2 Full test suite passes
- [x] 4.3 README: note unattended runs need the host awake (`caffeinate`); add roadmap entry (Phase XVIII, new Group B)
