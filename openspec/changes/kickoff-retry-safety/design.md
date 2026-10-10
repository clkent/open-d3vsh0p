## Context

`ProjectScaffolder.scaffold()` runs: verify `gh auth status` → `gh repo create --clone` (falls back to clone if the repo exists) → render templates → `git add -A` + `git commit` → `git push --no-verify -u origin main|HEAD` → write registry entry. The starter template includes `.github/workflows/test.yml`. GitHub rejects any push that creates or updates a workflow file from an OAuth token without the `workflow` scope; `gh auth login` by default grants only `repo`, `read:org`, `gist`.

When the push fails, the remote repo and local directory with a scaffold commit survive, but the registry entry (written after push) does not. A retry reaches `git commit` on a clean tree and throws, so the user must `rm -rf` the project directory first.

## Goals / Non-Goals

**Goals:**
- Fail before any side effect when the token cannot push the template.
- Make every step from "repo exists" to "registry written" idempotent so a bare retry succeeds.
- Give the user a one-line fix when the push is rejected for scope reasons.

**Non-Goals:**
- Removing the workflow file from the template or pushing it in a second commit.
- Automatic token refresh (`gh auth refresh` is an interactive device flow).
- Rolling back the remote repo on failure.

## Decisions

1. **Scope preflight in `_verifyGhCli()`.** Parse the `Token scopes:` line from `gh auth status` (stdout+stderr; gh prints it to stderr on some versions). If `TEMPLATES_DIR/.github/workflows` contains any file and the scopes do not include `workflow`, throw with the message: `GitHub token is missing the 'workflow' scope (needed to push .github/workflows/*). Run: gh auth refresh -h github.com -s workflow`. If the scopes line cannot be parsed (e.g. `GH_TOKEN` fine-grained token, unexpected format), log a warning and continue rather than block — the push-time mapping still catches the failure.
2. **Idempotent commit.** Before `git commit`, run `git status --porcelain`. Empty output → log `kickoff_nothing_to_commit` and skip to push. This covers the retry case (previous attempt committed) without needing `--allow-empty`, which would pollute history.
3. **Push error mapping.** Wrap the push fallback chain; if the final error's stderr matches `/workflow.*scope|refusing to allow an OAuth App/i`, rethrow with the same actionable message as decision 1. Other errors propagate unchanged.
4. **Keep the registry write after push.** Writing it earlier would register projects whose remote has no commits; with idempotent commit the retry now reaches the registry step, so the ordering is fine.

## Risks / Trade-offs

- `gh auth status` output format is not a stable API. Mitigated by soft-failing the parse (decision 1) and keeping the push-time mapping as a backstop.
- A retry re-renders templates over an existing directory. This already happens today for the "repo exists" path and the renderer overwrites deterministically; no new risk.
