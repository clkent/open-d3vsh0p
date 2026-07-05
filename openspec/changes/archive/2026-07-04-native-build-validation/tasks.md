## 1. Native Project Detection

- [x] 1.1 Add `detectIOSProject(projectDir)` helper that checks for `ios/Podfile`, finds the `.xcworkspace` file, and derives the scheme name
- [x] 1.2 Add `detectAndroidProject(projectDir)` helper that checks for `android/build.gradle` or `android/build.gradle.kts`
- [x] 1.3 Add `checkToolAvailability()` helper that verifies `xcodebuild`, `pod`/`bundle`, and `ANDROID_HOME` are available, returning which tools are present

## 2. Health Checker Extension

- [x] 2.1 Extend `detectHealthCheckCommands` to call native detection helpers and append native build commands when iOS/Android directories are found
- [x] 2.2 Add `nativeBuild`, `nativeBuildTimeoutMs`, `ios.workspace`, `ios.scheme`, and `android.command` config support to `resolveHealthCheckConfig`
- [x] 2.3 Add pod install pre-step logic: if `ios/Podfile` exists but `ios/Pods/` is missing, prepend `bundle exec pod install` (or `pod install`) command
- [x] 2.4 Construct the xcodebuild command with auto-detected or configured workspace/scheme, simulator SDK, and `CODE_SIGNING_ALLOWED=NO`
- [x] 2.5 Construct the Gradle command with `--no-daemon` flag or configured override

## 3. Configuration Defaults

- [x] 3.1 Add `nativeBuildTimeoutMs: 300000` to health check defaults in `defaults.json`

## 4. Tests

- [x] 4.1 Test `detectIOSProject`: returns workspace/scheme when `ios/Podfile` and `.xcworkspace` exist, returns null when missing
- [x] 4.2 Test `detectAndroidProject`: returns true when `android/build.gradle` exists, false when missing
- [x] 4.3 Test `detectHealthCheckCommands` includes native commands when iOS/Android dirs exist alongside `package.json`
- [x] 4.4 Test native build opt-out: `healthCheck.nativeBuild: false` skips native detection
- [x] 4.5 Test config overrides: custom workspace, scheme, and android command are used over auto-detected values
- [x] 4.6 Test tool availability: missing `xcodebuild` skips iOS with warning, missing `ANDROID_HOME` skips Android with warning
- [x] 4.7 Test pod install pre-step: added when `Pods/` directory missing, skipped when present

## 5. Roadmap Update

- [x] 5.1 Add native-build-validation to `openspec/roadmap.md` in the appropriate phase
