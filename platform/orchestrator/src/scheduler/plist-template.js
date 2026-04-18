const path = require('path');
const os = require('os');

const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * Generate a launchd plist label for a project window.
 */
function plistLabel(projectId, windowName) {
  return `com.devshop.${projectId}.${windowName}`;
}

/**
 * Get the plist file path in ~/Library/LaunchAgents/.
 */
function plistPath(projectId, windowName) {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${plistLabel(projectId, windowName)}.plist`);
}

/**
 * Build a launchd plist XML string for a project window.
 */
function buildPlist({ projectId, windowName, startHour, logDir, nodePath }) {
  const label = plistLabel(projectId, windowName);
  const node = nodePath || process.execPath;
  const indexJs = path.join(DEVSHOP_ROOT, 'platform', 'orchestrator', 'src', 'index.js');

  const stdoutLog = path.join(logDir, `${windowName}-stdout.log`);
  const stderrLog = path.join(logDir, `${windowName}-stderr.log`);

  // For cadence windows, we need different program arguments
  let programArgs;
  if (windowName === 'weekly' || windowName === 'monthly') {
    programArgs = [
      `    <string>${node}</string>`,
      `    <string>${indexJs}</string>`,
      `    <string>cadence</string>`,
      `    <string>run</string>`,
      `    <string>${projectId}</string>`,
      `    <string>--type</string>`,
      `    <string>${windowName}</string>`
    ].join('\n');
  } else if (windowName === 'morning') {
    programArgs = [
      `    <string>${node}</string>`,
      `    <string>${indexJs}</string>`,
      `    <string>run</string>`,
      `    <string>${projectId}</string>`,
      `    <string>--window</string>`,
      `    <string>morning</string>`
    ].join('\n');
  } else {
    programArgs = [
      `    <string>${node}</string>`,
      `    <string>${indexJs}</string>`,
      `    <string>run</string>`,
      `    <string>${projectId}</string>`,
      `    <string>--window</string>`,
      `    <string>${windowName}</string>`
    ].join('\n');
  }

  // Build StartCalendarInterval based on window type
  let calendarInterval;
  if (windowName === 'weekly') {
    // Weekly: specific day of week
    calendarInterval = `  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>${startHour}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>`;
  } else if (windowName === 'monthly') {
    // Monthly: specific day of month
    calendarInterval = `  <key>StartCalendarInterval</key>
  <dict>
    <key>Day</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>${startHour}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>`;
  } else {
    // Daily windows: every day at startHour
    calendarInterval = `  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${startHour}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
${calendarInterval}
  <key>StandardOutPath</key>
  <string>${stdoutLog}</string>
  <key>StandardErrorPath</key>
  <string>${stderrLog}</string>
  <key>WorkingDirectory</key>
  <string>${DEVSHOP_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

module.exports = { buildPlist, plistLabel, plistPath };
