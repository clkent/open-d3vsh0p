## Why

Post-merge smoke tests currently only run `npm test`, explicitly filtering out build commands. This means an agent can introduce changes that break the build (native or JS) and the regression isn't caught until the end-of-phase gate — by which time other agents may have piled more changes on top of the broken foundation. Running the full build after each merge catches regressions immediately, when they're cheapest to fix.

## What Changes

- **Extend post-merge smoke test to include build commands**: `runPostMergeSmokeTest` in `health-gate.js` currently filters to test-only commands (`detected.filter(c => !c.includes('build'))`). Change this to run all detected commands (tests + builds), using project-type-aware detection from the shared `detectHealthCheckCommands`.
- **Project-type-aware command detection**: Extend `detectHealthCheckCommands` in `health-checker.js` to detect project type (web, React Native/iOS, React Native/Android, pure Node) and return appropriate build commands for each. This is shared infrastructure that `native-build-validation` also uses — both changes extend the same detection function.
- **Configurable post-merge build gate**: Allow projects to opt out of post-merge builds via `healthCheck.postMergeBuild: false` in project config, since native builds are slower (~3-5 min) and may not be worth running after every single merge.
- **Timeout awareness**: Use longer timeouts for native build commands (300s) vs JS commands (120s) in post-merge context.

## Capabilities

### New Capabilities

- `post-merge-build-gate`: Full build validation (JS + native) after each merge, catching build regressions immediately rather than at end-of-phase

### Modified Capabilities

- `integration-quality-gates`: Post-merge smoke test expanded from test-only to test+build, with project-type-aware command selection
- `project-health-check`: Shared `detectHealthCheckCommands` extended with project-type detection (web vs mobile vs hybrid)

## Impact

- `platform/orchestrator/src/quality/health-checker.js` — extend `detectHealthCheckCommands` with project-type detection, add `detectProjectType` helper
- `platform/orchestrator/src/quality/health-gate.js` — modify `runPostMergeSmokeTest` to include build commands
- `platform/orchestrator/src/quality/health-checker.test.js` — new test cases for project-type detection and post-merge build inclusion
- All projects benefit from smarter command detection; React Native projects gain native build validation at merge time
