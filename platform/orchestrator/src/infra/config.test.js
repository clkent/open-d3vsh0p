const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');

describe('config', () => {
  // We need to re-require after mocking, so keep references
  let loadConfig, loadDefaults, deepMerge;
  let originalReadFile;

  beforeEach(() => {
    // Fresh require to pick up any mocks
    delete require.cache[require.resolve('./config')];
    ({ loadConfig, loadDefaults, deepMerge } = require('./config'));
  });

  describe('deepMerge', () => {
    it('returns a shallow copy of target', () => {
      const target = { a: 1 };
      const result = deepMerge(target, {});
      assert.deepEqual(result, { a: 1 });
      assert.notEqual(result, target);
    });

    it('overwrites scalar values from source', () => {
      const result = deepMerge({ a: 1, b: 2 }, { b: 99 });
      assert.equal(result.a, 1);
      assert.equal(result.b, 99);
    });

    it('recursively merges nested objects', () => {
      const result = deepMerge(
        { nested: { a: 1, b: 2 } },
        { nested: { b: 99, c: 3 } }
      );
      assert.deepEqual(result.nested, { a: 1, b: 99, c: 3 });
    });

    it('does not mutate the original target', () => {
      const target = { nested: { a: 1 } };
      deepMerge(target, { nested: { b: 2 } });
      assert.deepEqual(target.nested, { a: 1 });
    });

    it('overwrites arrays instead of merging them', () => {
      const result = deepMerge(
        { arr: [1, 2, 3] },
        { arr: [4, 5] }
      );
      assert.deepEqual(result.arr, [4, 5]);
    });

    it('allows null to overwrite a value', () => {
      const result = deepMerge({ a: 1 }, { a: null });
      assert.equal(result.a, null);
    });

    it('handles empty source', () => {
      const result = deepMerge({ a: 1 }, {});
      assert.deepEqual(result, { a: 1 });
    });

    it('handles empty target', () => {
      const result = deepMerge({}, { a: 1 });
      assert.deepEqual(result, { a: 1 });
    });
  });

  describe('loadDefaults', () => {
    it('loads defaults.json and returns expected default values', async () => {
      const defaults = await loadDefaults();
      assert.equal(defaults.budgetLimitUsd, 30);
      assert.deepEqual(defaults.retryLimits, { implementation: 3, implementationMaxAttempts: 7, testFix: 3, reviewFix: 2 });
      assert.equal(defaults.git.sessionBranchPrefix, 'devshop/session');
      assert.equal(defaults.parallelism.maxConcurrentGroups, 4);
      assert.equal(Object.keys(defaults.agents).length, 8);
    });

    it('includes healthCheck defaults', async () => {
      const defaults = await loadDefaults();
      assert.equal(typeof defaults.healthCheck, 'object');
      assert.deepEqual(defaults.healthCheck.commands, []);
      assert.equal(defaults.healthCheck.timeoutMs, 120000);
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no overrides', async () => {
      const config = await loadConfig({});
      assert.equal(config.budgetLimitUsd, 30);
      assert.deepEqual(config.retryLimits, { implementation: 3, implementationMaxAttempts: 7, testFix: 3, reviewFix: 2 });
    });

    it('merges project overrides from activeAgentsDir', async () => {
      // Save original readFile
      originalReadFile = fs.readFile;
      const realReadFile = originalReadFile;

      // Mock readFile to intercept override path
      fs.readFile = async (filePath, ...args) => {
        if (filePath.includes('orchestrator/config.json')) {
          return JSON.stringify({ budgetLimitUsd: 50, retryLimits: { implementation: 5 } });
        }
        return realReadFile(filePath, ...args);
      };

      // Re-require with mock in place
      delete require.cache[require.resolve('./config')];
      const { loadConfig: lc } = require('./config');

      const config = await lc({ activeAgentsDir: '/tmp/fake-agents' });
      assert.equal(config.budgetLimitUsd, 50);
      assert.equal(config.retryLimits.implementation, 5);
      // Unmodified defaults should still be present
      assert.equal(config.retryLimits.testFix, 3);

      fs.readFile = originalReadFile;
    });

    it('CLI budget/time override take highest priority', async () => {
      const config = await loadConfig({
        budgetLimitUsd: 100,
        timeLimitMs: 999
      });
      assert.equal(config.budgetLimitUsd, 100);
      assert.equal(config.timeLimitMs, 999);
    });

    it('handles missing override file gracefully', async () => {
      const config = await loadConfig({
        activeAgentsDir: '/tmp/definitely-does-not-exist-' + Date.now()
      });
      // Should fall back to defaults without throwing
      assert.equal(typeof config.budgetLimitUsd, 'number');
    });
  });
});
