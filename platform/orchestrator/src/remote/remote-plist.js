const os = require('os');
const path = require('path');
const { DEVSHOP_ROOT } = require('../infra/registry');
const { CONTROL_SESSION } = require('./tmux');

const REMOTE_LABEL = 'com.devshop.remote';
const INDEX_JS = path.join(DEVSHOP_ROOT, 'platform', 'orchestrator', 'src', 'index.js');

function remotePlistPath(home = os.homedir()) {
  return path.join(home, 'Library', 'LaunchAgents', `${REMOTE_LABEL}.plist`);
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * launchd agent that starts the control server inside a detached tmux
 * session at login. tmux returns immediately once the session exists, so
 * KeepAlive restarts only on a failed exit (tmux itself failing); the
 * server's own restart loop (remote/server.js) handles everything after.
 * PATH is captured from the installing shell so claude, tmux, node and gh
 * resolve under launchd's minimal environment.
 */
function buildRemotePlist({ nodePath = process.execPath, tmuxPath, logDir, pathEnv = process.env.PATH || '', home = os.homedir(), devshopRoot = DEVSHOP_ROOT, indexJs = INDEX_JS }) {
  if (!tmuxPath) throw new Error('buildRemotePlist requires tmuxPath');
  if (!logDir) throw new Error('buildRemotePlist requires logDir');

  const programArgs = [
    tmuxPath, 'new-session', '-d', '-s', CONTROL_SESSION, '-c', devshopRoot, '--',
    nodePath, indexJs, 'remote', 'start'
  ].map(a => `    <string>${xmlEscape(a)}</string>`).join('\n');

  const dirs = [path.dirname(nodePath), path.dirname(tmuxPath)];
  const mergedPath = [...new Set([...dirs, ...pathEnv.split(':').filter(Boolean), '/usr/local/bin', '/usr/bin', '/bin'])].join(':');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${REMOTE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, 'launchd-stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, 'launchd-stderr.log'))}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(devshopRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(mergedPath)}</string>
    <key>HOME</key>
    <string>${xmlEscape(home)}</string>
  </dict>
</dict>
</plist>
`;
}

module.exports = { REMOTE_LABEL, INDEX_JS, remotePlistPath, buildRemotePlist };
