const fs = require('fs/promises');
const path = require('path');

class SessionAggregator {
  constructor(logDir) {
    this.logDir = logDir;
  }

  /**
   * Load all session summaries from the log directory.
   */
  async loadSummaries() {
    const summaries = [];

    try {
      const files = await fs.readdir(this.logDir);
      const summaryFiles = files.filter(f => f.endsWith('-summary.json'));

      for (const file of summaryFiles) {
        try {
          const raw = await fs.readFile(path.join(this.logDir, file), 'utf-8');
          summaries.push(JSON.parse(raw));
        } catch {
          // Skip malformed summaries
        }
      }
    } catch {
      // Log dir doesn't exist yet
    }

    return summaries;
  }

  /**
   * Filter summaries by month (YYYY-MM format).
   */
  filterByMonth(summaries, yearMonth) {
    return summaries.filter(s => {
      const started = s.startedAt || s.completedAt || '';
      return started.startsWith(yearMonth);
    });
  }

  /**
   * Aggregate cost data from a set of summaries.
   */
  aggregateCosts(summaries) {
    if (summaries.length === 0) {
      return {
        totalCost: 0,
        sessionCount: 0,
        avgCostPerSession: 0,
        totalInvocations: 0,
        completedRequirements: 0,
        parkedRequirements: 0,
        costPerRequirement: 0
      };
    }

    let totalCost = 0;
    let totalInvocations = 0;
    let completedCount = 0;
    let parkedCount = 0;

    for (const s of summaries) {
      totalCost += s.totalCostUsd || 0;
      totalInvocations += s.agentInvocations || 0;

      if (s.results) {
        completedCount += (s.results.completed || []).length;
        parkedCount += (s.results.parked || []).length;
      }
    }

    return {
      totalCost: Math.round(totalCost * 100) / 100,
      sessionCount: summaries.length,
      avgCostPerSession: Math.round((totalCost / summaries.length) * 100) / 100,
      totalInvocations,
      completedRequirements: completedCount,
      parkedRequirements: parkedCount,
      costPerRequirement: completedCount > 0
        ? Math.round((totalCost / completedCount) * 100) / 100
        : 0
    };
  }

  /**
   * Generate a monthly cost report with month-over-month comparison.
   */
  async generateMonthlyCostReport() {
    const summaries = await this.loadSummaries();
    const now = new Date();

    // Current month
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentSummaries = this.filterByMonth(summaries, currentMonth);
    const currentCosts = this.aggregateCosts(currentSummaries);

    // Previous month
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevSummaries = this.filterByMonth(summaries, prevMonth);
    const prevCosts = this.aggregateCosts(prevSummaries);

    let monthOverMonthChange = null;
    if (prevCosts.totalCost > 0) {
      monthOverMonthChange = ((currentCosts.totalCost - prevCosts.totalCost) / prevCosts.totalCost) * 100;
    }

    return {
      currentMonth,
      previousMonth: prevMonth,
      cost: {
        ...currentCosts,
        previousMonth: prevCosts.totalCost > 0 ? prevCosts : null,
        monthOverMonthChange: monthOverMonthChange !== null
          ? Math.round(monthOverMonthChange * 10) / 10
          : null
      }
    };
  }

  /**
   * Find parked items that have been inactive for more than daysThreshold days.
   */
  async findStaleParkedItems(daysThreshold = 30) {
    const summaries = await this.loadSummaries();
    const now = Date.now();
    const thresholdMs = daysThreshold * 24 * 3600 * 1000;

    // Track the most recent activity for each parked item
    const parkedItems = new Map(); // requirementId -> { firstParkedAt, lastSeenAt }

    // Sort summaries chronologically
    const sorted = summaries.slice().sort((a, b) => {
      const ta = new Date(a.startedAt || a.completedAt || 0).getTime();
      const tb = new Date(b.startedAt || b.completedAt || 0).getTime();
      return ta - tb;
    });

    for (const s of sorted) {
      const sessionTime = new Date(s.completedAt || s.startedAt || 0).getTime();

      if (s.results) {
        // Items completed in this session are no longer parked
        for (const id of (s.results.completed || [])) {
          parkedItems.delete(id);
        }

        // Items parked in this session
        for (const id of (s.results.parked || [])) {
          const existing = parkedItems.get(id);
          if (existing) {
            existing.lastSeenAt = sessionTime;
          } else {
            parkedItems.set(id, { firstParkedAt: sessionTime, lastSeenAt: sessionTime });
          }
        }
      }
    }

    // Filter to stale items
    const stale = [];
    for (const [id, info] of parkedItems) {
      if (now - info.lastSeenAt > thresholdMs) {
        stale.push(id);
      }
    }

    return stale;
  }

  /**
   * Get the most recent session summary (for digest purposes).
   */
  async getMostRecentSummary() {
    const summaries = await this.loadSummaries();

    if (summaries.length === 0) return null;

    return summaries.reduce((latest, s) => {
      const t1 = new Date(latest.completedAt || latest.startedAt || 0).getTime();
      const t2 = new Date(s.completedAt || s.startedAt || 0).getTime();
      return t2 > t1 ? s : latest;
    });
  }
}

module.exports = { SessionAggregator };
