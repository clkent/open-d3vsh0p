## ADDED Requirements

### Requirement: iOS build validation
The health checker SHALL validate that iOS native builds compile successfully for React Native projects.

#### Scenario: iOS project detected
- **WHEN** `detectHealthCheckCommands` finds an `ios/Podfile` in the project directory
- **THEN** it SHALL add iOS native build validation commands to the health check command list

#### Scenario: Pod install before build
- **WHEN** `ios/Podfile` exists but `ios/Pods/` directory is missing or `ios/Podfile.lock` is absent
- **THEN** the health checker SHALL run `bundle exec pod install` (or `pod install` if no Gemfile exists) in the `ios/` directory before the xcodebuild command

#### Scenario: iOS build command
- **WHEN** iOS validation runs
- **THEN** the health checker SHALL execute `xcodebuild -workspace <detected-workspace> -scheme <detected-scheme> -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO` in the `ios/` directory

#### Scenario: Workspace and scheme auto-detection
- **WHEN** the health checker looks for an iOS workspace
- **THEN** it SHALL find the first `.xcworkspace` file in `ios/` and derive the scheme name by stripping the `.xcworkspace` extension (e.g., `MyApp.xcworkspace` → scheme `MyApp`)

#### Scenario: Xcode not available
- **WHEN** `xcodebuild` is not found in PATH or `xcode-select -p` points to Command Line Tools only
- **THEN** the health checker SHALL skip iOS validation with a warning log and NOT treat it as a health check failure

#### Scenario: CocoaPods not available
- **WHEN** `pod` (or `bundle exec pod`) is not available
- **THEN** the health checker SHALL skip the pod install step with a warning log and attempt the xcodebuild anyway

### Requirement: Android build validation
The health checker SHALL validate that Android native builds compile successfully for React Native projects.

#### Scenario: Android project detected
- **WHEN** `detectHealthCheckCommands` finds an `android/build.gradle` or `android/build.gradle.kts` in the project directory
- **THEN** it SHALL add Android native build validation commands to the health check command list

#### Scenario: Android build command
- **WHEN** Android validation runs
- **THEN** the health checker SHALL execute `./gradlew assembleDebug --no-daemon` in the `android/` directory

#### Scenario: Android SDK not available
- **WHEN** `ANDROID_HOME` environment variable is not set and the Android SDK cannot be found at default locations
- **THEN** the health checker SHALL skip Android validation with a warning log and NOT treat it as a health check failure

### Requirement: Native build timeout
Native build commands SHALL use a longer timeout than JS commands to accommodate compilation time.

#### Scenario: Default native build timeout
- **WHEN** no custom timeout is configured for native builds
- **THEN** native build commands SHALL use a 300-second (5 minute) timeout

#### Scenario: Custom native build timeout
- **WHEN** the project config contains `healthCheck.nativeBuildTimeoutMs: 600000`
- **THEN** native build commands SHALL use the configured 600-second timeout

### Requirement: Native build opt-out
Projects SHALL be able to disable native build validation via configuration.

#### Scenario: Native build disabled
- **WHEN** the project config contains `healthCheck.nativeBuild: false`
- **THEN** the health checker SHALL skip all native build detection and validation

#### Scenario: Native build enabled by default
- **WHEN** the project config does not contain a `healthCheck.nativeBuild` setting
- **THEN** native build validation SHALL be enabled by default (auto-detected if iOS/Android directories exist)

### Requirement: Native build configuration overrides
Projects SHALL be able to override auto-detected native build settings.

#### Scenario: Custom iOS workspace and scheme
- **WHEN** the project config contains `healthCheck.ios.workspace: "Custom.xcworkspace"` and `healthCheck.ios.scheme: "CustomScheme"`
- **THEN** the health checker SHALL use those values instead of auto-detecting from the `ios/` directory

#### Scenario: Custom Android build command
- **WHEN** the project config contains `healthCheck.android.command: "./gradlew assembleRelease"`
- **THEN** the health checker SHALL use that command instead of the default `./gradlew assembleDebug --no-daemon`
