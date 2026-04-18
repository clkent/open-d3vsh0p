# DevShop Platform Conventions

## Test Framework
- Use `node:test` (describe, it, beforeEach, afterEach, mock) as the sole test runner
- Use `node:assert/strict` as the sole assertion library
- No external test frameworks (Jest, Mocha, Vitest, Chai, Sinon)
- Test files: `<module>.test.js` co-located with source files

## Dependencies
- Zero external npm dependencies for production code
- All functionality uses Node.js standard library only
- `package.json` dependencies field must remain empty

## Module Format
- CommonJS (`require` / `module.exports`) — no ES modules
- One class or concern per file
- `module.exports` at the bottom of the file

## File Naming
- kebab-case for filenames: `consumption-monitor.js`, `git-ops.js`
- PascalCase for class names: `ConsumptionMonitor`, `GitOps`
- camelCase for variables and functions: `sessionId`, `parseRoadmap`
- UPPER_SNAKE_CASE for constants: `MAX_RETRIES`, `DEFAULT_BUDGET_USD`

## Git Workflow
- Never push directly to main
- Feature branches: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`
- All changes via pull requests
- Pre-commit hook runs tests on orchestrator changes
- Pre-push hook blocks direct pushes to main

## Error Handling
- Throw descriptive errors with context (file path, project ID)
- No silent catches — always log, rethrow, or handle meaningfully
- Agent-facing errors must be logged before propagating
