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

describe('Logger broadcast integration', () => {
  let logger;
  let tmpDir;
  const originalLog = console.log;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-broadcast-'));
    logger = new Logger('test-session', tmpDir);
    console.log = () => {};
  });

  async function withRestore(fn) {
    try {
      await fn();
    } finally {
      console.log = originalLog;
    }
  }

  it('calls broadcastFn on log() when set', async () => {
    await withRestore(async () => {
      const calls = [];
      logger.setBroadcast((evt) => calls.push(evt));

      await logger.log('info', 'phase_started', { phase: 'Phase 1' });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].level, 'info');
      assert.equal(calls[0].eventType, 'phase_started');
      assert.deepEqual(calls[0].data, { phase: 'Phase 1' });
    });
  });

  it('does not call broadcastFn when not set', async () => {
    await withRestore(async () => {
      // Should not throw — no broadcastFn configured
      await logger.log('info', 'session_started', { projectId: 'test' });

      // Verify JSONL was still written
      const content = await fs.readFile(logger.logFile, 'utf-8');
      assert.ok(content.includes('session_started'));
    });
  });

  it('broadcastFn error does not affect logging', async () => {
    await withRestore(async () => {
      logger.setBroadcast(() => { throw new Error('broadcast broken'); });

      // Should not throw — broadcast errors are caught
      await logger.log('info', 'test_event', { key: 'value' });

      // JSONL should still be written
      const content = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(content.trim());
      assert.equal(entry.event, 'test_event');
      assert.equal(entry.key, 'value');
    });
  });
});

describe('Logger milestone/progress/go_look methods', () => {
  let logger;
  let tmpDir;
  let consoleOutput;
  const originalLog = console.log;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-milestone-'));
    logger = new Logger('test-session', tmpDir);
    consoleOutput = [];
    console.log = (...args) => consoleOutput.push(args.join(' '));
  });

  async function withRestore(fn) {
    try {
      await fn();
    } finally {
      console.log = originalLog;
    }
  }

  it('logMilestone writes JSONL with milestone event', async () => {
    await withRestore(async () => {
      await logger.logMilestone({
        requirementId: 'user-auth',
        result: 'merged',
        persona: 'Taylor',
        group: 'A',
        attempts: 2,
        costUsd: 3.50,
        diffStat: '5 files changed',
        reviewSummary: 'Approved',
        previewAvailable: true,
        progress: { completed: 3, total: 7, parked: 0 }
      });

      const content = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(content.trim());
      assert.equal(entry.event, 'milestone');
      assert.equal(entry.level, 'info');
      assert.equal(entry.requirementId, 'user-auth');
      assert.equal(entry.result, 'merged');
    });
  });

  it('logMilestone uses warn level for parked', async () => {
    await withRestore(async () => {
      await logger.logMilestone({
        requirementId: 'payment-flow',
        result: 'parked',
        persona: 'Jordan',
        group: 'B',
        attempts: 4,
        costUsd: 8.20,
        progress: { completed: 3, total: 7, parked: 1 }
      });

      const content = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(content.trim());
      assert.equal(entry.level, 'warn');
    });
  });

  it('logMilestone console output uses * for merged, ~ for parked', async () => {
    await withRestore(async () => {
      await logger.logMilestone({ requirementId: 'user-auth', result: 'merged', progress: {} });
      assert.equal(consoleOutput[0], '  * [milestone] user-auth merged');

      consoleOutput.length = 0;
      await logger.logMilestone({ requirementId: 'payment', result: 'parked', progress: {} });
      assert.equal(consoleOutput[0], '  ~ [milestone] payment parked');
    });
  });

  it('logMilestone broadcasts via broadcastFn', async () => {
    await withRestore(async () => {
      const calls = [];
      logger.setBroadcast((evt) => calls.push(evt));

      await logger.logMilestone({ requirementId: 'auth', result: 'merged', progress: {} });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].eventType, 'milestone');
      assert.equal(calls[0].data.requirementId, 'auth');
    });
  });

  it('logProgress writes JSONL and formats console', async () => {
    await withRestore(async () => {
      await logger.logProgress({
        phase: 'Phase 2: UI',
        completed: 2,
        total: 5,
        parked: 0,
        budgetUsedUsd: 6.30,
        budgetLimitUsd: 30,
        elapsedMinutes: 12,
        activeAgents: []
      });

      const content = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(content.trim());
      assert.equal(entry.event, 'progress');
      assert.equal(entry.level, 'info');
      assert.equal(entry.completed, 2);

      assert.equal(consoleOutput[0], '  [progress] Phase 2: UI | 2/5 | $6.30/$30.00 | 12m');
    });
  });

  it('logProgress broadcasts via broadcastFn', async () => {
    await withRestore(async () => {
      const calls = [];
      logger.setBroadcast((evt) => calls.push(evt));

      await logger.logProgress({ phase: 'Phase 1', completed: 1, total: 3, budgetUsedUsd: 2, budgetLimitUsd: 30, elapsedMinutes: 5 });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].eventType, 'progress');
    });
  });

  it('logGoLook writes JSONL and formats console with >>>', async () => {
    await withRestore(async () => {
      await logger.logGoLook({
        requirementId: 'nav-bar',
        previewCommand: 'npm run dev',
        previewPort: 3000,
        message: 'nav-bar merged — refresh localhost:3000'
      });

      const content = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(content.trim());
      assert.equal(entry.event, 'go_look');
      assert.equal(entry.level, 'info');

      assert.equal(consoleOutput[0], '  >>> nav-bar merged — refresh localhost:3000');
    });
  });

  it('logGoLook broadcasts via broadcastFn', async () => {
    await withRestore(async () => {
      const calls = [];
      logger.setBroadcast((evt) => calls.push(evt));

      await logger.logGoLook({ requirementId: 'nav', message: 'nav merged — refresh localhost:3000' });

      assert.equal(calls.length, 1);
      assert.equal(calls[0].eventType, 'go_look');
    });
  });
});
