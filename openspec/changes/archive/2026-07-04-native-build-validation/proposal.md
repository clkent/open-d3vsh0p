## Why

DevShop's health check auto-detection only looks at `package.json` for `npm test` and `npm run build`. For React Native projects, agents can introduce iOS/Android dependency mismatches (wrong library versions, broken Podfile config, bundle ID conflicts) that pass JS-level checks but fail native builds. These failures are only discovered when the human tries to build in Xcode or Android Studio — often after multiple phases of agent work have compounded the problem.

## What Changes

- **Native build auto-detection in health checker**: When `detectHealthCheckCommands` finds an `ios/` directory with a `Podfile`, it adds `pod install` and `xcodebuild` verification commands. When it finds `android/` with `build.gradle`, it adds a Gradle build check.
- **iOS build validation command**: A `pod install --dry-run` or lightweight `xcodebuild build` targeting the simulator SDK to verify the native project compiles
- **Android build validation command**: A `./gradlew assembleDebug` check to verify the Android build compiles
- **Configurable native validation**: Projects can opt out of native build checks or customize the build commands via `healthCheck.nativeBuild` config

## Capabilities

### New Capabilities
- `native-build-validation`: Auto-detection and execution of native iOS/Android build validation as part of the project health check

### Modified Capabilities
- `project-health-check`: Extended auto-detection to include native build commands for React Native projects

## Impact

- `platform/orchestrator/src/quality/health-checker.js` — extended `detectHealthCheckCommands` with native project detection
- `platform/orchestrator/src/quality/health-checker.test.js` — new test cases for native detection
- `platform/orchestrator/config/defaults.json` — native build default timeout (longer than JS tests)
- React Native projects will now fail health check early if native builds are broken, triggering Morgan repair or pair-mode before agents start writing code into a broken foundation
