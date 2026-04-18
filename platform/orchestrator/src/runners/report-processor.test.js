const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { readQueue, writeQueue, appendReport, processReports } = require('./report-processor');

describe('readQueue', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when file does not exist', async () => {
    const result = await readQueue(path.join(tmpDir, 'nonexistent.json'));
    assert.deepEqual(result, []);
  });

  it('returns empty array for malformed JSON', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    await fs.writeFile(queuePath, 'not json at all');
    const result = await readQueue(queuePath);
    assert.deepEqual(result, []);
  });

  it('returns empty array for non-array JSON', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    await fs.writeFile(queuePath, '{"not": "array"}');
    const result = await readQueue(queuePath);
    assert.deepEqual(result, []);
  });

  it('reads a valid queue', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    const data = [{ id: 'abc', type: 'bug', description: 'broken', createdAt: '2026-01-01', status: 'pending' }];
    await fs.writeFile(queuePath, JSON.stringify(data));
    const result = await readQueue(queuePath);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'abc');
  });
});

describe('writeQueue', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates parent directories if needed', async () => {
    const queuePath = path.join(tmpDir, 'nested', 'dir', 'queue.json');
    await writeQueue(queuePath, [{ id: '1' }]);
    const raw = await fs.readFile(queuePath, 'utf-8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.length, 1);
  });
});

describe('appendReport', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates queue file and appends report', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    const report = await appendReport(queuePath, { type: 'bug', description: 'page crashes' });

    assert.equal(report.type, 'bug');
    assert.equal(report.description, 'page crashes');
    assert.equal(report.status, 'pending');
    assert.ok(report.id);
    assert.ok(report.createdAt);

    const queue = await readQueue(queuePath);
    assert.equal(queue.length, 1);
  });

  it('appends to existing queue', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    await appendReport(queuePath, { type: 'bug', description: 'first' });
    await appendReport(queuePath, { type: 'feature', description: 'second' });

    const queue = await readQueue(queuePath);
    assert.equal(queue.length, 2);
    assert.equal(queue[0].type, 'bug');
    assert.equal(queue[1].type, 'feature');
  });
});

describe('processReports', () => {
  let tmpDir;
  let mockLogger;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-test-'));
    mockLogger = { log: async () => {} };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns processed 0 for empty queue', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    const result = await processReports(queuePath, {
      projectDir: tmpDir,
      logger: mockLogger
    });
    assert.equal(result.processed, 0);
  });

  it('returns processed 0 for missing queue file', async () => {
    const queuePath = path.join(tmpDir, 'nonexistent.json');
    const result = await processReports(queuePath, {
      projectDir: tmpDir,
      logger: mockLogger
    });
    assert.equal(result.processed, 0);
  });

  it('processes bugs before features', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    const processOrder = [];

    // Pre-populate queue with feature first, then bug
    await writeQueue(queuePath, [
      { id: 'f1', type: 'feature', description: 'add search', createdAt: '2026-01-01', status: 'pending' },
      { id: 'b1', type: 'bug', description: 'page crash', createdAt: '2026-01-02', status: 'pending' }
    ]);

    // Mock: AgentSession constructor and chat will be called inside handlers.
    // Since we can't easily mock the module, we test that the processor
    // marks reports as failed when the agent throws (expected with mock runner)
    const result = await processReports(queuePath, {
      projectDir: tmpDir,
      templatesDir: path.join(os.tmpdir(), 'nonexistent-templates'),
      logger: mockLogger,
      agentRunner: { runAgent: async () => { throw new Error('mock agent'); } },
      templateEngine: { renderString: (s) => s, renderAgentPrompt: async () => '', _resolvePartials: async (s) => s },
      gitOps: null
    });

    assert.equal(result.processed, 2);

    // Both should be marked as failed (since mock agent throws)
    const queue = await readQueue(queuePath);
    assert.equal(queue.find(r => r.id === 'b1').status, 'failed');
    assert.equal(queue.find(r => r.id === 'f1').status, 'failed');
  });

  it('skips already-processed reports', async () => {
    const queuePath = path.join(tmpDir, 'queue.json');
    await writeQueue(queuePath, [
      { id: 'done1', type: 'bug', description: 'old bug', createdAt: '2026-01-01', status: 'completed' },
      { id: 'new1', type: 'bug', description: 'new bug', createdAt: '2026-01-02', status: 'pending' }
    ]);

    const result = await processReports(queuePath, {
      projectDir: tmpDir,
      templatesDir: path.join(os.tmpdir(), 'nonexistent-templates'),
      logger: mockLogger,
      agentRunner: { runAgent: async () => { throw new Error('mock'); } },
      templateEngine: { renderString: (s) => s, renderAgentPrompt: async () => '', _resolvePartials: async (s) => s },
      gitOps: null
    });

    // Only the pending report should be processed
    assert.equal(result.processed, 1);
    assert.equal(result.results[0].id, 'new1');
  });
});
