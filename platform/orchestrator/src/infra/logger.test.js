const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { Logger } = require('./logger');

describe('Logger', () => {
  let tmpDir;
  let logger;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));
    logger = new Logger('test-session-001', tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('sets sessionId', () => {
      assert.equal(logger.sessionId, 'test-session-001');
    });

    it('sets logDir', () => {
      assert.equal(logger.logDir, tmpDir);
    });

    it('sets logFile path including sessionId', () => {
      assert.equal(logger.logFile, path.join(tmpDir, 'test-session-001.jsonl'));
    });

    it('starts uninitialized', () => {
      assert.equal(logger.initialized, false);
    });

    it('starts with null broadcastFn', () => {
      assert.equal(logger.broadcastFn, null);
    });
  });

  describe('init', () => {
    it('creates log directory and sets initialized to true', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'logs');
      const l = new Logger('s1', nestedDir);
      await l.init();
      assert.equal(l.initialized, true);
      const stat = await fs.stat(nestedDir);
      assert.equal(stat.isDirectory(), true);
    });
  });

  describe('setBroadcast', () => {
    it('sets broadcastFn', () => {
      const fn = () => {};
      logger.setBroadcast(fn);
      assert.equal(logger.broadcastFn, fn);
    });
  });

  describe('log', () => {
    it('appends JSONL entry with ts, level, event, and data', async () => {
      await logger.log('info', 'test_event', { foo: 'bar' });
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.level, 'info');
      assert.equal(entry.event, 'test_event');
      assert.equal(entry.foo, 'bar');
      assert.equal(typeof entry.ts, 'string');
      assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T/);
    });

    it('auto-initializes on first log call', async () => {
      const nestedDir = path.join(tmpDir, 'auto-init');
      const l = new Logger('s2', nestedDir);
      assert.equal(l.initialized, false);
      await l.log('info', 'auto_init_test');
      assert.equal(l.initialized, true);
    });

    it('calls broadcastFn with level, eventType, and data', async () => {
      const broadcasts = [];
      logger.setBroadcast((msg) => broadcasts.push(msg));
      await logger.log('warn', 'test_broadcast', { key: 'val' });
      assert.equal(broadcasts.length, 1);
      assert.equal(broadcasts[0].level, 'warn');
      assert.equal(broadcasts[0].eventType, 'test_broadcast');
      assert.deepEqual(broadcasts[0].data, { key: 'val' });
    });

    it('swallows broadcast errors without throwing', async () => {
      logger.setBroadcast(() => { throw new Error('broadcast boom'); });
      await assert.doesNotReject(() => logger.log('info', 'safe_event'));
    });

    it('appends multiple entries as separate lines', async () => {
      await logger.log('info', 'first');
      await logger.log('info', 'second');
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const lines = raw.trim().split('\n');
      assert.equal(lines.length, 2);
      assert.equal(JSON.parse(lines[0]).event, 'first');
      assert.equal(JSON.parse(lines[1]).event, 'second');
    });
  });

  describe('convenience methods', () => {
    it('logStateTransition logs info/state_transition with from/to', async () => {
      await logger.logStateTransition('IDLE', 'RUNNING', 'req-001');
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.level, 'info');
      assert.equal(entry.event, 'state_transition');
      assert.equal(entry.from, 'IDLE');
      assert.equal(entry.to, 'RUNNING');
      assert.equal(entry.requirementId, 'req-001');
    });

    it('logAgentRun logs info on success, warn on failure', async () => {
      await logger.logAgentRun('impl', { success: true, cost: 1.5, duration: 1000 });
      await logger.logAgentRun('impl', { success: false, cost: 0.5, duration: 500, error: 'timeout' });
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const lines = raw.trim().split('\n').map(l => JSON.parse(l));
      assert.equal(lines[0].level, 'info');
      assert.equal(lines[0].event, 'agent_completed');
      assert.equal(lines[0].agent, 'impl');
      assert.equal(lines[1].level, 'warn');
      assert.equal(lines[1].error, 'timeout');
    });

    it('logTestRun logs info on pass, warn on failure', async () => {
      await logger.logTestRun({ passed: true, summary: 'PASS', exitCode: 0 });
      await logger.logTestRun({ passed: false, summary: 'FAIL', exitCode: 1 });
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const lines = raw.trim().split('\n').map(l => JSON.parse(l));
      assert.equal(lines[0].level, 'info');
      assert.equal(lines[0].event, 'tests_completed');
      assert.equal(lines[1].level, 'warn');
    });

    it('logCommit logs info/commit_created', async () => {
      await logger.logCommit('abc123', 'feat: add login');
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.event, 'commit_created');
      assert.equal(entry.sha, 'abc123');
      assert.equal(entry.message, 'feat: add login');
    });

    it('logMerge logs info/merged', async () => {
      await logger.logMerge('user-auth', 'devshop/work-s1');
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.event, 'merged');
      assert.equal(entry.requirementId, 'user-auth');
    });

    it('logParked logs warn/requirement_parked', async () => {
      await logger.logParked('user-auth', 'tests failed');
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.level, 'warn');
      assert.equal(entry.event, 'requirement_parked');
      assert.equal(entry.reason, 'tests failed');
    });

    it('logMilestone logs warn for parked, info for other', async () => {
      await logger.logMilestone({ result: 'parked', requirementId: 'r1' });
      await logger.logMilestone({ result: 'merged', requirementId: 'r2' });
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const lines = raw.trim().split('\n').map(l => JSON.parse(l));
      assert.equal(lines[0].level, 'warn');
      assert.equal(lines[1].level, 'info');
    });

    it('logPreviewCheck uses debug level when no transition', async () => {
      await logger.logPreviewCheck({ available: true, transition: false });
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.level, 'debug');
    });

    it('logPreviewCheck uses info when transition to available', async () => {
      await logger.logPreviewCheck({ available: true, transition: true });
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.level, 'info');
    });

    it('logPreviewCheck uses warn when transition to unavailable', async () => {
      await logger.logPreviewCheck({ available: false, transition: true });
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.level, 'warn');
    });
  });

  describe('writeSummary', () => {
    it('writes summary JSON with correct structure', async () => {
      await logger.init();
      const state = {
        sessionId: 'test-session-001',
        projectId: 'proj-001',
        startedAt: '2026-01-01T00:00:00.000Z',
        consumption: { totalCostUsd: 5.50, totalDurationMs: 60000, agentInvocations: 3 },
        requirements: {
          completed: ['req-1', 'req-2'],
          parked: [{ id: 'req-3', reason: 'test fail' }],
          pending: ['req-4']
        },
        sessionBranch: 'devshop/session-test',
        completedMicrocycles: [],
        preview: { available: true }
      };

      const summaryPath = await logger.writeSummary(state);
      const summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));

      assert.equal(summary.sessionId, 'test-session-001');
      assert.equal(summary.projectId, 'proj-001');
      assert.equal(summary.totalCostUsd, 5.50);
      assert.equal(summary.agentInvocations, 3);
      assert.deepEqual(summary.results.completed, ['req-1', 'req-2']);
      assert.equal(summary.results.remaining.length, 1);
      assert.equal(typeof summary.completedAt, 'string');
      assert.equal(summary.preview.available, true);
    });

    it('includes humanItems when provided', async () => {
      await logger.init();
      const state = {
        sessionId: 's1', projectId: 'p1', startedAt: '2026-01-01T00:00:00Z',
        consumption: { totalCostUsd: 0, totalDurationMs: 0, agentInvocations: 0 },
        requirements: { completed: [], parked: [], pending: [] },
        sessionBranch: 'b', completedMicrocycles: []
      };
      const summaryPath = await logger.writeSummary(state, {
        humanItems: [{ id: 'h1', description: 'manual step' }]
      });
      const summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
      assert.equal(summary.humanItems.length, 1);
      assert.equal(summary.humanItems[0].id, 'h1');
    });

    it('auto-initializes if not yet initialized', async () => {
      const nestedDir = path.join(tmpDir, 'summary-auto');
      const l = new Logger('s3', nestedDir);
      assert.equal(l.initialized, false);
      const state = {
        sessionId: 's3', projectId: 'p1', startedAt: '2026-01-01T00:00:00Z',
        consumption: { totalCostUsd: 0, totalDurationMs: 0, agentInvocations: 0 },
        requirements: { completed: [], parked: [], pending: [] },
        sessionBranch: 'b', completedMicrocycles: []
      };
      await l.writeSummary(state);
      assert.equal(l.initialized, true);
    });
  });

  describe('_determineStopReason', () => {
    it('returns all_requirements_processed when nothing pending or in progress', () => {
      const reason = logger._determineStopReason({
        requirements: { pending: [], inProgress: null }
      });
      assert.equal(reason, 'all_requirements_processed');
    });

    it('returns session_ended when items still pending', () => {
      const reason = logger._determineStopReason({
        requirements: { pending: ['req-1'], inProgress: null }
      });
      assert.equal(reason, 'session_ended');
    });

    it('returns session_ended when item in progress', () => {
      const reason = logger._determineStopReason({
        requirements: { pending: [], inProgress: 'req-1' }
      });
      assert.equal(reason, 'session_ended');
    });
  });
});
