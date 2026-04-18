## ADDED Requirements

### Requirement: Project type detection
The health checker SHALL detect the project type based on filesystem markers and return a structured result that other quality gates can use.

#### Scenario: React Native iOS project detected
- **WHEN** `ios/Podfile` exists in the project directory
- **THEN** `detectProjectType` SHALL return `{ platforms: { ios: true } }`

#### Scenario: React Native Android project detected
- **WHEN** `android/build.gradle` exists in the project directory
- **THEN** `detectProjectType` SHALL return `{ platforms: { android: true } }`

#### Scenario: React Native dual-platform detected
- **WHEN** both `ios/Podfile` and `android/build.gradle` exist
- **THEN** `detectProjectType` SHALL return `{ type: 'react-native', platforms: { ios: true, android: true } }`

#### Scenario: Web project detected
- **WHEN** `package.json` exists but neither `ios/` nor `android/` directories are present, and a web framework config exists (e.g., `next.config.js`, `vite.config.ts`)
- **THEN** `detectProjectType` SHALL return `{ type: 'web', platforms: { ios: false, android: false } }`

#### Scenario: Node project fallback
- **WHEN** `package.json` exists but no web framework config or native directories are found
- **THEN** `detectProjectType` SHALL return `{ type: 'node', platforms: { ios: false, android: false } }`

### Requirement: Detected commands include type metadata
`detectHealthCheckCommands` SHALL return command objects with timeout metadata alongside the command string.

#### Scenario: Command objects returned
- **WHEN** `detectHealthCheckCommands` detects commands for a project
- **THEN** each entry SHALL include `{ command: string, timeoutMs: number }` where `timeoutMs` is 120000 for JS commands and 300000 for native build commands

#### Scenario: Backward compatibility with string arrays
- **WHEN** `runHealthCheck` receives plain string commands (from existing callers)
- **THEN** it SHALL treat them as commands with the default 120000ms timeout
