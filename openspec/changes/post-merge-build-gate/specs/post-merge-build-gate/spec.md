## ADDED Requirements

### Requirement: Post-merge build validation
After each successful merge, the orchestrator SHALL run all detected build commands (not just tests) against the session branch to catch build regressions immediately.

#### Scenario: JS project post-merge runs npm run build
- **WHEN** a merge completes on a project with `build` script in `package.json`
- **THEN** `runPostMergeSmokeTest` SHALL run both `npm test` and `npm run build`

#### Scenario: React Native project post-merge runs native build
- **WHEN** a merge completes on a project with `ios/Podfile` detected
- **THEN** `runPostMergeSmokeTest` SHALL run `npm test`, `npm run build`, and the iOS build command with 300s timeout

#### Scenario: Post-merge build failure triggers diagnostic fix
- **WHEN** a post-merge build command fails
- **THEN** the orchestrator SHALL attempt a Morgan diagnostic fix, same as it does for test failures

### Requirement: Per-command timeout in post-merge context
The post-merge smoke test SHALL use per-command timeouts based on command type rather than a single global timeout.

#### Scenario: JS commands use standard timeout
- **WHEN** `npm test` or `npm run build` runs in post-merge context
- **THEN** the timeout SHALL be 120s

#### Scenario: Native build commands use extended timeout
- **WHEN** `xcodebuild` or `gradlew` commands run in post-merge context
- **THEN** the timeout SHALL be 300s

### Requirement: Post-merge build opt-out
Projects SHALL be able to disable post-merge build validation via configuration while still running tests.

#### Scenario: Opt-out skips build commands
- **WHEN** project config has `healthCheck.postMergeBuild: false`
- **THEN** `runPostMergeSmokeTest` SHALL run only test commands, filtering out build commands

#### Scenario: Default includes builds
- **WHEN** project config has no `healthCheck.postMergeBuild` setting
- **THEN** `runPostMergeSmokeTest` SHALL run both test and build commands (default `true`)
