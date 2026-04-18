## Context

The orchestrator's quality pipeline catches test failures and build failures but has no mechanism for detecting code quality issues like debug artifacts left by agents. The existing `automated-convention-check` runs grep patterns for framework compliance (e.g., correct import patterns), but doesn't check for development-time artifacts that should never ship.

Examples of debug artifacts that slip through:
- `console.log('[useDataFetch] Loading state:', state)` left in production code
- `<Text style={{ color: 'red' }}>DEBUG: Status: {status}</Text>` shipped in UI
- `.bak` files generated during fixes
- All passed tests and builds but degraded the shipped product

## Goals / Non-Goals

**Goals:**
- Catch debug artifacts before they reach the user
- Project-type-aware default rules (different checks for web vs mobile vs Node)
- Lightweight enough to run at review time (pre-merge) and phase gate (post-phase)
- Configurable — projects can add/remove/customize rules

**Non-Goals:**
- Replacing ESLint/SwiftLint (those catch syntax/style; this catches debug artifacts)
- Blocking merges on lint failures (advisory in review context, warning in phase gate)
- Catching all possible code quality issues (focused specifically on debug/development artifacts)

## Decisions

### 1. New `lint-checker.js` module with grep-based pattern matching

**Decision:** Create a `lint-checker.js` that takes a project directory, list of changed files, and rule configuration, then runs regex patterns against file contents. Returns violations grouped by rule.

```js
async function runLintCheck(projectDir, changedFiles, config) → {
  passed: boolean,
  violations: [{ rule: string, file: string, line: number, match: string }]
}
```

**Rationale:** Grep-based checking is fast (< 1s for typical changesets), has no dependencies, and is easy to extend with new patterns. More complex analysis (AST-based) isn't needed for the target patterns.

### 2. Default rules by project type

**Decision:** Use `detectProjectType` from `health-checker.js` (shared with `post-merge-build-gate` and `native-build-validation`) to select default rules.

**Universal rules** (all project types):
| Rule | Pattern | File Filter | Description |
|------|---------|-------------|-------------|
| `no-debugger` | `\bdebugger\b` | `*.{js,ts,jsx,tsx}` | Debugger statements |
| `no-bak-files` | N/A (file existence) | `*.bak` | Backup files in tracked dirs |
| `no-todo-hack` | `//\s*(TODO\|HACK\|FIXME)` | `*.{js,ts,jsx,tsx,swift,kt}` | Development markers |

**JS/TS rules** (web, react-native, node):
| Rule | Pattern | File Filter | Description |
|------|---------|-------------|-------------|
| `no-console-log` | `console\.log\(` | `*.{js,ts,jsx,tsx}` excluding `*.test.*`, `*.spec.*` | Debug logging in production |
| `no-debug-ui` | `DEBUG:?\s` | `*.{jsx,tsx}` | Debug text in UI components |

**Swift rules** (react-native with iOS):
| Rule | Pattern | File Filter | Description |
|------|---------|-------------|-------------|
| `no-swift-print` | `\bprint\(` | `*.swift` excluding `*Test*` | Debug print in production Swift |

**Kotlin/Android rules** (react-native with Android):
| Rule | Pattern | File Filter | Description |
|------|---------|-------------|-------------|
| `no-android-log` | `Log\.[devi]\(` | `*.kt`, `*.java` excluding `*Test*` | Debug logging in production Android |

**Alternative:** Single rule set for all projects. Rejected — would produce false positives (Swift `print()` checks on web projects) or miss platform-specific patterns.

### 3. Integration: advisory at review, warning at phase gate

**Decision:** Lint check runs at two points:
1. **Morgan's review pass** (pre-merge): Violations are included in the review context as advisory findings. Morgan can flag them in REQUEST_CHANGES but isn't forced to.
2. **Phase gate** (post-phase): Violations are logged as warnings. Phase gate doesn't fail on lint alone — build and test failures are still the blocking criteria.

**Rationale:** Making lint failures blocking would be too aggressive — agents sometimes legitimately use `console.log` during development and remove it later. Advisory at review + warning at gate gives visibility without blocking the pipeline.

### 4. Scope to changed files only

**Decision:** Lint checks only run against files changed since the last known-good state (merge base for review, phase start for gate). Not the entire codebase.

**Rationale:** Existing code may have legitimate `console.log` usage (logging utilities, error handlers). Only checking changed files avoids false positives from existing code and keeps checks fast.

### 5. Configurable rules via `healthCheck.lintRules`

**Decision:** Projects can customize rules in their config:
```json
{
  "healthCheck": {
    "lintRules": {
      "disable": ["no-todo-hack"],
      "custom": [
        { "id": "no-fixme", "pattern": "FIXME", "glob": "*.ts", "message": "FIXME found" }
      ]
    }
  }
}
```

## Risks / Trade-offs

- **[Risk] False positives on legitimate console.log** → Logging utilities, error handlers, test helpers all use `console.log`. Mitigation: exclude test files, scope to changed files only, advisory (not blocking).
- **[Risk] Incomplete rule coverage** → New debug patterns emerge (e.g., `alert()`, `dump()`, custom debug macros). Mitigation: rules are configurable and easy to extend.
- **[Trade-off] Advisory vs blocking** → Advisory means some violations may slip through. Acceptable because the goal is catching the obvious cases (debug text in UI, console.log spam), not zero-defect enforcement.
