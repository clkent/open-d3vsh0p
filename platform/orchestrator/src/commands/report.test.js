const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { readQueue } = require('../runners/report-processor');

describe('reportCommand', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-cmd-test-'));
    await fs.mkdir(path.join(tmpDir, 'orchestrator'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // The reportCommand requires interactive readline input, so we test
  // the underlying report-processor functions instead for unit tests.
  // Integration tests for the CLI would require stdin mocking.

  it('appendReport creates queue file with correct structure', async () => {
    const { appendReport } = require('../runners/report-processor');
    const queuePath = path.join(tmpDir, 'orchestrator', 'reported-issues.json');

    const report = await appendReport(queuePath, {
      type: 'bug',
      description: 'The plants page throws a 500 error'
    });

    assert.equal(report.type, 'bug');
    assert.equal(report.status, 'pending');
    assert.ok(report.id.length > 0);

    const queue = await readQueue(queuePath);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].description, 'The plants page throws a 500 error');
  });

  it('appendReport supports feature type', async () => {
    const { appendReport } = require('../runners/report-processor');
    const queuePath = path.join(tmpDir, 'orchestrator', 'reported-issues.json');

    const report = await appendReport(queuePath, {
      type: 'feature',
      description: 'Add plant search with filtering'
    });

    assert.equal(report.type, 'feature');
    assert.equal(report.status, 'pending');
  });

  it('readQueue returns empty array for missing file (status mode)', async () => {
    const queuePath = path.join(tmpDir, 'orchestrator', 'reported-issues.json');
    const queue = await readQueue(queuePath);
    assert.deepEqual(queue, []);
  });

  it('readQueue returns reports with all expected fields for status display', async () => {
    const { appendReport } = require('../runners/report-processor');
    const queuePath = path.join(tmpDir, 'orchestrator', 'reported-issues.json');

    await appendReport(queuePath, { type: 'bug', description: 'broken page' });
    await appendReport(queuePath, { type: 'feature', description: 'new feature' });

    const queue = await readQueue(queuePath);
    assert.equal(queue.length, 2);

    assert.equal(queue[0].type, 'bug');
    assert.equal(queue[0].description, 'broken page');
    assert.equal(queue[0].status, 'pending');
    assert.match(queue[0].id, /^[a-f0-9-]+$/);
    assert.match(queue[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);

    assert.equal(queue[1].type, 'feature');
    assert.equal(queue[1].description, 'new feature');
  });
});
