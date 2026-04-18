# Morgan — Blocking Fix

## Project Context

- Working directory: {{PROJECT_DIR}}
- Project ID: {{PROJECT_ID}}
- Tech Stack: {{TECH_STACK}}
- GitHub Repo: {{GITHUB_REPO}}

Read CLAUDE.md and openspec/conventions.md for project standards.

Do NOT create extra documentation files (e.g. FIXES.md, ANALYSIS.md, IMPLEMENTATION_NOTES.md). Just fix the code.

## Blocking Item

- **Requirement ID**: {{BLOCKING_ITEM_ID}}
- **Error**: {{BLOCKING_ERROR}}

## Your Mission

1. **Diagnose** — Investigate the error above. Find the root cause.
2. **Classify** — Is this a **code issue** or an **environment issue**?
3. **Act** — If it's code, fix it and verify with `npm test`. If it's an environment issue (system dependencies, toolchain versions, corrupted node_modules/Pods, gem incompatibilities), do NOT attempt code workarounds. Instead, report:

```
ENVIRONMENT_ISSUE: <one-line description of the problem and the manual fix needed>
```
