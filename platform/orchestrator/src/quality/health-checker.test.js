const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const {
  runHealthCheck,
  detectHealthCheckCommands,
  resolveHealthCheckConfig,
  detectIOSProject,
  detectAndroidProject,
  checkToolAvailability,
  _validateCommand,
  DEFAULT_NATIVE_BUILD_TIMEOUT_MS
} = require('./health-checker');

describe('runHealthCheck', () => {
  it('returns passed:true with empty results when no commands', async () => {
    const result = await runHealthCheck('/tmp', { commands: [] });
    assert.equal(result.passed, true);
    assert.deepEqual(result.results, []);
  });

  it('returns passed:true when all commands succeed', async () => {
    const result = await runHealthCheck('/tmp', { commands: ['echo hello', 'echo world'] });
    assert.equal(result.passed, true);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].exitCode, 0);
    assert.ok(result.results[0].stdout.includes('hello'));
    assert.equal(result.results[1].exitCode, 0);
  });

  it('returns passed:false when one command fails', async () => {
    const result = await runHealthCheck('/tmp', {
      commands: ['echo ok', 'false']
    });
    assert.equal(result.passed, false);
    assert.equal(result.results[0].exitCode, 0);
    assert.notEqual(result.results[1].exitCode, 0);
  });

  it('captures stdout and stderr', async () => {
    const result = await runHealthCheck('/tmp', {
      commands: ['echo stdout-output']
    });
    assert.ok(result.results[0].stdout.includes('stdout-output'));
    assert.equal(typeof result.results[0].stderr, 'string');
  });

  it('handles command timeout', async () => {
    const result = await runHealthCheck('/tmp', {
      commands: ['sleep 10'],
      timeoutMs: 500
    });
    assert.equal(result.passed, false);
    assert.equal(result.results[0].exitCode, 124); // timeout convention
  });

  it('runs commands sequentially and reports all results', async () => {
    const result = await runHealthCheck('/tmp', {
      commands: ['echo first', 'false', 'echo third']
    });
    assert.equal(result.results.length, 3);
    assert.equal(result.results[0].exitCode, 0);
    assert.notEqual(result.results[1].exitCode, 0);
    assert.equal(result.results[2].exitCode, 0);
    assert.equal(result.passed, false);
  });

  it('supports command objects with per-command timeout', async () => {
    const result = await runHealthCheck('/tmp', {
      commands: [
        { command: 'echo fast', timeoutMs: 5000 },
        'echo plain'
      ]
    });
    assert.equal(result.passed, true);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].command, 'echo fast');
    assert.equal(result.results[1].command, 'echo plain');
  });

  it('uses per-command timeout for command objects', async () => {
    const result = await runHealthCheck('/tmp', {
      commands: [
        { command: 'sleep 10', timeoutMs: 500 }
      ],
      timeoutMs: 60000 // default is long, but per-command should win
    });
    assert.equal(result.passed, false);
    assert.equal(result.results[0].exitCode, 124);
  });
});

describe('detectIOSProject', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-ios-'));
  });

  it('returns workspace and scheme when ios/Podfile and .xcworkspace exist', async () => {
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'MyApp.xcworkspace'));

    const result = await detectIOSProject(tmpDir);
    assert.deepEqual(result, { workspace: 'MyApp.xcworkspace', scheme: 'MyApp' });
  });

  it('returns null when no ios directory exists', async () => {
    const result = await detectIOSProject(tmpDir);
    assert.equal(result, null);
  });

  it('returns null when ios exists but no Podfile', async () => {
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.mkdir(path.join(iosDir, 'SomeProject.xcworkspace'));

    const result = await detectIOSProject(tmpDir);
    assert.equal(result, null);
  });

  it('returns null when Podfile exists but no .xcworkspace', async () => {
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');

    const result = await detectIOSProject(tmpDir);
    assert.equal(result, null);
  });
});

describe('detectAndroidProject', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-android-'));
  });

  it('returns true when android/build.gradle exists', async () => {
    const androidDir = path.join(tmpDir, 'android');
    await fs.mkdir(androidDir);
    await fs.writeFile(path.join(androidDir, 'build.gradle'), 'apply plugin');

    const result = await detectAndroidProject(tmpDir);
    assert.equal(result, true);
  });

  it('returns true when android/build.gradle.kts exists', async () => {
    const androidDir = path.join(tmpDir, 'android');
    await fs.mkdir(androidDir);
    await fs.writeFile(path.join(androidDir, 'build.gradle.kts'), 'plugins {}');

    const result = await detectAndroidProject(tmpDir);
    assert.equal(result, true);
  });

  it('returns false when no android directory exists', async () => {
    const result = await detectAndroidProject(tmpDir);
    assert.equal(result, false);
  });

  it('returns false when android exists but no build.gradle', async () => {
    const androidDir = path.join(tmpDir, 'android');
    await fs.mkdir(androidDir);
    await fs.writeFile(path.join(androidDir, 'settings.gradle'), '');

    const result = await detectAndroidProject(tmpDir);
    assert.equal(result, false);
  });
});

describe('detectHealthCheckCommands — native detection', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-native-'));
  });

  it('includes JS commands alongside native when iOS dir exists', async () => {
    // Create package.json
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } })
    );
    // Create iOS project
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'TestApp.xcworkspace'));

    const commands = await detectHealthCheckCommands(tmpDir);

    // First command should be npm test
    assert.equal(commands[0], 'npm test');

    // Find the xcodebuild command
    const xcodeCmd = commands.find(c => {
      const cmd = typeof c === 'string' ? c : c.command;
      return cmd.includes('xcodebuild');
    });

    if (xcodeCmd) {
      // On machines with xcodebuild: native commands are added
      assert.ok(commands.length > 1, 'Should have native commands when xcodebuild available');
      const cmdStr = typeof xcodeCmd === 'string' ? xcodeCmd : xcodeCmd.command;
      assert.ok(cmdStr.includes('TestApp.xcworkspace'));
      assert.ok(cmdStr.includes('-scheme "TestApp"'));
      assert.ok(cmdStr.includes('-sdk iphonesimulator'));
      assert.ok(cmdStr.includes('CODE_SIGNING_ALLOWED=NO'));
    } else {
      // On CI/Linux without xcodebuild: only JS commands returned
      assert.equal(commands.length, 1, 'Only npm test when xcodebuild unavailable');
    }
  });

  it('skips native detection when nativeBuild is false', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } })
    );
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'TestApp.xcworkspace'));

    const commands = await detectHealthCheckCommands(tmpDir, { nativeBuild: false });
    assert.deepEqual(commands, ['npm test']);
  });

  it('uses config overrides for iOS workspace and scheme', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } })
    );
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'AutoDetected.xcworkspace'));
    // Pre-create Pods dir so pod install is skipped
    await fs.mkdir(path.join(iosDir, 'Pods'));

    const commands = await detectHealthCheckCommands(tmpDir, {
      ios: { workspace: 'Custom.xcworkspace', scheme: 'CustomScheme' }
    });

    const xcodeCmd = commands.find(c => {
      const cmd = typeof c === 'string' ? c : c.command;
      return cmd.includes('xcodebuild');
    });

    if (xcodeCmd) {
      const cmdStr = typeof xcodeCmd === 'string' ? xcodeCmd : xcodeCmd.command;
      assert.ok(cmdStr.includes('Custom.xcworkspace'), 'Should use custom workspace');
      assert.ok(cmdStr.includes('-scheme "CustomScheme"'), 'Should use custom scheme');
    }
  });

  it('adds pod install when Pods/ directory is missing', async () => {
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'TestApp.xcworkspace'));
    // Note: NOT creating Pods/ directory

    const commands = await detectHealthCheckCommands(tmpDir);

    // Check if a pod install command was added (depends on tool availability)
    const podCmd = commands.find(c => {
      const cmd = typeof c === 'string' ? c : c.command;
      return cmd.includes('pod install');
    });

    // On a Mac with CocoaPods installed, this should be present
    // On CI without CocoaPods, it's skipped with a warning
    if (podCmd) {
      const cmdStr = typeof podCmd === 'string' ? podCmd : podCmd.command;
      assert.ok(cmdStr.includes('pod install'));
      assert.ok(typeof podCmd === 'object' && podCmd.timeoutMs === DEFAULT_NATIVE_BUILD_TIMEOUT_MS);
    }
  });

  it('skips pod install when Pods/ directory exists', async () => {
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'TestApp.xcworkspace'));
    await fs.mkdir(path.join(iosDir, 'Pods'));

    const commands = await detectHealthCheckCommands(tmpDir);

    const podCmd = commands.find(c => {
      const cmd = typeof c === 'string' ? c : c.command;
      return cmd.includes('pod install');
    });

    assert.equal(podCmd, undefined, 'Should not add pod install when Pods/ exists');
  });

  it('uses custom android command from config', async () => {
    const androidDir = path.join(tmpDir, 'android');
    await fs.mkdir(androidDir);
    await fs.writeFile(path.join(androidDir, 'build.gradle'), 'apply plugin');

    // Only test this if ANDROID_HOME is set (otherwise android detection skips with warning)
    const origAndroidHome = process.env.ANDROID_HOME;
    process.env.ANDROID_HOME = tmpDir; // Fake it for detection

    try {
      const commands = await detectHealthCheckCommands(tmpDir, {
        android: { command: './gradlew assembleRelease' }
      });

      const gradleCmd = commands.find(c => {
        const cmd = typeof c === 'string' ? c : c.command;
        return cmd.includes('gradlew');
      });

      if (gradleCmd) {
        const cmdStr = typeof gradleCmd === 'string' ? gradleCmd : gradleCmd.command;
        assert.ok(cmdStr.includes('assembleRelease'), 'Should use custom android command');
      }
    } finally {
      if (origAndroidHome === undefined) {
        delete process.env.ANDROID_HOME;
      } else {
        process.env.ANDROID_HOME = origAndroidHome;
      }
    }
  });

  it('uses custom nativeBuildTimeoutMs', async () => {
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'TestApp.xcworkspace'));
    await fs.mkdir(path.join(iosDir, 'Pods'));

    const commands = await detectHealthCheckCommands(tmpDir, { nativeBuildTimeoutMs: 600000 });

    const nativeCmd = commands.find(c => typeof c === 'object' && c.timeoutMs);
    if (nativeCmd) {
      assert.equal(nativeCmd.timeoutMs, 600000);
    }
  });
});

describe('resolveHealthCheckConfig', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-resolve-'));
  });

  it('uses explicit commands when provided', async () => {
    const config = await resolveHealthCheckConfig(tmpDir, {
      healthCheck: { commands: ['pytest', 'mypy src/'] }
    });
    assert.deepEqual(config.commands, ['pytest', 'mypy src/']);
  });

  it('falls back to auto-detection when no explicit commands', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } })
    );
    const config = await resolveHealthCheckConfig(tmpDir, {});
    // Should include at least npm test
    assert.ok(config.commands.includes('npm test'));
  });

  it('uses custom timeout when provided', async () => {
    const config = await resolveHealthCheckConfig(tmpDir, {
      healthCheck: { commands: ['echo hi'], timeoutMs: 300000 }
    });
    assert.equal(config.timeoutMs, 300000);
  });

  it('defaults timeout to 120000', async () => {
    const config = await resolveHealthCheckConfig(tmpDir, {});
    assert.equal(config.timeoutMs, 120000);
  });

  it('returns empty commands when nothing configured and no package.json', async () => {
    const config = await resolveHealthCheckConfig(tmpDir, {});
    assert.deepEqual(config.commands, []);
  });

  it('passes nativeBuild:false through to detection', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } })
    );
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'TestApp.xcworkspace'));

    const config = await resolveHealthCheckConfig(tmpDir, {
      healthCheck: { nativeBuild: false }
    });

    // Should only have JS commands, no native
    assert.deepEqual(config.commands, ['npm test']);
  });

  it('passes iOS config overrides through to detection', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } })
    );
    const iosDir = path.join(tmpDir, 'ios');
    await fs.mkdir(iosDir);
    await fs.writeFile(path.join(iosDir, 'Podfile'), 'platform :ios');
    await fs.mkdir(path.join(iosDir, 'AutoDetected.xcworkspace'));
    await fs.mkdir(path.join(iosDir, 'Pods'));

    const config = await resolveHealthCheckConfig(tmpDir, {
      healthCheck: {
        ios: { workspace: 'Override.xcworkspace', scheme: 'OverrideScheme' }
      }
    });

    const xcodeCmd = config.commands.find(c => {
      const cmd = typeof c === 'string' ? c : c.command;
      return cmd.includes('xcodebuild');
    });

    if (xcodeCmd) {
      const cmdStr = typeof xcodeCmd === 'string' ? xcodeCmd : xcodeCmd.command;
      assert.ok(cmdStr.includes('Override.xcworkspace'));
      assert.ok(cmdStr.includes('OverrideScheme'));
    }
  });
});

describe('checkToolAvailability', () => {
  it('returns an object with expected keys', async () => {
    const tools = await checkToolAvailability();
    assert.equal(typeof tools.xcodebuild, 'boolean');
    assert.equal(typeof tools.pod, 'boolean');
    assert.equal(typeof tools.bundleExecPod, 'boolean');
    assert.equal(typeof tools.androidSdk, 'boolean');
  });
});

describe('_validateCommand', () => {
  it('returns null for safe commands', () => {
    assert.equal(_validateCommand('npm test'), null);
    assert.equal(_validateCommand('npm run build'), null);
    assert.equal(_validateCommand('echo hello'), null);
  });

  it('warns on semicolons', () => {
    const result = _validateCommand('npm test; rm -rf /');
    assert.ok(result);
    assert.ok(result.includes('metacharacters'));
  });

  it('warns on && operators', () => {
    const result = _validateCommand('npm test && npm run lint');
    assert.ok(result);
    assert.ok(result.includes('metacharacters'));
  });

  it('warns on || operators', () => {
    const result = _validateCommand('cmd1 || cmd2');
    assert.ok(result);
  });

  it('warns on pipe operators', () => {
    const result = _validateCommand('cat file | grep pattern');
    assert.ok(result);
  });

  it('warns on $() subshells', () => {
    const result = _validateCommand('echo $(whoami)');
    assert.ok(result);
  });

  it('warns on backticks', () => {
    const result = _validateCommand('echo `whoami`');
    assert.ok(result);
  });
});
