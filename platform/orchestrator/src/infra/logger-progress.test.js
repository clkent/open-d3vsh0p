const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Logger } = require('./logger');

describe('Logger progress formatting', () => {
  let logger;
  let tmpDir;
  let consoleOutput;
  const originalLog = console.log;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));
    logger = new Logger('test-session', tmpDir);
    consoleOutput = [];
    console.log = (...args) => consoleOutput.push(args.join(' '));
  });

  // Restore console.log after each test
  async function withRestore(fn) {
    try {
      await fn();
    } finally {
      console.log = originalLog;
    }
  }

  it('formats progress as persona: "thought"', async () => {
    await withRestore(async () => {
      await logger.log('info', 'microcycle_progress', {
        phase: 'testing',
        requirementId: 'user-auth',
        persona: 'Jordan',
        thought: 'Running tests...'
      });

      assert.equal(consoleOutput.length, 1);
      assert.equal(consoleOutput[0], '  Jordan: "Running tests..."');
    });
  });

  it('renders review retry thought with Morgan context', async () => {
    await withRestore(async () => {
      await logger.log('info', 'microcycle_progress', {
        phase: 'retrying_review',
        requirementId: 'user-auth',
        persona: 'Jordan',
        thought: 'Morgan flagged: Missing error handling. Fixing...'
      });

      assert.equal(consoleOutput[0], '  Jordan: "Morgan flagged: Missing error handling. Fixing..."');
    });
  });

  it('uses standard formatting for non-progress events', async () => {
    await withRestore(async () => {
      await logger.log('info', 'session_started', { agent: 'orchestrator' });

      assert.ok(consoleOutput[0].startsWith('  - [session_started]'));
    });
  });

  it('writes progress events to JSONL with thought field', async () => {
    await withRestore(async () => {
      await logger.log('info', 'microcycle_progress', {
        phase: 'implementing',
        requirementId: 'user-auth',
        persona: 'Jordan',
        thought: 'Working on user-auth...'
      });

      const content = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(content.trim());
      assert.equal(entry.event, 'microcycle_progress');
      assert.equal(entry.thought, 'Working on user-auth...');
      assert.equal(entry.phase, 'implementing');
    });
  });
});
