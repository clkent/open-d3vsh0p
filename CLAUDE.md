# d3vsh0p — Claude Code Instructions

## Git Workflow

**Never push directly to main.** All changes must go through feature branches and pull requests.

1. Create a feature branch: `git checkout -b <type>/<description>` (types: feat, fix, chore, docs, refactor, test)
2. Make commits on the feature branch
3. Push the branch: `git push -u origin <branch-name>`
4. Create a PR: `gh pr create --title "..." --body "..."`
5. After merge, the feature branch is deleted

If asked to "push to main" or "push it", push the current feature branch and create a PR instead.

## OpenSpec

This project uses OpenSpec for spec-driven development. All changes should follow the OpenSpec workflow:
- Specs live in `openspec/specs/<capability>/spec.md`
- The roadmap is at `openspec/roadmap.md`
- Use `/opsx:new` to start new changes, `/opsx:ff` to fast-forward through artifacts
- Requirements in `openspec/project.md` cover only pending (unimplemented) work

**All platform changes (features, enhancements, behavioral changes) MUST go through the OpenSpec workflow:**
1. Create a change proposal in `openspec/changes/<change-name>/proposal.md`
2. Create or update the relevant spec in `openspec/specs/<capability>/spec.md`
3. Implement the change
4. Mark the change as implemented in `.openspec.yaml`

Skip specs only for trivial changes (typo fixes, config value tweaks, test-only additions). If unsure whether something is trivial enough, ask first.

**Roadmap must stay in sync with specs.** When creating, modifying, or archiving OpenSpec changes:
- Add new capabilities to the appropriate phase/group in `openspec/roadmap.md`
- Mark items complete (`- [x]`) when changes are implemented and archived
- If a new change doesn't fit an existing phase, create a new phase with appropriate dependencies
- Renumber subsequent phases if inserting a new one

## Documentation Maintenance

**Keep docs in sync with every change.** When a PR changes behavior, defaults, CLI flags, or adds/removes features:

1. Update `README.md` — architecture, usage examples, default values
2. Update relevant `openspec/specs/` if the spec was affected
3. Update CLI `--help` text in `platform/orchestrator/src/index.js` if flags or defaults changed

Do not let docs drift. If you change a default value (e.g. budget from $20 to $30), update every place that references the old value: README, CLI help text, specs, and comments.

## Project Structure

- `platform/orchestrator/` — Node.js state machine orchestrator (the brain)
- `templates/agents/` — Agent system prompts and configs
- `active-agents/` — Per-project runtime state
- `project-registry.json` — Index of managed projects
- Projects live in `~/projects/`, not inside this repo
