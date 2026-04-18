## Context

The orchestrator's quality pipeline has three validation checkpoints: health check (session start), post-merge smoke test (after each merge), and phase gate (end of phase). The post-merge smoke test in `health-gate.js:runPostMergeSmokeTest` currently filters to test-only commands:

```js
const detected = await healthChecker.detectHealthCheckCommands(projectDir);
const testCommands = detected.filter(c => !c.includes('build'));
```

This means build-breaking changes aren't caught until the phase gate — potentially hours later with multiple agents having stacked more changes on top. Meanwhile, `detectHealthCheckCommands` only reads `package.json` scripts, with no awareness of native builds.

## Goals / Non-Goals

**Goals:**
- Run full build validation (JS + native) after each merge to catch regressions immediately
- Share project-type detection logic with `native-build-validation` change
- Keep post-merge validation fast enough that it doesn't bottleneck the pipeline
- Allow projects to opt out of post-merge builds for performance

**Non-Goals:**
- Replacing the phase gate (it still serves as a cross-group integration check)
- Running tests twice (post-merge already runs tests; just adding builds)
- Implementing native build commands (that's `native-build-validation`'s scope — this change extends the *gate* that uses them)

## Decisions

### 1. Shared `detectProjectType` helper in `health-checker.js`

**Decision:** Add a `detectProjectType(projectDir)` function that returns `{ type: 'web' | 'react-native' | 'node', platforms: { ios: boolean, android: boolean } }` based on filesystem markers.

Detection logic:
- `ios/Podfile` exists → `platforms.ios = true`
- `android/build.gradle` exists → `platforms.android = true`
- Both `ios/` and `android/` → `type = 'react-native'`
- `package.json` with no native dirs → check for framework indicators (next.config, vite.config) → `type = 'web'` or `type = 'node'`

This is the shared infrastructure that `native-build-validation`, `post-merge-build-gate`, and `code-quality-lint-gate` all use. Each change adds its own logic on top of the detection result.

**Alternative:** Each change does its own detection. Rejected — DRY principle, and detection should be consistent across all quality gates.

### 2. Remove the build filter from `runPostMergeSmokeTest`

**Decision:** Change `runPostMergeSmokeTest` to run all detected commands (tests + builds) instead of filtering out build commands. Use a separate timeout for build vs test commands.

```js
// Before:
const testCommands = detected.filter(c => !c.includes('build'));

// After:
const allCommands = detected; // tests + builds, including native if detected
```

**Rationale:** The original filter was a performance optimization — builds were considered too slow for post-merge. With project-type-aware detection and configurable opt-out, projects that want fast merges can disable post-merge builds, while projects that need build validation (like mobile apps) get it automatically.

### 3. Per-command timeout based on command type

**Decision:** Assign timeouts per command rather than a single timeout for all:
- JS commands (`npm test`, `npm run build`): 120s
- Native build commands (`xcodebuild`, `gradlew`): 300s

Implemented by extending `detectHealthCheckCommands` to return `{ command, timeoutMs }` objects instead of plain strings. The `runHealthCheck` function accepts either format for backward compatibility.

**Alternative:** Single global timeout. Rejected — a 300s timeout for `npm test` is wasteful, and a 120s timeout for `xcodebuild` would cause false failures.

### 4. Opt-out via `healthCheck.postMergeBuild`

**Decision:** Projects can set `healthCheck.postMergeBuild: false` in their config to skip build commands in post-merge context (tests still run). Default is `true`.

This is useful for projects where native builds take 3-5 minutes and agents are producing frequent merges. The phase gate still catches build failures at end-of-phase.

## Risks / Trade-offs

- **[Risk] Native builds slow down merge pipeline** → 3-5 min per merge for iOS builds. Mitigation: opt-out flag, cached builds are faster after first run, and catching a regression immediately saves more time than the build costs.
- **[Risk] Backward compatibility with plain string commands** → `detectHealthCheckCommands` currently returns `string[]`. Changing to `{ command, timeoutMs }[]` could break callers. Mitigation: `runHealthCheck` accepts both formats; existing tests continue to pass.
- **[Trade-off] Post-merge vs phase gate redundancy** → Build now runs at both checkpoints. Acceptable because post-merge catches single-agent regressions while phase gate catches cross-agent integration issues.
