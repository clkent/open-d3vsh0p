## MODIFIED Requirements

### Health Check Command Configuration
The health check commands SHALL be configurable per-project via the project configuration (`.devshop.json` or project registry entry) under a `healthCheck` field.

The configuration SHALL support:
- `commands`: An array of shell command strings to execute (e.g., `["npm test", "npm run build"]`)
- `timeoutMs`: Per-command timeout in milliseconds (default: 120000)
- `nativeBuild`: Boolean to enable/disable native build auto-detection (default: true)
- `nativeBuildTimeoutMs`: Per-command timeout for native build commands in milliseconds (default: 300000)
- `ios.workspace`: Override auto-detected iOS workspace filename
- `ios.scheme`: Override auto-detected iOS scheme name
- `android.command`: Override default Android build command

If no `healthCheck` configuration is provided, the orchestrator SHALL attempt auto-detection by reading the project's `package.json` (if present):
- If a `test` script exists, include `npm test`
- If a `build` script exists, include `npm run build`

Additionally, if `nativeBuild` is not explicitly set to `false`, the orchestrator SHALL auto-detect native projects:
- If `ios/Podfile` exists, include iOS build validation commands
- If `android/build.gradle` or `android/build.gradle.kts` exists, include Android build validation commands

If no `package.json` exists or it contains no `test` or `build` scripts, no native project markers are found, and no explicit configuration is provided, the orchestrator SHALL skip the health check and proceed normally.

#### Scenario: Explicit health check configuration
- **WHEN** the project config contains `healthCheck.commands: ["pytest", "mypy src/"]`
- **THEN** the orchestrator SHALL execute `pytest` and `mypy src/` as health check commands, ignoring any `package.json` auto-detection

#### Scenario: Auto-detection from package.json
- **WHEN** no `healthCheck` config exists and the project's `package.json` has `scripts.test: "jest"` and `scripts.build: "next build"`
- **THEN** the orchestrator SHALL use `["npm test", "npm run build"]` as health check commands

#### Scenario: Auto-detection with test only
- **WHEN** no `healthCheck` config exists and the project's `package.json` has `scripts.test: "jest"` but no `scripts.build`
- **THEN** the orchestrator SHALL use `["npm test"]` as the sole health check command

#### Scenario: Auto-detection with React Native iOS project
- **WHEN** no `healthCheck` config exists and the project has `package.json` with `scripts.test` and an `ios/Podfile`
- **THEN** the orchestrator SHALL use `["npm test"]` plus iOS native build validation commands

#### Scenario: No configuration and no package.json
- **WHEN** no `healthCheck` config exists and no `package.json` is found in the project directory
- **THEN** the orchestrator SHALL skip the health check entirely and proceed to phase execution

#### Scenario: Custom timeout
- **WHEN** the project config contains `healthCheck.timeoutMs: 300000`
- **THEN** each health check command SHALL be allowed up to 300 seconds before being killed

#### Scenario: Native build disabled via config
- **WHEN** the project config contains `healthCheck.nativeBuild: false` and the project has an `ios/Podfile`
- **THEN** the orchestrator SHALL NOT include iOS build validation commands in auto-detection
