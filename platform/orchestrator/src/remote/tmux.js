const { execFile } = require('../infra/exec-utils');

const SESSION_PREFIX = 'devshop-';
/** tmux session that hosts the control server itself. */
const CONTROL_SESSION = 'devshop-remote';
const LAUNCH_COMMANDS = ['run', 'talk', 'pair', 'kickoff'];
// Registry IDs and kickoff names are kebab-case; anything else must never
// reach a tmux target or an argv.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/**
 * Deterministic tmux session name for an orchestrator command on a project.
 * Throws on anything outside the allowlisted command set or ID shape.
 */
function sessionName(projectId, command) {
  if (!isValidId(projectId)) {
    throw new Error(`Invalid project ID for a session name: ${JSON.stringify(projectId)}`);
  }
  if (!LAUNCH_COMMANDS.includes(command)) {
    throw new Error(`Invalid command: ${JSON.stringify(command)} (expected one of ${LAUNCH_COMMANDS.join(', ')})`);
  }
  return `${SESSION_PREFIX}${projectId}-${command}`;
}

/** Inverse of sessionName; null for sessions that aren't launcher-shaped. */
function parseSessionName(name) {
  const m = /^devshop-(.+)-(run|talk|pair|kickoff)$/.exec(name);
  return m ? { projectId: m[1], command: m[2] } : null;
}

function formatAge(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

/**
 * Thin tmux wrapper. Every call goes through execFile with an argv array —
 * nothing is ever interpolated into a shell string. Targets use the exact-match
 * form so a prefix can't match the wrong session: `=name` for session
 * commands, `=name:` (session + current window) for pane commands.
 */
class Tmux {
  constructor({ exec = execFile, now = Date.now } = {}) {
    this.exec = exec;
    this.now = now;
  }

  async hasSession(name) {
    try {
      await this.exec('tmux', ['has-session', '-t', `=${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Start `argv` in a new session. tmux passes each argv element intact. */
  async newSession({ name, cwd, argv, detached = true }) {
    const args = ['new-session'];
    if (detached) args.push('-d');
    args.push('-s', name, '-c', cwd, '--', ...argv);
    await this.exec('tmux', args);
  }

  /** Launcher-shaped sessions with their age. Empty when tmux has no server. */
  async listSessions() {
    let stdout;
    try {
      ({ stdout } = await this.exec('tmux', ['list-sessions', '-F', '#{session_name}|#{session_created}']));
    } catch {
      return [];
    }
    const nowSec = Math.floor(this.now() / 1000);
    return stdout
      .split('\n')
      .filter(line => line.startsWith(SESSION_PREFIX))
      .map(line => {
        const [name, created] = line.split('|');
        const ageSeconds = Math.max(0, nowSec - Number(created));
        return { name, ...(parseSessionName(name) || {}), ageSeconds, age: formatAge(ageSeconds) };
      });
  }

  /** Type `text` literally into the session, then press Enter. */
  async sendText(name, text) {
    await this.exec('tmux', ['send-keys', '-t', `=${name}:`, '-l', '--', text]);
    await this.exec('tmux', ['send-keys', '-t', `=${name}:`, 'Enter']);
  }

  /** Send a key name such as `C-c` or `Escape`. */
  async sendKey(name, key) {
    await this.exec('tmux', ['send-keys', '-t', `=${name}:`, key]);
  }

  async killSession(name) {
    try {
      await this.exec('tmux', ['kill-session', '-t', `=${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Recent visible output of the session's active pane ('' when absent). */
  async capturePane(name, lines = 200) {
    try {
      const { stdout } = await this.exec('tmux', ['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', `-${lines}`]);
      return stdout;
    } catch {
      return '';
    }
  }
}

module.exports = { Tmux, sessionName, parseSessionName, isValidId, formatAge, LAUNCH_COMMANDS, CONTROL_SESSION, SESSION_PREFIX };
