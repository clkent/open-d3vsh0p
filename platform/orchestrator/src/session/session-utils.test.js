const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateSessionId } = require('./session-utils');

describe('session-utils', () => {
  describe('generateSessionId', () => {
    it('returns a timestamp string without prefix', () => {
      const id = generateSessionId();
      // Format: YYYY-MM-DD-HH-MM
      assert.match(id, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    });

    it('prepends prefix when provided', () => {
      const id = generateSessionId('pair');
      assert.match(id, /^pair-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    });

    it('handles different prefixes', () => {
      const plan = generateSessionId('plan');
      const kickoff = generateSessionId('kickoff');
      assert.ok(plan.startsWith('plan-'));
      assert.ok(kickoff.startsWith('kickoff-'));
    });

    it('generates unique IDs across calls (at least different from hardcoded)', () => {
      const id = generateSessionId();
      // Should contain current year
      const year = new Date().getFullYear().toString();
      assert.ok(id.startsWith(year));
    });

    it('returns string without prefix when prefix is undefined', () => {
      const id = generateSessionId(undefined);
      assert.ok(!id.includes('undefined'));
      assert.match(id, /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    });
  });
});
