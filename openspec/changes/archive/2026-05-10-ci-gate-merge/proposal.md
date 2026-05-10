## Why

`consolidateToMain()` in `git-ops.js` calls `gh pr merge --merge --delete-branch` immediately after creating the PR, without waiting for CI checks to pass. This means broken code can land on main if any status checks (tests, linting, build) would have caught it. The orchestrator needs to gate merges on CI passage and surface failures so they can be fixed in pair mode with Morgan.

## What Changes

- `consolidateToMain()` will poll for CI check completion using `gh pr checks --watch` before merging
- If checks pass, merge proceeds as before
- If checks fail, the merge is skipped and a warning is printed with the PR URL and failing check names, so the developer can fix it in pair mode
- Configurable timeout for how long to wait for checks (default: 10 minutes)
- When no checks are configured on the repo, merge proceeds immediately (backwards compatible)

## Capabilities

### New Capabilities

_None_

### Modified Capabilities

- `git-workflow`: Add CI check gating requirement to the Session Consolidation section — merges must wait for status checks to pass before completing

## Impact

- `platform/orchestrator/src/git/git-ops.js` — `consolidateToMain()` method gains check-waiting logic
- All callers of `consolidateToMain()` benefit automatically: `run.js`, `pair.js`, `repair-orchestrator.js`
- Requires `gh` CLI (already a dependency)
- No new dependencies
