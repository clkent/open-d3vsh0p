## Why

A kickoff whose initial push is rejected by GitHub (observed in the field: the `gh` token lacked the `workflow` scope, so pushing the starter template's `.github/workflows/test.yml` was refused) leaves the project half-created: the remote repo exists, the local directory holds a scaffold commit, and nothing is in the registry. Re-running `./devshop kickoff <name>` then fails at the commit step with "nothing to commit", so the only recovery is to delete the local directory by hand. Kickoff should fail fast on the missing scope and be safe to re-run after any push failure.

## What Changes

- Preflight the GitHub token scopes in the scaffolder's `gh` verification step: when the starter template ships workflow files, require the `workflow` scope and fail before creating anything, with the exact `gh auth refresh` command to run.
- Make the scaffold's commit step idempotent: if the working tree is already clean (a previous attempt committed), skip the commit and proceed to push.
- Surface the GitHub "workflow scope" rejection as an actionable error if it still occurs at push time (e.g. scopes changed between preflight and push).
- Document the recovery path in the CLI error output and README.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `project-kickoff`: scaffold generation gains preflight scope checking and retry safety (re-running kickoff after a failed push completes without manual cleanup).

## Impact

- `platform/orchestrator/src/runners/project-scaffolder.js` — `_verifyGhCli()` scope check, idempotent commit, push error mapping.
- `platform/orchestrator/src/runners/project-scaffolder.test.js` — new cases for scope preflight, clean-tree retry, and push error mapping.
- `README.md` — prerequisites note: `gh` token needs `repo` and `workflow` scopes.
- No changes to CLI flags, config, registry format, or the starter template.
