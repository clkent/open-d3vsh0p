const fs = require('fs/promises');
const path = require('path');
const { exec: execAsync } = require('../infra/exec-utils');
const { execFile: execFileAsync } = require('../infra/exec-utils');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_NATIVE_BUILD_TIMEOUT_MS = 300000;
const SAFE_NATIVE_NAME = /^[a-zA-Z0-9._-]+$/;

/**
 * Build a clean env for health check subprocesses.
 * Strips NODE_TEST_CONTEXT (breaks nested test runners) and GIT_* vars
 * (breaks git worktree operations in child processes).
 */
function _cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

/**
 * Run health check commands against a project directory.
 *
 * @param {string} projectDir - Absolute path to the project
 * @param {{ commands?: Array<string|{command: string, timeoutMs?: number}>, timeoutMs?: number }} config - Health check config
 * @returns {Promise<{ passed: boolean, results: Array<{ command: string, exitCode: number, stdout: string, stderr: string }> }>}
 */
async function runHealthCheck(projectDir, config = {}) {
  const commands = config.commands || [];
  const defaultTimeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;

  if (commands.length === 0) {
    return { passed: true, results: [] };
  }

  const results = [];

  for (const entry of commands) {
    const command = typeof entry === 'string' ? entry : entry.command;
    const timeoutMs = (typeof entry === 'object' && entry.timeoutMs) ? entry.timeoutMs : defaultTimeoutMs;

    const warning = _validateCommand(command);
    if (warning) {
      console.warn(`  ~ [health_check_warning] ${warning}`);
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: projectDir,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: _cleanEnv()
      });

      results.push({ command, exitCode: 0, stdout: stdout || '', stderr: stderr || '' });
    } catch (err) {
      const exitCode = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        ? 1
        : (err.killed ? 124 : (err.status || 1)); // 124 = timeout convention

      results.push({
        command,
        exitCode,
        stdout: err.stdout || '',
        stderr: err.stderr || err.message || ''
      });
    }
  }

  const passed = results.every(r => r.exitCode === 0);
  return { passed, results };
}

/**
 * Detect an iOS project in the given directory.
 * Returns workspace/scheme info or null if no iOS project found.
 *
 * @param {string} projectDir
 * @returns {Promise<{ workspace: string, scheme: string } | null>}
 */
async function detectIOSProject(projectDir) {
  const iosDir = path.join(projectDir, 'ios');

  try {
    await fs.access(path.join(iosDir, 'Podfile'));
  } catch {
    return null;
  }

  // Find .xcworkspace file
  try {
    const entries = await fs.readdir(iosDir);
    const workspace = entries.find(e => e.endsWith('.xcworkspace'));
    if (workspace) {
      const scheme = workspace.replace('.xcworkspace', '');
      return { workspace, scheme };
    }
  } catch {
    // ios dir not readable
  }

  return null;
}

/**
 * Detect an Android project in the given directory.
 *
 * @param {string} projectDir
 * @returns {Promise<boolean>}
 */
async function detectAndroidProject(projectDir) {
  const androidDir = path.join(projectDir, 'android');

  try {
    await fs.access(path.join(androidDir, 'build.gradle'));
    return true;
  } catch {
    // try Kotlin DSL
  }

  try {
    await fs.access(path.join(androidDir, 'build.gradle.kts'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check availability of native build tools.
 * Returns which tools are present.
 *
 * @returns {Promise<{ xcodebuild: boolean, pod: boolean, bundleExecPod: boolean, androidSdk: boolean }>}
 */
async function checkToolAvailability() {
  const result = { xcodebuild: false, pod: false, bundleExecPod: false, androidSdk: false };

  // Check xcodebuild (must be full Xcode, not just CLI tools)
  try {
    await execFileAsync('which', ['xcodebuild']);
    // Verify it's full Xcode, not just Command Line Tools
    const { stdout } = await execFileAsync('xcode-select', ['-p']);
    if (!stdout.includes('CommandLineTools')) {
      result.xcodebuild = true;
    }
  } catch {
    // not available
  }

  // Check bundle exec pod
  try {
    await execFileAsync('bundle', ['exec', 'pod', '--version']);
    result.bundleExecPod = true;
  } catch {
    // not available
  }

  // Check pod directly
  try {
    await execFileAsync('pod', ['--version']);
    result.pod = true;
  } catch {
    // not available
  }

  // Check Android SDK
  if (process.env.ANDROID_HOME) {
    try {
      await fs.access(process.env.ANDROID_HOME);
      result.androidSdk = true;
    } catch {
      // ANDROID_HOME set but not accessible
    }
  }

  return result;
}

/**
 * Auto-detect health check commands from project's package.json and native projects.
 *
 * @param {string} projectDir - Absolute path to the project
 * @param {{ nativeBuild?: boolean, nativeBuildTimeoutMs?: number, ios?: { workspace?: string, scheme?: string }, android?: { command?: string } }} options
 * @returns {Promise<Array<string|{command: string, timeoutMs: number}>>} Detected commands
 */
async function detectHealthCheckCommands(projectDir, options = {}) {
  const commands = [];

  // JS/TS detection from package.json
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    const raw = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);

    if (pkg.scripts) {
      if (pkg.scripts.test) {
        commands.push('npm test');
      }
      if (pkg.scripts.build) {
        commands.push('npm run build');
      }
    }
  } catch {
    // No package.json or invalid JSON
  }

  // Native build detection (skip if explicitly disabled)
  if (options.nativeBuild === false) {
    return commands;
  }

  const nativeTimeoutMs = options.nativeBuildTimeoutMs || DEFAULT_NATIVE_BUILD_TIMEOUT_MS;
  const tools = await checkToolAvailability();

  // iOS detection
  const iosProject = await detectIOSProject(projectDir);
  if (iosProject) {
    if (!tools.xcodebuild) {
      console.warn('  ~ [health_check_warning] xcodebuild not available — skipping iOS build validation');
    } else {
      const workspace = (options.ios && options.ios.workspace) || iosProject.workspace;
      const scheme = (options.ios && options.ios.scheme) || iosProject.scheme;
      const iosDir = path.join(projectDir, 'ios');

      // Pod install pre-step if Pods/ directory is missing
      let needsPodInstall = false;
      try {
        await fs.access(path.join(iosDir, 'Pods'));
      } catch {
        needsPodInstall = true;
      }

      if (needsPodInstall) {
        if (tools.bundleExecPod) {
          commands.push({
            command: `cd "${iosDir}" && bundle exec pod install`,
            timeoutMs: nativeTimeoutMs
          });
        } else if (tools.pod) {
          commands.push({
            command: `cd "${iosDir}" && pod install`,
            timeoutMs: nativeTimeoutMs
          });
        } else {
          console.warn('  ~ [health_check_warning] CocoaPods not available — skipping pod install');
        }
      }

      // Validate workspace/scheme names to prevent shell injection via malicious directory names
      if (!SAFE_NATIVE_NAME.test(workspace) || !SAFE_NATIVE_NAME.test(scheme)) {
        console.warn('  ~ [health_check_warning] Unsafe characters in iOS workspace/scheme name — skipping xcodebuild');
      } else {
        commands.push({
          command: `xcodebuild -workspace "${path.join(iosDir, workspace)}" -scheme "${scheme}" -sdk iphonesimulator -configuration Debug build CODE_SIGNING_ALLOWED=NO`,
          timeoutMs: nativeTimeoutMs
        });
      }
    }
  }

  // Android detection
  const hasAndroid = await detectAndroidProject(projectDir);
  if (hasAndroid) {
    if (!tools.androidSdk) {
      console.warn('  ~ [health_check_warning] ANDROID_HOME not set — skipping Android build validation');
    } else {
      const androidDir = path.join(projectDir, 'android');
      const androidCommand = (options.android && options.android.command) || `cd "${androidDir}" && ./gradlew assembleDebug --no-daemon`;

      commands.push({
        command: androidCommand,
        timeoutMs: nativeTimeoutMs
      });
    }
  }

  return commands;
}

/**
 * Resolve health check config: use explicit config if provided, otherwise auto-detect.
 *
 * @param {string} projectDir
 * @param {{ healthCheck?: { commands?: string[], timeoutMs?: number, nativeBuild?: boolean, nativeBuildTimeoutMs?: number, ios?: { workspace?: string, scheme?: string }, android?: { command?: string } } }} projectConfig
 * @returns {Promise<{ commands: Array<string|{command: string, timeoutMs: number}>, timeoutMs: number }>}
 */
async function resolveHealthCheckConfig(projectDir, projectConfig = {}) {
  const hcConfig = projectConfig.healthCheck || {};

  if (hcConfig.commands && hcConfig.commands.length > 0) {
    return {
      commands: hcConfig.commands,
      timeoutMs: hcConfig.timeoutMs || DEFAULT_TIMEOUT_MS
    };
  }

  const detected = await detectHealthCheckCommands(projectDir, {
    nativeBuild: hcConfig.nativeBuild,
    nativeBuildTimeoutMs: hcConfig.nativeBuildTimeoutMs,
    ios: hcConfig.ios,
    android: hcConfig.android,
  });

  return {
    commands: detected,
    timeoutMs: hcConfig.timeoutMs || DEFAULT_TIMEOUT_MS
  };
}

/**
 * Validate a command for shell metacharacters. Returns a warning string if
 * suspicious patterns are found, or null if the command looks safe.
 * Advisory only — does not block execution.
 */
function _validateCommand(command) {
  const metacharPattern = /[;|`]|\$\(|&&|\|\|/;
  if (metacharPattern.test(command)) {
    return `Command contains shell metacharacters: "${command}"`;
  }
  return null;
}

module.exports = {
  runHealthCheck,
  detectHealthCheckCommands,
  resolveHealthCheckConfig,
  detectIOSProject,
  detectAndroidProject,
  checkToolAvailability,
  _validateCommand,
  _cleanEnv,
  DEFAULT_NATIVE_BUILD_TIMEOUT_MS
};
