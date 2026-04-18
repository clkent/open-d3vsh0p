## Context

The health checker (`health-checker.js`) auto-detects commands by reading `package.json` scripts — it finds `npm test` and `npm run build`. For React Native projects, this misses native build validation entirely. Agents can introduce iOS dependency mismatches (wrong library versions for the RN version, broken Podfile, bundle ID conflicts) that pass `npm test` but fail when the human builds in Xcode. By the time the human discovers this, multiple phases of agent work may have compounded the problem.

The health check already supports explicit `healthCheck.commands` in project config, so users *could* manually add `xcodebuild` commands. But auto-detection should handle this for the common case.

## Goals / Non-Goals

**Goals:**
- Auto-detect iOS projects (presence of `ios/Podfile`) and add native build validation to health check
- Auto-detect Android projects (presence of `android/build.gradle`) and add native build validation
- Catch native build failures before agents start writing code
- Keep native build checks fast enough to not significantly delay session start

**Non-Goals:**
- Running the app on a simulator (build verification only)
- Validating runtime behavior (that's what human testing checkpoints are for)
- Supporting non-React-Native native projects (pure Swift/Kotlin) — can be added later
- Auto-fixing native build issues (Morgan repair already handles that)

## Decisions

### 1. Use `xcodebuild build` with simulator SDK for iOS validation
**Decision:** Run `xcodebuild -workspace <workspace> -scheme <scheme> -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO` as the iOS health check command.

**Rationale:** This validates the full native build pipeline (CocoaPods integration, header resolution, Swift/ObjC compilation) without requiring code signing or a device. The simulator SDK is always available. `CODE_SIGNING_ALLOWED=NO` avoids provisioning profile issues in CI/automated contexts.

**Alternatives considered:**
- `pod install --dry-run` only: Too shallow — catches Podfile errors but not compilation failures (like the `react-native-screens` Fabric header issue)
- `xcodebuild build-for-testing`: Overkill, adds test compilation time we don't need

### 2. Use `./gradlew assembleDebug` for Android validation
**Decision:** Run `./gradlew assembleDebug --no-daemon` in the `android/` directory.

**Rationale:** `assembleDebug` is the standard Android build check. `--no-daemon` avoids leaving Gradle daemons running in automated contexts. This catches dependency resolution failures, compilation errors, and manifest issues.

### 3. Run `pod install` before `xcodebuild` if Podfile.lock is missing
**Decision:** If `ios/Podfile` exists but `ios/Pods/` directory is missing or `ios/Podfile.lock` is absent, run `bundle exec pod install` (or `pod install` if no Gemfile) before attempting the xcodebuild check.

**Rationale:** A fresh clone or post-`pod install` cleanup will have no Pods directory. The xcodebuild will always fail without pods installed. Auto-running pod install makes the health check self-sufficient.

### 4. Detect workspace and scheme from project structure
**Decision:** Auto-detect the `.xcworkspace` file in `ios/` and derive the scheme name from the workspace name (strip `.xcworkspace` extension). Allow override via `healthCheck.ios.workspace` and `healthCheck.ios.scheme`.

**Rationale:** React Native projects consistently name their workspace after the project. Auto-detection handles the common case; config overrides handle edge cases.

### 5. Longer timeout for native builds
**Decision:** Use 300s (5 min) timeout for native build commands vs the default 120s for JS commands.

**Rationale:** First-time native builds (especially iOS with CocoaPods) can take 3-5 minutes. Subsequent cached builds are faster, but the health check may hit a cold build.

## Risks / Trade-offs

- **[Risk] Native builds are slow** → First iOS build can take 3-5 min. Mitigation: only run on fresh sessions (already the case for health checks), cached builds are fast. Users can set `healthCheck.nativeBuild: false` to skip.
- **[Risk] Xcode CLI tools vs full Xcode** → `xcodebuild` requires full Xcode, not just Command Line Tools. Mitigation: detect this and skip with a warning rather than failing.
- **[Risk] CocoaPods not installed** → If Ruby/CocoaPods aren't set up, `pod install` fails. Mitigation: skip iOS validation with a warning if `pod`/`bundle` commands aren't available.
- **[Risk] Android SDK not installed** → `./gradlew` needs Android SDK. Mitigation: skip Android validation with a warning if `ANDROID_HOME` is not set.
