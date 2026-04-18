const fs = require('fs/promises');
const path = require('path');

const COLD_START_FALLBACK = 2.0;
const DEFAULT_MAX_SESSIONS = 5;
const TRIM_PERCENT = 0.1;

class CostEstimator {
  constructor(logDir, maxSessions = DEFAULT_MAX_SESSIONS) {
    this.logDir = logDir;
    this.maxSessions = maxSessions;
    this._averageCost = null;
    this._sessionCount = 0;
  }

  /**
   * Load session summaries and compute average cost per requirement.
   * Caches the result for the session.
   */
  async init() {
    const costs = await this._loadPerRequirementCosts();
    this._sessionCount = costs.sessionCount;

    if (costs.values.length === 0) {
      this._averageCost = COLD_START_FALLBACK;
      return;
    }

    this._averageCost = trimmedMean(costs.values, TRIM_PERCENT);
  }

  /**
   * Get the average cost per requirement (trimmed mean or fallback).
   */
  getAverageCostPerRequirement() {
    if (this._averageCost === null) {
      return COLD_START_FALLBACK;
    }
    return Math.round(this._averageCost * 100) / 100;
  }

  /**
   * Estimate the cost of executing a phase based on pending items.
   */
  estimatePhaseCost(phase) {
    let pendingCount = 0;
    for (const group of phase.groups) {
      for (const item of group.items) {
        if (item.status === 'pending') {
          pendingCount++;
        }
      }
    }
    return Math.round(pendingCount * this.getAverageCostPerRequirement() * 100) / 100;
  }

  /**
   * Predict whether the remaining budget is sufficient for the pending work.
   */
  predictSufficiency(remainingBudget, pendingItemCount) {
    const avgCost = this.getAverageCostPerRequirement();
    const estimatedCost = Math.round(pendingItemCount * avgCost * 100) / 100;
    const sufficient = estimatedCost <= remainingBudget;
    const confidence = this._getConfidence();

    return {
      sufficient,
      estimatedCost,
      remainingBudget: Math.round(remainingBudget * 100) / 100,
      confidence
    };
  }

  /**
   * Get the number of sessions used for estimation.
   */
  get sessionCount() {
    return this._sessionCount;
  }

  _getConfidence() {
    if (this._sessionCount < 3) return 'low';
    if (this._sessionCount < 10) return 'medium';
    return 'high';
  }

  async _loadPerRequirementCosts() {
    const values = [];
    let sessionCount = 0;

    try {
      const files = await fs.readdir(this.logDir);
      const summaryFiles = files
        .filter(f => f.endsWith('-summary.json'))
        .sort()
        .slice(-this.maxSessions);

      for (const file of summaryFiles) {
        try {
          const raw = await fs.readFile(path.join(this.logDir, file), 'utf-8');
          const summary = JSON.parse(raw);
          const microcycles = summary.completedMicrocycles || [];

          if (microcycles.length === 0) continue;

          sessionCount++;
          for (const mc of microcycles) {
            if (typeof mc.costUsd === 'number' && mc.costUsd > 0) {
              values.push(mc.costUsd);
            }
          }
        } catch {
          // Skip malformed summaries
        }
      }
    } catch {
      // Log dir doesn't exist yet
    }

    return { values, sessionCount };
  }
}

/**
 * Compute trimmed mean by dropping the top and bottom `trimPct` of values.
 */
function trimmedMean(values, trimPct) {
  if (values.length === 0) return 0;
  if (values.length <= 2) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimPct);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);

  if (trimmed.length === 0) {
    // Edge case: all values trimmed (very small array with high trim %)
    return sorted.reduce((a, b) => a + b, 0) / sorted.length;
  }

  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

// trimmedMean, COLD_START_FALLBACK exported for testing
module.exports = { CostEstimator, trimmedMean, COLD_START_FALLBACK };
