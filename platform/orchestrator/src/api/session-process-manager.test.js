const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { SessionProcessManager } = require('./session-process-manager');

describe('SessionProcessManager', () => {
  let manager;
  const started = [];

  afterEach(() => {
    // Clean up any spawned processes
    if (manager) {
      manager.stopAll();
    }
    manager = null;
  });

  it('starts a process and tracks it', () => {
    manager = new SessionProcessManager();

    const result = manager.start('proj-test', { budget: 5 });
    // sessionId should be a non-empty string (format: api-<timestamp>)
    assert.match(result.sessionId, /^api-\d+$/);
    assert.ok(result.pid > 0, 'pid should be a positive integer');
    // The entry should be tracked
    const info = manager.getInfo('proj-test');
    assert.equal(info.sessionId, result.sessionId);
    assert.equal(info.pid, result.pid);
  });

  it('returns null for unknown project info', () => {
    manager = new SessionProcessManager();
    const info = manager.getInfo('nonexistent');
    assert.equal(info, null);
  });

  it('isRunning returns false for unknown project', () => {
    manager = new SessionProcessManager();
    assert.equal(manager.isRunning('nonexistent'), false);
  });

  it('stop returns false for unknown project', () => {
    manager = new SessionProcessManager();
    assert.equal(manager.stop('nonexistent'), false);
  });

  it('tracks activeCount', () => {
    manager = new SessionProcessManager();
    assert.equal(manager.activeCount, 0);
  });

  it('stopAll does not throw when empty', () => {
    manager = new SessionProcessManager();
    assert.doesNotThrow(() => manager.stopAll());
  });
});
