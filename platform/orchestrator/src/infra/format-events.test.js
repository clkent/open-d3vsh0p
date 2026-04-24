const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { formatAgentEvent, extractAssistantText, formatMilestoneEvent } = require('./format-events');

describe('format-events', () => {
  let logs;
  let originalLog;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe('formatAgentEvent', () => {
    it('formats assistant event with persona and requirementId', () => {
      formatAgentEvent({
        persona: 'Jordan',
        requirementId: 'user-auth',
        event: {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Working on auth module' }] }
        }
      });
      assert.equal(logs.length, 1);
      assert.match(logs[0], /\[Jordan\]/);
      assert.match(logs[0], /\(user-auth\)/);
      assert.match(logs[0], /Working on auth module/);
    });

    it('formats result event as DONE', () => {
      formatAgentEvent({
        persona: 'Taylor',
        requirementId: 'task-schema',
        event: { type: 'result', is_error: false }
      });
      assert.equal(logs.length, 1);
      assert.match(logs[0], /\[Taylor\]/);
      assert.match(logs[0], /DONE/);
    });

    it('formats error result event as ERROR', () => {
      formatAgentEvent({
        persona: 'Taylor',
        requirementId: 'task-schema',
        event: { type: 'result', is_error: true }
      });
      assert.equal(logs.length, 1);
      assert.match(logs[0], /ERROR/);
    });

    it('ignores events with no event payload', () => {
      formatAgentEvent({ persona: 'Jordan', requirementId: 'x' });
      assert.equal(logs.length, 0);
    });

    it('ignores non-assistant non-result events', () => {
      formatAgentEvent({
        persona: 'Jordan',
        requirementId: 'x',
        event: { type: 'tool_use' }
      });
      assert.equal(logs.length, 0);
    });
  });

  describe('extractAssistantText', () => {
    it('extracts text from content blocks', () => {
      const result = extractAssistantText({
        message: { content: [{ type: 'text', text: 'Hello world' }] }
      });
      assert.equal(result, 'Hello world');
    });

    it('truncates text longer than 200 characters', () => {
      const longText = 'A'.repeat(250);
      const result = extractAssistantText({
        message: { content: [{ type: 'text', text: longText }] }
      });
      assert.equal(result.length, 203); // 200 + '...'
      assert.ok(result.endsWith('...'));
    });

    it('does not truncate text at exactly 200 characters', () => {
      const exactText = 'B'.repeat(200);
      const result = extractAssistantText({
        message: { content: [{ type: 'text', text: exactText }] }
      });
      assert.equal(result.length, 200);
      assert.ok(!result.endsWith('...'));
    });

    it('returns null for empty content', () => {
      const result = extractAssistantText({ message: { content: [] } });
      assert.equal(result, null);
    });

    it('returns null when no message', () => {
      const result = extractAssistantText({});
      assert.equal(result, null);
    });

    it('joins multiple text blocks', () => {
      const result = extractAssistantText({
        message: { content: [
          { type: 'text', text: 'First ' },
          { type: 'text', text: 'Second' }
        ] }
      });
      assert.equal(result, 'First Second');
    });
  });

  describe('formatMilestoneEvent', () => {
    it('formats merged milestone with all fields', () => {
      formatMilestoneEvent({
        event: {
          requirementId: 'user-auth',
          result: 'merged',
          persona: 'Taylor',
          attempts: 2,
          costUsd: 3.50,
          diffStat: '5 files changed',
          reviewSummary: 'Approved',
          previewAvailable: true,
          progress: { completed: 3, total: 7, parked: 0 }
        }
      });
      assert.ok(logs.some(l => l.includes('MERGED')));
      assert.ok(logs.some(l => l.includes('user-auth')));
      assert.ok(logs.some(l => l.includes('Taylor')));
      assert.ok(logs.some(l => l.includes('$3.50')));
      assert.ok(logs.some(l => l.includes('5 files changed')));
      assert.ok(logs.some(l => l.includes('Review: Approved')));
      assert.ok(logs.some(l => l.includes('Preview: available')));
      assert.ok(logs.some(l => l.includes('3/7 complete')));
    });

    it('formats parked milestone without diff and review', () => {
      formatMilestoneEvent({
        event: {
          requirementId: 'payment-flow',
          result: 'parked',
          persona: 'Jordan',
          attempts: 4,
          costUsd: 8.20,
          progress: { completed: 3, total: 7, parked: 1 }
        }
      });
      assert.ok(logs.some(l => l.includes('PARKED')));
      assert.ok(logs.some(l => l.includes('payment-flow')));
      assert.ok(logs.some(l => l.includes('1 parked')));
    });
  });
});
