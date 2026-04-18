const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { CostEstimator, trimmedMean, COLD_START_FALLBACK } = require('./cost-estimator');

describe('trimmedMean', () => {
  it('returns 0 for empty array', () => {
    assert.equal(trimmedMean([], 0.1), 0);
  });

  it('returns average for 1-2 values (no trimming)', () => {
    assert.equal(trimmedMean([5], 0.1), 5);
    assert.equal(trimmedMean([4, 6], 0.1), 5);
  });

  it('trims top and bottom 10%', () => {
    // 10 values: trim 1 from each end
    const values = [100, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = trimmedMean(values, 0.1);
    // After trim: [2,3,4,5,6,7,8,9] → mean = 44/8 = 5.5
    assert.equal(result, 5.5);
  });
});

describe('CostEstimator', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-est-'));
  });

  async function writeSummary(name, completedMicrocycles) {
    await fs.writeFile(
      path.join(tmpDir, `${name}-summary.json`),
      JSON.stringify({ completedMicrocycles })
    );
  }

  describe('getAverageCostPerRequirement', () => {
    it('returns trimmed mean with sufficient history', async () => {
      await writeSummary('session-1', [
        { costUsd: 1.0 }, { costUsd: 1.5 }
      ]);
      await writeSummary('session-2', [
        { costUsd: 1.2 }, { costUsd: 1.8 }
      ]);
      await writeSummary('session-3', [
        { costUsd: 1.1 }, { costUsd: 1.4 }
      ]);

      const est = new CostEstimator(tmpDir);
      await est.init();
      const avg = est.getAverageCostPerRequirement();
      // 6 values [1.0, 1.1, 1.2, 1.4, 1.5, 1.8], trim 0 (floor(6*0.1)=0), mean = 8.0/6 ≈ 1.33
      assert.equal(avg, Math.round((1.0 + 1.1 + 1.2 + 1.4 + 1.5 + 1.8) / 6 * 100) / 100);
      assert.equal(est.sessionCount, 3);
    });

    it('returns real average with fewer than 3 sessions', async () => {
      await writeSummary('session-1', [
        { costUsd: 1.0 }
      ]);

      const est = new CostEstimator(tmpDir);
      await est.init();
      assert.equal(est.sessionCount, 1);
      assert.equal(est.getAverageCostPerRequirement(), 1.0);
    });

    it('returns cold-start fallback when no sessions exist', async () => {
      const est = new CostEstimator(tmpDir);
      await est.init();
      assert.equal(est.getAverageCostPerRequirement(), COLD_START_FALLBACK);
      assert.equal(est.sessionCount, 0);
    });

    it('excludes sessions with no completed microcycles', async () => {
      await writeSummary('session-1', []);
      await writeSummary('session-2', [{ costUsd: 1.5 }]);
      await writeSummary('session-3', [{ costUsd: 2.0 }]);
      await writeSummary('session-4', [{ costUsd: 1.0 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();
      assert.equal(est.sessionCount, 3); // empty session excluded
    });

    it('only reads last N sessions', async () => {
      for (let i = 0; i < 10; i++) {
        await writeSummary(`session-${String(i).padStart(2, '0')}`, [
          { costUsd: i + 1 }
        ]);
      }

      const est = new CostEstimator(tmpDir, 3);
      await est.init();
      // Should only read sessions 07, 08, 09 (last 3 files sorted)
      assert.ok(est.sessionCount <= 3);
    });
  });

  describe('estimatePhaseCost', () => {
    it('estimates cost based on pending items', async () => {
      await writeSummary('session-1', [{ costUsd: 1.5 }, { costUsd: 1.5 }]);
      await writeSummary('session-2', [{ costUsd: 1.5 }, { costUsd: 1.5 }]);
      await writeSummary('session-3', [{ costUsd: 1.5 }, { costUsd: 1.5 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const phase = {
        groups: [{
          items: [
            { status: 'pending' },
            { status: 'pending' },
            { status: 'complete' },
            { status: 'pending' }
          ]
        }]
      };

      const cost = est.estimatePhaseCost(phase);
      assert.equal(cost, 4.5); // 3 pending × $1.50
    });

    it('returns 0 for fully complete phase', async () => {
      const est = new CostEstimator(tmpDir);
      await est.init();

      const phase = {
        groups: [{
          items: [
            { status: 'complete' },
            { status: 'parked' }
          ]
        }]
      };

      assert.equal(est.estimatePhaseCost(phase), 0);
    });
  });

  describe('predictSufficiency', () => {
    it('returns sufficient when budget covers estimated cost', async () => {
      await writeSummary('session-1', [{ costUsd: 1.5 }]);
      await writeSummary('session-2', [{ costUsd: 1.5 }]);
      await writeSummary('session-3', [{ costUsd: 1.5 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const result = est.predictSufficiency(15, 5);
      assert.equal(result.sufficient, true);
      assert.equal(result.estimatedCost, 7.5);
      assert.equal(result.remainingBudget, 15);
    });

    it('returns insufficient when budget is too low', async () => {
      await writeSummary('session-1', [{ costUsd: 1.5 }]);
      await writeSummary('session-2', [{ costUsd: 1.5 }]);
      await writeSummary('session-3', [{ costUsd: 1.5 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const result = est.predictSufficiency(3, 5);
      assert.equal(result.sufficient, false);
      assert.equal(result.estimatedCost, 7.5);
    });

    it('returns low confidence with fewer than 3 sessions', async () => {
      const est = new CostEstimator(tmpDir);
      await est.init();

      const result = est.predictSufficiency(10, 3);
      assert.equal(result.confidence, 'low');
    });

    it('returns medium confidence with 3-9 sessions', async () => {
      for (let i = 0; i < 5; i++) {
        await writeSummary(`session-${i}`, [{ costUsd: 1.0 }]);
      }

      const est = new CostEstimator(tmpDir, 10);
      await est.init();

      const result = est.predictSufficiency(10, 3);
      assert.equal(result.confidence, 'medium');
    });

    it('returns high confidence with 10+ sessions', async () => {
      for (let i = 0; i < 12; i++) {
        await writeSummary(`session-${String(i).padStart(2, '0')}`, [{ costUsd: 1.0 }]);
      }

      const est = new CostEstimator(tmpDir, 20);
      await est.init();

      const result = est.predictSufficiency(10, 3);
      assert.equal(result.confidence, 'high');
    });
  });

  describe('pre-phase budget check logic', () => {
    // These tests verify the pattern used by ParallelOrchestrator._checkPhaseBudget:
    // It combines CostEstimator.predictSufficiency with ConsumptionMonitor.getSnapshot
    // to decide whether to warn about insufficient budget.

    function makePhase(pendingCount, completeCount = 0) {
      const items = [];
      for (let i = 0; i < pendingCount; i++) items.push({ status: 'pending' });
      for (let i = 0; i < completeCount; i++) items.push({ status: 'complete' });
      return { number: 'I', label: 'Test Phase', groups: [{ items }] };
    }

    it('does not warn when budget is sufficient', async () => {
      await writeSummary('session-1', [{ costUsd: 2.0 }]);
      await writeSummary('session-2', [{ costUsd: 2.0 }]);
      await writeSummary('session-3', [{ costUsd: 2.0 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const phase = makePhase(3);
      const remainingBudget = 20; // plenty of budget
      const budgetUsedPct = 30;   // only 30% used

      const prediction = est.predictSufficiency(remainingBudget, 3);
      const shouldWarn = !prediction.sufficient && budgetUsedPct > 90;

      assert.equal(prediction.sufficient, true);
      assert.equal(shouldWarn, false);
    });

    it('does not warn when insufficient but early in session (< 90% consumed)', async () => {
      await writeSummary('session-1', [{ costUsd: 5.0 }]);
      await writeSummary('session-2', [{ costUsd: 5.0 }]);
      await writeSummary('session-3', [{ costUsd: 5.0 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const phase = makePhase(10);
      const remainingBudget = 8;  // not enough for 10 × $5 = $50
      const budgetUsedPct = 20;   // only 20% used — too early to warn

      const prediction = est.predictSufficiency(remainingBudget, 10);
      const shouldWarn = !prediction.sufficient && budgetUsedPct > 90;

      assert.equal(prediction.sufficient, false);
      assert.equal(shouldWarn, false); // no warning — still early
    });

    it('warns when insufficient and late in session (> 90% consumed)', async () => {
      await writeSummary('session-1', [{ costUsd: 3.0 }]);
      await writeSummary('session-2', [{ costUsd: 3.0 }]);
      await writeSummary('session-3', [{ costUsd: 3.0 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const phase = makePhase(5);
      const remainingBudget = 2;  // not enough for 5 × $3 = $15
      const budgetUsedPct = 93;   // > 90% consumed

      const prediction = est.predictSufficiency(remainingBudget, 5);
      const shouldWarn = !prediction.sufficient && budgetUsedPct > 90;

      assert.equal(prediction.sufficient, false);
      assert.equal(shouldWarn, true);
      assert.equal(prediction.estimatedCost, 15);
      assert.equal(prediction.remainingBudget, 2);
    });

    it('skips check when phase has no pending items', async () => {
      await writeSummary('session-1', [{ costUsd: 2.0 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const phase = makePhase(0, 3); // all complete
      const cost = est.estimatePhaseCost(phase);
      assert.equal(cost, 0); // no pending → no cost → no warning needed
    });
  });

  describe('output formatting', () => {
    // Verifies the format strings used by commands/run.js and commands/status.js

    it('formats run.js estimate line correctly with history', async () => {
      await writeSummary('session-1', [{ costUsd: 2.5 }]);
      await writeSummary('session-2', [{ costUsd: 2.5 }]);
      await writeSummary('session-3', [{ costUsd: 2.5 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const pendingCount = 4;
      const budget = 30;
      const prediction = est.predictSufficiency(budget, pendingCount);

      // This is the exact format from run.js line 118
      const line = `  Estimate:   $${prediction.estimatedCost.toFixed(2)} (${pendingCount} pending, confidence: ${prediction.confidence})`;

      assert.match(line, /\$\d+\.\d{2}/);
      assert.match(line, /\d+ pending/);
      assert.match(line, /confidence: (low|medium|high)/);
      assert.ok(line.includes('$10.00'));
      assert.ok(line.includes('4 pending'));
      assert.ok(line.includes('confidence: medium'));
    });

    it('formats status.js cost section correctly with history', async () => {
      await writeSummary('session-1', [{ costUsd: 1.75 }, { costUsd: 2.25 }]);
      await writeSummary('session-2', [{ costUsd: 1.75 }, { costUsd: 2.25 }]);
      await writeSummary('session-3', [{ costUsd: 1.75 }, { costUsd: 2.25 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const pendingCount = 6;
      const avgCost = est.getAverageCostPerRequirement();
      const totalEstimate = Math.round(pendingCount * avgCost * 100) / 100;

      // These are the exact formats from status.js lines 70-71
      const line1 = `    Avg cost/req: $${avgCost.toFixed(2)} (from ${est.sessionCount} session(s))`;
      const line2 = `    Remaining:    $${totalEstimate.toFixed(2)} est. (${pendingCount} pending items)`;

      assert.match(line1, /\$\d+\.\d{2}/);
      assert.match(line1, /from \d+ session\(s\)/);
      assert.match(line2, /\$\d+\.\d{2} est\./);
      assert.match(line2, /\d+ pending items/);
      assert.equal(est.sessionCount, 3);
      assert.ok(avgCost > 0);
      assert.ok(totalEstimate > 0);
    });

    it('does not display estimate when no history exists', async () => {
      const est = new CostEstimator(tmpDir);
      await est.init();

      // run.js and status.js both gate on sessionCount >= 1
      assert.equal(est.sessionCount, 0);
      // With 0 sessions, commands skip the estimate display entirely
      // The cold-start fallback is only used internally, not shown to the user
      assert.equal(est.getAverageCostPerRequirement(), COLD_START_FALLBACK);
    });

    it('estimatePhaseCost returns 0 when no pending items', async () => {
      await writeSummary('session-1', [{ costUsd: 2.0 }]);

      const est = new CostEstimator(tmpDir);
      await est.init();

      const phase = {
        groups: [{ items: [{ status: 'complete' }, { status: 'complete' }] }]
      };
      assert.equal(est.estimatePhaseCost(phase), 0);
    });
  });
});
