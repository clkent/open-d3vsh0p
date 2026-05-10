## 1. Core Implementation

- [x] 1.1 Add `waitForChecks(projectDir, prUrl, timeoutMs)` method to `git-ops.js` that runs `gh pr checks <prUrl> --watch --fail-fast` with the given timeout and returns `{ passed, failedChecks[] }`
- [x] 1.2 Modify `consolidateToMain()` to call `waitForChecks()` after PR creation, passing configurable timeout (default 600000ms)
- [x] 1.3 On check pass: proceed with existing merge + delete-branch + pull-main flow
- [x] 1.4 On check failure/timeout: skip merge, log warning with PR URL and failing check names, print console message `CI checks failed on <PR URL>. Fix in pair mode and merge manually.`
- [x] 1.5 Handle `gh pr checks` exit code 8 (pending/timeout) same as failure

## 2. Edge Cases

- [x] 2.1 Handle "no checks" case — when `gh pr checks` exits 0 immediately with no checks, merge proceeds
- [x] 2.2 Ensure consolidation remains non-fatal — wrap check-waiting in try/catch so network errors or `gh` CLI failures fall through to existing error handling

## 3. Configuration

- [x] 3.1 Accept optional `ciTimeoutMs` in the `context` parameter of `consolidateToMain()` to allow callers to override the default 10-minute timeout

## 4. Tests

- [x] 4.1 Unit test: checks pass → merge proceeds
- [x] 4.2 Unit test: checks fail → merge skipped, warning logged, PR left open
- [x] 4.3 Unit test: checks timeout (exit code 8) → same as failure
- [x] 4.4 Unit test: no checks configured → merge proceeds immediately
- [x] 4.5 Unit test: `gh pr checks` command fails (network error) → non-fatal, warning logged

## 5. Spec Update

- [x] 5.1 Sync delta spec to `openspec/specs/git-workflow/spec.md` after implementation is verified
