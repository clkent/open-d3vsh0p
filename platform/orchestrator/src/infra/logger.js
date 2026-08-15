const fs = require('fs/promises');
const path = require('path');

class Logger {
  constructor(sessionId, logDir) {
    this.sessionId = sessionId;
    this.logDir = logDir;
    this.logFile = path.join(logDir, `${sessionId}.jsonl`);
    this.initialized = false;
  }

  async init() {
    await fs.mkdir(this.logDir, { recursive: true });
    this.initialized = true;
  }

  async log(level, event, data = {}) {
    if (!this.initialized) await this.init();

    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data
    };

    await fs.appendFile(this.logFile, JSON.stringify(entry) + '\n');

    // Console output for real-time monitoring
    if (event === 'microcycle_progress') {
      console.log(`  ${data.persona}: "${data.thought}"`);
    } else if (event === 'milestone') {
      const icon = data.result === 'parked' ? '~' : '*';
      console.log(`  ${icon} [milestone] ${data.requirementId} ${data.result}`);
    } else if (event === 'progress') {
      const used = data.budgetUsedUsd?.toFixed(2) ?? '0.00';
      console.log(`  [progress] ${data.phase} | ${data.completed}/${data.total} | $${used} | ${data.elapsedMinutes}m`);
    } else if (event === 'go_look') {
      console.log(`  >>> ${data.message}`);
    } else {
      const icon = level === 'error' ? '!' : level === 'warn' ? '~' : '-';
      const context = [data.persona || data.agent, data.requirementId, data.reason]
        .filter(Boolean)
        .join(' | ');
      console.log(`  ${icon} [${event}]${context ? ' ' + context : ''}`);
    }
  }

  async logCommit(sha, message) {
    await this.log('info', 'commit_created', { sha, message });
  }
}

module.exports = { Logger };
