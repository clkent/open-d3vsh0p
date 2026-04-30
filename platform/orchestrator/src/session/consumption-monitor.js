class ConsumptionMonitor {
  constructor(config, initialState = {}) {
    this.budgetLimitUsd = config.budgetLimitUsd || 20;
    this.warningThresholdPct = config.warningThresholdPct || 80;
    this.timeLimitMs = config.timeLimitMs || 25200000;
    this.maxAgentInvocations = config.maxAgentInvocations || 50;
    this.windowEndTimeMs = config.windowEndTimeMs || null;

    this.totalCostUsd = initialState.totalCostUsd || 0;
    this.totalDurationMs = initialState.totalDurationMs || 0;
    this.agentInvocations = initialState.agentInvocations || 0;
    this.sessionStartTime = initialState.sessionStartTime || Date.now();
    this.cycleCostUsd = 0;

    this._pauseRequested = false;
    this._pauseReason = null;
    this._blockingItem = null;
    this._signalHandlers = null;
  }

  /**
   * Install signal handlers for graceful pause.
   * SIGINT (Ctrl+C) or SIGTERM sets the pause flag so the session
   * stops at the next natural boundary (between items/phases).
   */
  installSignalHandlers() {
    if (this._signalHandlers) return; // already installed

    const handler = () => {
      if (this._pauseRequested) {
        // Second signal = force exit
        console.log('\n  Force stopping — work in progress may be lost.');
        process.exit(1);
      }
      this._pauseRequested = true;
      this._pauseReason = 'user_paused';
      console.log('\n  Pause requested — finishing current work, then stopping cleanly.');
      console.log('  (Press Ctrl+C again to force stop immediately)\n');
    };

    this._signalHandlers = { SIGINT: handler, SIGTERM: handler };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }

  /**
   * Remove signal handlers (call on session end to restore default behavior).
   */
  removeSignalHandlers() {
    if (!this._signalHandlers) return;
    process.removeListener('SIGINT', this._signalHandlers.SIGINT);
    process.removeListener('SIGTERM', this._signalHandlers.SIGTERM);
    this._signalHandlers = null;
  }

  /**
   * Request a graceful pause programmatically.
   * @param {Object} [options]
   * @param {string} [options.reason] - Pause reason (default: 'user_paused')
   * @param {Object} [options.blockingItem] - Blocking item details ({ id, error })
   */
  requestPause(options = {}) {
    // If already paused by user signal (Ctrl+C), don't overwrite with a
    // programmatic reason — user_paused takes priority over blocking_park
    // to prevent entering BLOCKING_FIX from the wrong state.
    if (this._pauseRequested && this._pauseReason === 'user_paused') {
      return;
    }
    this._pauseRequested = true;
    this._pauseReason = options.reason || 'user_paused';
    this._blockingItem = options.blockingItem || null;
  }

  get pauseRequested() {
    return this._pauseRequested;
  }

  recordInvocation(costUsd, durationMs) {
    this.totalCostUsd += costUsd || 0;
    this.totalDurationMs += durationMs || 0;
    this.agentInvocations += 1;
    this.cycleCostUsd += costUsd || 0;
  }

  resetCycleCost() {
    const cost = this.cycleCostUsd;
    this.cycleCostUsd = 0;
    return cost;
  }

  getCycleCost() {
    return this.cycleCostUsd;
  }

  shouldStop() {
    if (this._pauseRequested) {
      const result = { stop: true, reason: this._pauseReason || 'user_paused' };
      if (this._blockingItem) result.blockingItem = this._blockingItem;
      return result;
    }

    if (this.totalCostUsd >= this.budgetLimitUsd) {
      return { stop: true, reason: 'budget_exhausted' };
    }

    const elapsed = Date.now() - this.sessionStartTime;
    if (elapsed >= this.timeLimitMs) {
      return { stop: true, reason: 'time_limit' };
    }

    if (this.agentInvocations >= this.maxAgentInvocations) {
      return { stop: true, reason: 'invocation_limit' };
    }

    if (this.windowEndTimeMs && Date.now() >= this.windowEndTimeMs) {
      return { stop: true, reason: 'window_end' };
    }

    return { stop: false };
  }

  shouldWarn() {
    const pct = (this.totalCostUsd / this.budgetLimitUsd) * 100;
    return pct >= this.warningThresholdPct;
  }

  getSnapshot() {
    return {
      totalCostUsd: Math.round(this.totalCostUsd * 100) / 100,
      totalDurationMs: this.totalDurationMs,
      agentInvocations: this.agentInvocations,
      budgetRemainingUsd: Math.round((this.budgetLimitUsd - this.totalCostUsd) * 100) / 100,
      budgetUsedPct: ((this.totalCostUsd / this.budgetLimitUsd) * 100).toFixed(1),
      elapsedMs: Date.now() - this.sessionStartTime
    };
  }

  canAffordAgent(estimatedCostUsd) {
    const remaining = this.budgetLimitUsd - this.totalCostUsd;
    return {
      ok: remaining >= estimatedCostUsd,
      remainingUsd: Math.round(remaining * 100) / 100,
      estimatedCostUsd
    };
  }

  /**
   * Clear a pause request so the orchestrator can resume.
   * Only clears the pause flag — budget/time limits are unaffected.
   */
  clearPause() {
    this._pauseRequested = false;
    this._pauseReason = null;
    this._blockingItem = null;
  }

  getStateForPersistence() {
    return {
      totalCostUsd: this.totalCostUsd,
      totalDurationMs: this.totalDurationMs,
      agentInvocations: this.agentInvocations
    };
  }
}

module.exports = { ConsumptionMonitor };
