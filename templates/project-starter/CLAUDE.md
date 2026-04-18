# {{PROJECT_NAME}} — Claude Code Instructions

## Git Workflow

**Never push directly to main.** All changes must go through feature branches and pull requests.

1. Create a feature branch: `git checkout -b <type>/<description>`
2. Make commits on the feature branch
3. Push the branch: `git push -u origin <branch-name>`
4. Create a PR: `gh pr create --title "..." --body "..."`

Branch types: feat, fix, chore, docs, refactor, test

## Testing

Run tests before committing: `npm test`

## Project Standards

Read `openspec/conventions.md` for the full project conventions — test framework, styling, imports, project structure, and patterns.

## Gotchas

See `openspec/gotchas.md` (if it exists) for known pitfalls and surprising patterns in this project.

## Project Specs

See `openspec/` for project specifications, roadmap, and change proposals.
