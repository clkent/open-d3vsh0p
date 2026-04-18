const { extractJson } = require('../infra/json-extractor');

const SCORE_DIMENSIONS = ['spec_adherence', 'test_coverage', 'code_quality', 'security', 'simplicity', 'implementation_authenticity'];

class ReviewParser {
  /**
   * Parse review output from the principal-engineer agent.
   * Extracts structured JSON scoring if present, falls back to string matching.
   *
   * Returns: {
   *   decision: 'APPROVE' | 'REQUEST_CHANGES',
   *   scores: { spec_adherence, test_coverage, code_quality, security, simplicity } | null,
   *   summary: string | null,
   *   issues: Array<{ severity, description }> | [],
   *   structured: boolean  // whether JSON was successfully parsed
   * }
   */
  static parse(reviewOutput) {
    const text = typeof reviewOutput === 'string'
      ? reviewOutput
      : JSON.stringify(reviewOutput);

    // Try to extract structured JSON
    const json = ReviewParser._extractJson(text);

    if (json && ReviewParser._isValidReviewJson(json)) {
      return {
        decision: json.decision,
        scores: ReviewParser._normalizeScores(json.scores),
        summary: json.summary || null,
        issues: Array.isArray(json.issues) ? json.issues : [],
        structured: true
      };
    }

    // Fallback to string matching
    return ReviewParser._fallbackParse(text);
  }

  /**
   * Extract JSON from review text.
   * Delegates to shared json-extractor utility.
   */
  static _extractJson(text) {
    return extractJson(text);
  }

  /**
   * Validate that extracted JSON matches the review schema.
   */
  static _isValidReviewJson(json) {
    if (!json || typeof json !== 'object') return false;
    if (!json.decision || !['APPROVE', 'REQUEST_CHANGES'].includes(json.decision)) return false;
    if (!json.scores || typeof json.scores !== 'object') return false;

    // At least one score dimension must be present
    const presentDimensions = SCORE_DIMENSIONS.filter(d => d in json.scores);
    if (presentDimensions.length === 0) return false;

    // All present scores must be in range 1-5
    for (const dim of presentDimensions) {
      const val = json.scores[dim];
      if (typeof val !== 'number' || val < 1 || val > 5) return false;
    }

    return true;
  }

  /**
   * Normalize scores — ensure all dimensions present, fill missing with null.
   */
  static _normalizeScores(scores) {
    const normalized = {};
    for (const dim of SCORE_DIMENSIONS) {
      const val = scores[dim];
      normalized[dim] = (typeof val === 'number' && val >= 1 && val <= 5) ? val : null;
    }
    return normalized;
  }

  /**
   * Fallback: extract decision from unstructured text.
   */
  static _fallbackParse(text) {
    const hasApprove = text.includes('APPROVE');
    const hasRequestChanges = text.includes('REQUEST_CHANGES');

    const decision = hasRequestChanges ? 'REQUEST_CHANGES'
      : hasApprove ? 'APPROVE'
      : 'REQUEST_CHANGES'; // default to reject if unclear

    return {
      decision,
      scores: null,
      summary: null,
      issues: [],
      structured: false
    };
  }

  /**
   * Aggregate scores across multiple reviews.
   * Returns averaged scores and issue counts by severity.
   */
  static aggregate(reviews) {
    const scoreSums = {};
    const scoreCounts = {};
    const issueCounts = { critical: 0, major: 0, minor: 0 };
    let totalReviews = 0;
    let structuredReviews = 0;

    for (const review of reviews) {
      totalReviews++;
      if (review.structured) structuredReviews++;

      if (review.scores) {
        for (const dim of SCORE_DIMENSIONS) {
          if (typeof review.scores[dim] === 'number') {
            scoreSums[dim] = (scoreSums[dim] || 0) + review.scores[dim];
            scoreCounts[dim] = (scoreCounts[dim] || 0) + 1;
          }
        }
      }

      for (const issue of (review.issues || [])) {
        const sev = issue.severity || 'minor';
        if (sev in issueCounts) issueCounts[sev]++;
      }
    }

    const avgScores = {};
    for (const dim of SCORE_DIMENSIONS) {
      avgScores[dim] = scoreCounts[dim]
        ? Math.round((scoreSums[dim] / scoreCounts[dim]) * 10) / 10
        : null;
    }

    return {
      avgScores,
      issueCounts,
      totalReviews,
      structuredReviews
    };
  }
}

module.exports = { ReviewParser, SCORE_DIMENSIONS };
