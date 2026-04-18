const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ReviewParser, SCORE_DIMENSIONS } = require('./review-parser');

describe('ReviewParser', () => {
  describe('parse - clean JSON', () => {
    it('parses well-formed JSON with all fields', () => {
      const input = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 5, test_coverage: 4, code_quality: 4, security: 5, simplicity: 3 },
        summary: 'Looks good',
        issues: []
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'APPROVE');
      assert.equal(result.structured, true);
      assert.equal(result.scores.spec_adherence, 5);
      assert.equal(result.scores.simplicity, 3);
      assert.equal(result.summary, 'Looks good');
    });

    it('parses REQUEST_CHANGES with issues', () => {
      const input = JSON.stringify({
        decision: 'REQUEST_CHANGES',
        scores: { spec_adherence: 3, test_coverage: 2, code_quality: 3, security: 4, simplicity: 4 },
        summary: 'Missing tests',
        issues: [
          { severity: 'critical', description: 'No error handling' },
          { severity: 'minor', description: 'Naming could be better' }
        ]
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'REQUEST_CHANGES');
      assert.equal(result.issues.length, 2);
      assert.equal(result.issues[0].severity, 'critical');
    });
  });

  describe('implementation_authenticity dimension', () => {
    it('parses implementation_authenticity score', () => {
      const input = JSON.stringify({
        decision: 'REQUEST_CHANGES',
        scores: { spec_adherence: 4, test_coverage: 4, code_quality: 4, security: 4, simplicity: 4, implementation_authenticity: 2 },
        summary: 'Mock patterns found',
        issues: [{ severity: 'critical', description: 'simulateWrite() used in production code' }]
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.structured, true);
      assert.equal(result.scores.implementation_authenticity, 2);
    });

    it('fills implementation_authenticity with null when missing', () => {
      const input = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 5, test_coverage: 5, code_quality: 5, security: 5, simplicity: 5 },
        summary: 'Great'
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.structured, true);
      assert.equal(result.scores.implementation_authenticity, null);
    });

    it('includes implementation_authenticity in SCORE_DIMENSIONS', () => {
      assert.ok(SCORE_DIMENSIONS.includes('implementation_authenticity'));
    });
  });

  describe('parse - markdown fences', () => {
    it('extracts JSON from ```json fenced block', () => {
      const input = `Here is my review:

\`\`\`json
{
  "decision": "APPROVE",
  "scores": { "spec_adherence": 4, "test_coverage": 5, "code_quality": 4, "security": 4, "simplicity": 4 },
  "summary": "Well done",
  "issues": []
}
\`\`\`

The code looks solid.`;

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'APPROVE');
      assert.equal(result.structured, true);
      assert.equal(result.scores.test_coverage, 5);
    });

    it('extracts JSON from plain ``` fenced block', () => {
      const input = `Review result:

\`\`\`
{"decision":"APPROVE","scores":{"spec_adherence":4,"test_coverage":4,"code_quality":4,"security":4,"simplicity":4},"summary":"OK","issues":[]}
\`\`\``;

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'APPROVE');
      assert.equal(result.structured, true);
    });
  });

  describe('parse - mixed text + JSON', () => {
    it('extracts JSON object embedded in prose', () => {
      const input = `I've reviewed the code carefully. Here is my assessment:

{"decision":"REQUEST_CHANGES","scores":{"spec_adherence":3,"test_coverage":2,"code_quality":4,"security":5,"simplicity":4},"summary":"Need more tests","issues":[{"severity":"major","description":"Missing edge case tests"}]}

Please address the issues above.`;

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'REQUEST_CHANGES');
      assert.equal(result.structured, true);
      assert.equal(result.scores.test_coverage, 2);
      assert.equal(result.issues.length, 1);
    });
  });

  describe('parse - no JSON fallback', () => {
    it('falls back to APPROVE when text contains APPROVE', () => {
      const input = 'APPROVE\n\nThe implementation looks correct. Good test coverage.';

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'APPROVE');
      assert.equal(result.structured, false);
      assert.equal(result.scores, null);
    });

    it('falls back to REQUEST_CHANGES when text contains REQUEST_CHANGES', () => {
      const input = 'REQUEST_CHANGES\n\n## Critical\n- Missing error handling';

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'REQUEST_CHANGES');
      assert.equal(result.structured, false);
    });

    it('defaults to REQUEST_CHANGES when no decision keyword found', () => {
      const input = 'The code has some issues that should be fixed.';

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'REQUEST_CHANGES');
      assert.equal(result.structured, false);
    });

    it('REQUEST_CHANGES takes precedence over APPROVE in fallback', () => {
      const input = 'REQUEST_CHANGES\nWhile some parts would APPROVE, overall needs work.';

      const result = ReviewParser.parse(input);
      assert.equal(result.decision, 'REQUEST_CHANGES');
      assert.equal(result.structured, false);
    });
  });

  describe('parse - invalid scores', () => {
    it('rejects scores out of 1-5 range', () => {
      const input = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 0, test_coverage: 6, code_quality: 4, security: 4, simplicity: 4 },
        summary: 'Test'
      });

      const result = ReviewParser.parse(input);
      // Invalid scores → falls back to string matching
      assert.equal(result.structured, false);
    });

    it('rejects non-numeric scores', () => {
      const input = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 'high', test_coverage: 4, code_quality: 4, security: 4, simplicity: 4 },
        summary: 'Test'
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.structured, false);
    });
  });

  describe('parse - missing fields', () => {
    it('fills missing score dimensions with null', () => {
      const input = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 4, test_coverage: 5 },
        summary: 'Partial scores'
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.structured, true);
      assert.equal(result.scores.spec_adherence, 4);
      assert.equal(result.scores.test_coverage, 5);
      assert.equal(result.scores.code_quality, null);
      assert.equal(result.scores.security, null);
      assert.equal(result.scores.simplicity, null);
    });

    it('defaults missing summary to null', () => {
      const input = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 4, test_coverage: 4, code_quality: 4, security: 4, simplicity: 4 }
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.summary, null);
      assert.deepEqual(result.issues, []);
    });

    it('rejects JSON with no score dimensions at all', () => {
      const input = JSON.stringify({
        decision: 'APPROVE',
        scores: {},
        summary: 'No scores'
      });

      const result = ReviewParser.parse(input);
      assert.equal(result.structured, false); // falls back
    });
  });

  describe('aggregate', () => {
    it('averages scores across structured reviews', () => {
      const reviews = [
        { structured: true, scores: { spec_adherence: 4, test_coverage: 5, code_quality: 3, security: 4, simplicity: 4 }, issues: [] },
        { structured: true, scores: { spec_adherence: 5, test_coverage: 3, code_quality: 5, security: 4, simplicity: 4 }, issues: [] }
      ];

      const agg = ReviewParser.aggregate(reviews);
      assert.equal(agg.avgScores.spec_adherence, 4.5);
      assert.equal(agg.avgScores.test_coverage, 4);
      assert.equal(agg.avgScores.code_quality, 4);
      assert.equal(agg.totalReviews, 2);
      assert.equal(agg.structuredReviews, 2);
    });

    it('counts issues by severity', () => {
      const reviews = [
        { structured: true, scores: { spec_adherence: 4 }, issues: [
          { severity: 'critical', description: 'a' },
          { severity: 'minor', description: 'b' }
        ]},
        { structured: true, scores: { spec_adherence: 3 }, issues: [
          { severity: 'major', description: 'c' },
          { severity: 'critical', description: 'd' }
        ]}
      ];

      const agg = ReviewParser.aggregate(reviews);
      assert.equal(agg.issueCounts.critical, 2);
      assert.equal(agg.issueCounts.major, 1);
      assert.equal(agg.issueCounts.minor, 1);
    });

    it('skips null scores from unstructured reviews', () => {
      const reviews = [
        { structured: true, scores: { spec_adherence: 4, test_coverage: 5, code_quality: 4, security: 4, simplicity: 4 }, issues: [] },
        { structured: false, scores: null, issues: [] }
      ];

      const agg = ReviewParser.aggregate(reviews);
      assert.equal(agg.avgScores.spec_adherence, 4);
      assert.equal(agg.totalReviews, 2);
      assert.equal(agg.structuredReviews, 1);
    });

    it('returns null averages when no structured reviews', () => {
      const reviews = [
        { structured: false, scores: null, issues: [] }
      ];

      const agg = ReviewParser.aggregate(reviews);
      assert.equal(agg.avgScores.spec_adherence, null);
      assert.equal(agg.totalReviews, 1);
      assert.equal(agg.structuredReviews, 0);
    });
  });
});
