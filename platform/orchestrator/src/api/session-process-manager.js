const { spawn } = require('child_process');
const path = require('path');

const ORCHESTRATOR_ENTRY = path.resolve(__dirname, '..', 'index.js');

class SessionProcessManager {
  constructor() {
    this.processes = new Map(); // projectId → { proc, sessionId, startedAt, exitCode, opts }
  }

  /**
   * Start a new orchestrator session for a project.
   * Spawns: node src/index.js run <projectId> [flags]
   */
  start(projectId, opts = {}) {
    if (this.isRunning(projectId)) {
      const existing = this.processes.get(projectId);
      return { error: 'CONFLICT', sessionId: existing.sessionId };
    }

    const args = [ORCHESTRATOR_ENTRY, 'run', projectId];

    if (opts.budget) args.push('--budget', String(opts.budget));
    if (opts.timeLimit) args.push('--time-limit', String(opts.timeLimit));
    if (opts.resume) args.push('--resume');
    if (opts.requirements) args.push('--requirements', opts.requirements.join(','));
    if (opts.window) args.push('--window', opts.window);
    if (opts.noConsolidate) args.push('--no-consolidate');

    const proc = spawn('node', args, {
      stdio: 'ignore',
      detached: false,
      env: { ...process.env }
    });

    const sessionId = `api-${Date.now()}`;
    const entry = {
      proc,
      pid: proc.pid,
      sessionId,
      startedAt: new Date().toISOString(),
      exitCode: null,
      opts
    };

    this.processes.set(projectId, entry);

    proc.on('exit', (code) => {
      entry.exitCode = code;
      entry.proc = null;
    });

    proc.on('error', () => {
      entry.exitCode = -1;
      entry.proc = null;
    });

    return { sessionId, pid: proc.pid };
  }

  /**
   * Stop a running session via SIGTERM.
   */
  stop(projectId) {
    const entry = this.processes.get(projectId);
    if (!entry || !entry.proc) {
      return false;
    }

    try {
      entry.proc.kill('SIGTERM');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a session is currently running for a project.
   */
  isRunning(projectId) {
    const entry = this.processes.get(projectId);
    if (!entry || !entry.proc) return false;

    try {
      process.kill(entry.pid, 0);
      return true;
    } catch {
      entry.proc = null;
      return false;
    }
  }

  /**
   * Get info about a project's session (running or last completed).
   */
  getInfo(projectId) {
    const entry = this.processes.get(projectId);
    if (!entry) return null;

    return {
      sessionId: entry.sessionId,
      pid: entry.pid,
      startedAt: entry.startedAt,
      exitCode: entry.exitCode,
      running: this.isRunning(projectId)
    };
  }

  /**
   * Get count of currently running sessions.
   */
  get activeCount() {
    let count = 0;
    for (const [projectId] of this.processes) {
      if (this.isRunning(projectId)) count++;
    }
    return count;
  }

  /**
   * Stop all running sessions (for graceful shutdown).
   */
  stopAll() {
    for (const [projectId] of this.processes) {
      this.stop(projectId);
    }
  }
}

module.exports = { SessionProcessManager };
