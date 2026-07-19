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
    it('logCommit logs info/commit_created', async () => {
      await logger.logCommit('abc123', 'feat: add login');
      const raw = await fs.readFile(logger.logFile, 'utf-8');
      const entry = JSON.parse(raw.trim());
      assert.equal(entry.event, 'commit_created');
      assert.equal(entry.sha, 'abc123');
      assert.equal(entry.message, 'feat: add login');
    });
  });
});
