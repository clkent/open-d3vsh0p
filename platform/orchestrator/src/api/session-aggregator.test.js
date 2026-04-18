const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { SessionAggregator } = require('./session-aggregator');

describe('SessionAggregator', () => {
  let tmpDir;
  let aggregator;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aggregator-test-'));
    aggregator = new SessionAggregator(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeSummary(filename, data) {
    await fs.writeFile(path.join(tmpDir, filename), JSON.stringify(data));
  }

  describe('loadSummaries', () => {
    it('returns empty array for empty directory', async () => {
      const result = await aggregator.loadSummaries();
      assert.deepEqual(result, []);
    });

    it('returns empty array for missing directory', async () => {
      const a = new SessionAggregator('/tmp/does-not-exist-' + Date.now());
      const result = await a.loadSummaries();
      assert.deepEqual(result, []);
    });

    it('loads valid summary files', async () => {
      await writeSummary('sess-001-summary.json', { sessionId: 's1', totalCostUsd: 1.5 });
      await writeSummary('sess-002-summary.json', { sessionId: 's2', totalCostUsd: 2.0 });
      const result = await aggregator.loadSummaries();
      assert.equal(result.length, 2);
    });

    it('skips malformed JSON files', async () => {
      await writeSummary('good-summary.json', { sessionId: 's1' });
      await fs.writeFile(path.join(tmpDir, 'bad-summary.json'), 'not valid json{{{');
      const result = await aggregator.loadSummaries();
      assert.equal(result.length, 1);
      assert.equal(result[0].sessionId, 's1');
    });

    it('ignores non-summary files', async () => {
      await writeSummary('sess-001-summary.json', { sessionId: 's1' });
      await fs.writeFile(path.join(tmpDir, 'sess-001.jsonl'), 'log data');
      await fs.writeFile(path.join(tmpDir, 'other.txt'), 'random');
      const result = await aggregator.loadSummaries();
      assert.equal(result.length, 1);
    });
  });

  describe('filterByMonth', () => {
    const summaries = [
      { sessionId: 's1', startedAt: '2026-01-15T10:00:00Z' },
      { sessionId: 's2', startedAt: '2026-01-20T12:00:00Z' },
      { sessionId: 's3', startedAt: '2026-02-01T08:00:00Z' },
      { sessionId: 's4', completedAt: '2026-01-31T23:59:59Z' }
    ];

    it('filters by YYYY-MM matching startedAt', () => {
      const result = aggregator.filterByMonth(summaries, '2026-01');
      assert.equal(result.length, 3); // s1, s2, s4 (s4 falls back to completedAt starting with 2026-01)
    });

    it('returns empty for no matches', () => {
      const result = aggregator.filterByMonth(summaries, '2025-12');
      assert.equal(result.length, 0);
    });

    it('falls back to completedAt when startedAt is missing', () => {
      const sums = [{ sessionId: 'x', completedAt: '2026-03-15T00:00:00Z' }];
      const result = aggregator.filterByMonth(sums, '2026-03');
      assert.equal(result.length, 1);
    });
  });

  describe('aggregateCosts', () => {
    it('returns zeroed structure for empty input', () => {
      const result = aggregator.aggregateCosts([]);
      assert.equal(result.totalCost, 0);
      assert.equal(result.sessionCount, 0);
      assert.equal(result.avgCostPerSession, 0);
      assert.equal(result.totalInvocations, 0);
      assert.equal(result.completedRequirements, 0);
      assert.equal(result.parkedRequirements, 0);
      assert.equal(result.costPerRequirement, 0);
    });

    it('sums costs and invocations', () => {
      const summaries = [
        { totalCostUsd: 5.555, agentInvocations: 3, results: { completed: ['a'], parked: [] } },
        { totalCostUsd: 4.445, agentInvocations: 2, results: { completed: ['b', 'c'], parked: ['d'] } }
      ];
      const result = aggregator.aggregateCosts(summaries);
      assert.equal(result.totalCost, 10.00);
      assert.equal(result.sessionCount, 2);
      assert.equal(result.avgCostPerSession, 5.00);
      assert.equal(result.totalInvocations, 5);
      assert.equal(result.completedRequirements, 3);
      assert.equal(result.parkedRequirements, 1);
    });

    it('rounds to 2 decimal places', () => {
      const summaries = [
        { totalCostUsd: 1.111, agentInvocations: 1, results: { completed: ['a'], parked: [] } },
        { totalCostUsd: 2.222, agentInvocations: 1, results: { completed: ['b'], parked: [] } }
      ];
      const result = aggregator.aggregateCosts(summaries);
      assert.equal(result.totalCost, 3.33);
      assert.equal(result.avgCostPerSession, 1.67);
      assert.equal(result.costPerRequirement, 1.67);
    });

    it('returns costPerRequirement=0 when no completed', () => {
      const summaries = [
        { totalCostUsd: 5.0, agentInvocations: 1, results: { completed: [], parked: ['x'] } }
      ];
      const result = aggregator.aggregateCosts(summaries);
      assert.equal(result.costPerRequirement, 0);
    });

    it('handles missing results gracefully', () => {
      const summaries = [{ totalCostUsd: 3.0, agentInvocations: 1 }];
      const result = aggregator.aggregateCosts(summaries);
      assert.equal(result.totalCost, 3.0);
      assert.equal(result.completedRequirements, 0);
    });
  });

  describe('findStaleParkedItems', () => {
    it('returns empty for empty directory', async () => {
      const result = await aggregator.findStaleParkedItems();
      assert.deepEqual(result, []);
    });

    it('identifies items parked longer than threshold', async () => {
      const oldDate = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
      await writeSummary('old-summary.json', {
        startedAt: oldDate,
        completedAt: oldDate,
        results: { completed: [], parked: ['stale-item'] }
      });
      const result = await aggregator.findStaleParkedItems(30);
      assert.deepEqual(result, ['stale-item']);
    });

    it('excludes items completed in a later session', async () => {
      const oldDate = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
      const recentDate = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
      await writeSummary('a-old-summary.json', {
        startedAt: oldDate,
        completedAt: oldDate,
        results: { completed: [], parked: ['item-1'] }
      });
      await writeSummary('b-recent-summary.json', {
        startedAt: recentDate,
        completedAt: recentDate,
        results: { completed: ['item-1'], parked: [] }
      });
      const result = await aggregator.findStaleParkedItems(30);
      assert.deepEqual(result, []);
    });

    it('respects custom daysThreshold', async () => {
      const date = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
      await writeSummary('sess-summary.json', {
        startedAt: date,
        completedAt: date,
        results: { completed: [], parked: ['recent-park'] }
      });
      // Default 30 days: not stale
      const result30 = await aggregator.findStaleParkedItems(30);
      assert.deepEqual(result30, []);
      // Custom 5 days: stale
      const result5 = await aggregator.findStaleParkedItems(5);
      assert.deepEqual(result5, ['recent-park']);
    });
  });

  describe('getMostRecentSummary', () => {
    it('returns null for empty directory', async () => {
      const result = await aggregator.getMostRecentSummary();
      assert.equal(result, null);
    });

    it('returns the latest summary by completedAt', async () => {
      await writeSummary('a-summary.json', {
        sessionId: 'old',
        completedAt: '2026-01-01T00:00:00Z'
      });
      await writeSummary('b-summary.json', {
        sessionId: 'new',
        completedAt: '2026-02-15T00:00:00Z'
      });
      const result = await aggregator.getMostRecentSummary();
      assert.equal(result.sessionId, 'new');
    });

    it('uses startedAt as fallback when completedAt is missing', async () => {
      await writeSummary('a-summary.json', {
        sessionId: 'first',
        startedAt: '2026-01-01T00:00:00Z'
      });
      await writeSummary('b-summary.json', {
        sessionId: 'second',
        startedAt: '2026-03-01T00:00:00Z'
      });
      const result = await aggregator.getMostRecentSummary();
      assert.equal(result.sessionId, 'second');
    });
  });
});
