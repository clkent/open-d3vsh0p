/**
 * TokenEstimator — placeholder for the token-based session estimator.
 *
 * Replaces the removed dollar-based CostEstimator (session/cost-estimator.js,
 * removed in remove-sdk-orchestrator). The old estimator averaged per-item
 * dollar costs from `{sessionId}-summary.json` files that the deleted SDK
 * orchestrator wrote; Morgan's CLI sessions produce no summaries, so both
 * the data source and the dollar framing are gone.
 *
 * Planned design (see roadmap item `token-estimator`):
 * - Estimate in TOKENS, not dollars — clearer, model-price independent
 * - Data source TBD: Claude Code session transcripts / usage output rather
 *   than orchestrator-written summaries
 * - Consumers to re-enable when implemented:
 *   - `run` pre-session estimate ("~N tokens for M pending items")
 *   - `status` remaining-work estimate
 *   - monthly cadence review (currently disabled in commands/cadence.js)
 *
 * All methods are intentionally inert stubs. Wire nothing to this class
 * until the real implementation lands.
 */
class TokenEstimator {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.sessionCount = 0;
  }

  /** Load historical usage data. Stub: no data source yet. */
  async init() {
    this.sessionCount = 0;
  }

  /**
   * Estimate tokens for the remaining pending items.
   * Stub: returns null (no estimate available) — callers must treat null
   * as "skip the estimate display".
   * @param {number} pendingCount
   * @returns {{ estimatedTokens: number, confidence: string } | null}
   */
  estimateRemaining(pendingCount) { // eslint-disable-line no-unused-vars
    return null;
  }
}

module.exports = { TokenEstimator };
