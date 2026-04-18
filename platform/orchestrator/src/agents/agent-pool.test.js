const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { AgentPool, PERSONAS } = require('./agent-pool');

describe('AgentPool', () => {
  let pool;

  beforeEach(() => {
    pool = new AgentPool();
  });

  describe('constructor', () => {
    it('uses default PERSONAS when none provided', () => {
      assert.equal(pool.personas.length, PERSONAS.length);
      assert.deepEqual(pool.personas, PERSONAS);
    });

    it('accepts custom personas', () => {
      const custom = [{ name: 'Test', agentType: 'test-agent' }];
      const p = new AgentPool(custom);
      assert.equal(p.personas.length, 1);
      assert.equal(p.personas[0].name, 'Test');
    });
  });

  describe('assign', () => {
    it('returns an object with name and agentType from the pool', () => {
      const result = pool.assign();
      const validNames = PERSONAS.map(p => p.name);
      const validTypes = PERSONAS.map(p => p.agentType);
      assert.ok(validNames.includes(result.name), `${result.name} not in pool`);
      assert.ok(validTypes.includes(result.agentType), `${result.agentType} not in pool`);
    });

    it('returns a copy, not a reference to the original', () => {
      const result = pool.assign();
      const original = pool.personas.find(p => p.name === result.name);
      assert.notEqual(result, original);
    });

    it('selects from the persona pool', () => {
      const validNames = PERSONAS.map(p => p.name);
      for (let i = 0; i < 20; i++) {
        const result = pool.assign();
        assert.ok(validNames.includes(result.name), `${result.name} not in pool`);
      }
    });
  });

  describe('assignMany', () => {
    it('returns unique personas when count < pool size', () => {
      const results = pool.assignMany(2);
      assert.equal(results.length, 2);
      const names = results.map(r => r.name);
      assert.equal(new Set(names).size, 2, 'should be unique');
    });

    it('returns all personas shuffled when count === pool size', () => {
      const results = pool.assignMany(PERSONAS.length);
      assert.equal(results.length, PERSONAS.length);
      const names = results.map(r => r.name).sort();
      const expected = PERSONAS.map(p => p.name).sort();
      assert.deepEqual(names, expected);
    });

    it('includes all personas plus extras when count > pool size', () => {
      const count = PERSONAS.length + 2;
      const results = pool.assignMany(count);
      assert.equal(results.length, count);
      // All original personas should be present
      const names = results.map(r => r.name);
      for (const p of PERSONAS) {
        assert.ok(names.includes(p.name), `missing ${p.name}`);
      }
    });

    it('returns empty array for zero count', () => {
      const results = pool.assignMany(0);
      assert.deepEqual(results, []);
    });
  });

  describe('deterministic shuffle', () => {
    it('produces expected permutation with mocked Math.random', () => {
      const originalRandom = Math.random;
      // With random always 0: j = floor(0 * (i+1)) = 0, each swap is with index 0
      // Starting: [Jordan, Alex, Sam, Taylor] (all implementation-agent)
      // i=3: swap(3,0) -> [Taylor, Alex, Sam, Jordan]
      // i=2: swap(2,0) -> [Sam, Alex, Taylor, Jordan]
      // i=1: swap(1,0) -> [Alex, Sam, Taylor, Jordan]
      Math.random = () => 0;

      try {
        const results = pool.assignMany(PERSONAS.length);
        const names = results.map(r => r.name);
        assert.deepEqual(names, ['Alex', 'Sam', 'Taylor', 'Jordan']);
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe('names getter', () => {
    it('returns the expected persona names', () => {
      const names = pool.names;
      assert.deepEqual(names, ['Jordan', 'Alex', 'Sam', 'Taylor']);
    });

    it('has correct length', () => {
      assert.equal(pool.names.length, PERSONAS.length);
    });
  });
});
