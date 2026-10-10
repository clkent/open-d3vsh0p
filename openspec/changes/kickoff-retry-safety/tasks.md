## 1. Scope preflight

- [x] 1.1 In `_verifyGhCli()`, capture stdout+stderr of `gh auth status`, parse the `Token scopes:` line into a set
- [x] 1.2 Check `TEMPLATES_DIR/.github/workflows` for files; if present and `workflow` scope missing, throw the actionable error
- [x] 1.3 If no scopes line is parseable, `logger.log('warn', 'kickoff_scopes_unknown', ...)` and continue

## 2. Idempotent commit and push error mapping

- [x] 2.1 Before `git commit`, run `git status --porcelain`; on empty output log `kickoff_nothing_to_commit` and skip the commit
- [x] 2.2 Wrap the push fallback chain; map stderr matching `/workflow.*scope|refusing to allow an OAuth App/i` to the actionable error, rethrow others unchanged

## 3. Tests

- [x] 3.1 `project-scaffolder.test.js`: scope preflight fails fast with the remedy and makes no `gh repo create` call
- [x] 3.2 Scope preflight passes when `workflow` present; warns and continues when scopes line absent
- [x] 3.3 Clean tree at commit step skips `git commit` and still pushes and registers
- [x] 3.4 Push rejection mentioning workflow scope surfaces the remedy

## 4. Docs

- [x] 4.1 README prerequisites: `gh` token needs `repo` and `workflow` scopes, with the refresh command
- [ ] 4.2 Sync `openspec/specs/project-kickoff/spec.md` on archive (roadmap item marked complete)
