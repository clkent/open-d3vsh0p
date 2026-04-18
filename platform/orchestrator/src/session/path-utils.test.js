const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { getOrchestratorPaths } = require('./path-utils');

describe('path-utils', () => {
  describe('getOrchestratorPaths', () => {
    it('returns stateDir and logsDir based on activeAgentsDir', () => {
      const result = getOrchestratorPaths({ activeAgentsDir: '/agents' });
      assert.equal(result.stateDir, path.join('/agents', 'orchestrator'));
      assert.equal(result.logsDir, path.join('/agents', 'orchestrator', 'logs'));
    });

    it('handles nested activeAgentsDir', () => {
      const result = getOrchestratorPaths({ activeAgentsDir: '/home/user/devshop/active-agents' });
      assert.equal(result.stateDir, '/home/user/devshop/active-agents/orchestrator');
      assert.equal(result.logsDir, '/home/user/devshop/active-agents/orchestrator/logs');
    });

    it('returns object with exactly two keys', () => {
      const result = getOrchestratorPaths({ activeAgentsDir: '/test' });
      assert.deepEqual(Object.keys(result).sort(), ['logsDir', 'stateDir']);
    });
  });
});
