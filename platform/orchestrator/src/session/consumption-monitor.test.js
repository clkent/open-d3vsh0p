const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ConsumptionMonitor } = require('./consumption-monitor');

describe('ConsumptionMonitor', () => {
  let monitor;
  const baseConfig = {
    budgetLimitUsd: 10,
    warningThresholdPct: 80,
    timeLimitMs: 60000,
    maxAgentInvocations: 5,
    windowEndTimeMs: null
  };

  beforeEach(() => {
    monitor = new ConsumptionMonitor(baseConfig, { sessionStartTime: Date.now() });
  });

  describe('recordInvocation', () => {
    it('accumulates cost, duration, and count', () => {
      monitor.recordInvocation(1.5, 1000);
      monitor.recordInvocation(2.0, 2000);

      assert.equal(monitor.totalCostUsd, 3.5);
      assert.equal(monitor.totalDurationMs, 3000);
      assert.equal(monitor.agentInvocations, 2);
    });

    it('handles null/undefined cost and duration', () => {
      monitor.recordInvocation(null, undefined);

      assert.equal(monitor.totalCostUsd, 0);
      assert.equal(monitor.totalDurationMs, 0);
      assert.equal(monitor.agentInvocations, 1);
    });

    it('accumulates cycle cost alongside total cost', () => {
      monitor.recordInvocation(1.0, 100);
      monitor.recordInvocation(2.0, 200);

      assert.equal(monitor.cycleCostUsd, 3.0);
      assert.equal(monitor.totalCostUsd, 3.0);
    });
  });

  describe('shouldStop', () => {
    it('returns budget_exhausted when cost >= budget', () => {
      monitor.recordInvocation(10, 100);

      const result = monitor.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'budget_exhausted');
    });

    it('returns invocation_limit when count >= max', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordInvocation(0.1, 100);
      }

      const result = monitor.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'invocation_limit');
    });

    it('returns time_limit when elapsed >= limit', () => {
      // Create monitor with session start far in the past
      const m = new ConsumptionMonitor(baseConfig, {
        sessionStartTime: Date.now() - 120000
      });

      const result = m.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'time_limit');
    });

    it('returns window_end when past window', () => {
      const m = new ConsumptionMonitor(
        { ...baseConfig, windowEndTimeMs: Date.now() - 1000 },
        { sessionStartTime: Date.now() }
      );

      const result = m.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'window_end');
    });

    it('returns { stop: false } when within all limits', () => {
      monitor.recordInvocation(1, 100);

      const result = monitor.shouldStop();
      assert.deepEqual(result, { stop: false });
    });

    it('returns user_paused when pause is requested', () => {
      monitor.requestPause();

      const result = monitor.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'user_paused');
    });

    it('user_paused takes priority over other checks', () => {
      monitor.requestPause();
      // Also exceed budget — pause should still be the reason
      monitor.recordInvocation(20, 100);

      const result = monitor.shouldStop();
      assert.equal(result.reason, 'user_paused');
    });
  });

  describe('requestPause / pauseRequested', () => {
    it('pauseRequested is false by default', () => {
      assert.equal(monitor.pauseRequested, false);
    });

    it('requestPause sets pauseRequested to true', () => {
      monitor.requestPause();
      assert.equal(monitor.pauseRequested, true);
    });

    it('requestPause without arguments returns user_paused reason', () => {
      monitor.requestPause();
      const result = monitor.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'user_paused');
      assert.equal(result.blockingItem, undefined);
    });

    it('requestPause with blocking_park reason returns blocking_park and blockingItem', () => {
      const blockingItem = { id: 'REQ-1', error: 'missing component' };
      monitor.requestPause({ reason: 'blocking_park', blockingItem });

      const result = monitor.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'blocking_park');
      assert.deepEqual(result.blockingItem, { id: 'REQ-1', error: 'missing component' });
    });

    it('requestPause with custom reason but no blockingItem omits blockingItem', () => {
      monitor.requestPause({ reason: 'blocking_park' });

      const result = monitor.shouldStop();
      assert.equal(result.reason, 'blocking_park');
      assert.equal(result.blockingItem, undefined);
    });

    it('user_paused signal is not overwritten by programmatic blocking_park', () => {
      // Simulate Ctrl+C first (signal handler sets _pauseRequested + _pauseReason)
      monitor._pauseRequested = true;
      monitor._pauseReason = 'user_paused';

      // Then a blocking park comes in from an agent — should be ignored
      monitor.requestPause({ reason: 'blocking_park', blockingItem: { id: 'REQ-1', error: 'fail' } });

      const result = monitor.shouldStop();
      assert.equal(result.stop, true);
      assert.equal(result.reason, 'user_paused');
      assert.equal(result.blockingItem, undefined);
    });

    it('blocking_park is accepted when no prior user pause', () => {
      // No prior pause — blocking_park should work normally
      monitor.requestPause({ reason: 'blocking_park', blockingItem: { id: 'REQ-2', error: 'missing dep' } });

      const result = monitor.shouldStop();
      assert.equal(result.reason, 'blocking_park');
      assert.equal(result.blockingItem.id, 'REQ-2');
    });
  });

  describe('shouldWarn', () => {
    it('returns true at 80% threshold', () => {
      monitor.recordInvocation(8, 100);

      assert.equal(monitor.shouldWarn(), true);
    });

    it('returns false below threshold', () => {
      monitor.recordInvocation(7, 100);

      assert.equal(monitor.shouldWarn(), false);
    });
  });

  describe('resetCycleCost', () => {
    it('returns current cycle cost and resets to zero', () => {
      monitor.recordInvocation(3.5, 100);
      monitor.recordInvocation(1.5, 100);

      const cost = monitor.resetCycleCost();
      assert.equal(cost, 5.0);
      assert.equal(monitor.cycleCostUsd, 0);

      // Total cost should be unaffected
      assert.equal(monitor.totalCostUsd, 5.0);
    });
  });

  describe('canAffordAgent', () => {
    it('returns ok:true when remaining budget exceeds estimated cost', () => {
      monitor.recordInvocation(3, 100);
      const result = monitor.canAffordAgent(5);
      assert.equal(result.ok, true);
      assert.equal(result.remainingUsd, 7);
      assert.equal(result.estimatedCostUsd, 5);
    });

    it('returns ok:false when remaining budget is less than estimated cost', () => {
      monitor.recordInvocation(8, 100);
      const result = monitor.canAffordAgent(5);
      assert.equal(result.ok, false);
      assert.equal(result.remainingUsd, 2);
      assert.equal(result.estimatedCostUsd, 5);
    });

    it('returns ok:true when remaining exactly equals estimated cost', () => {
      monitor.recordInvocation(5, 100);
      const result = monitor.canAffordAgent(5);
      assert.equal(result.ok, true);
      assert.equal(result.remainingUsd, 5);
    });

    it('rounds remainingUsd to 2 decimal places', () => {
      monitor.recordInvocation(3.333, 100);
      const result = monitor.canAffordAgent(1);
      assert.equal(result.remainingUsd, 6.67);
    });
  });

  describe('getSnapshot', () => {
    it('returns all expected fields', () => {
      monitor.recordInvocation(2.555, 1000);

      const snap = monitor.getSnapshot();

      assert.equal(snap.totalCostUsd, 2.56); // rounded
      assert.equal(snap.totalDurationMs, 1000);
      assert.equal(snap.agentInvocations, 1);
      assert.equal(snap.budgetRemainingUsd, 7.45); // 10 - 2.555 rounded
      assert.equal(snap.budgetUsedPct, '25.6'); // 2.555/10 * 100
      assert.ok(snap.elapsedMs >= 0, 'elapsedMs should be non-negative');
    });
  });
});
