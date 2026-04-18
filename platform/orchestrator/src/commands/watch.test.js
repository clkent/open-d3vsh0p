const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { formatAgentEvent, formatPairEvent, formatRileyEvent, formatOrchestratorEvent, formatEvent, formatMilestoneEvent, formatProgressEvent, formatGoLookEvent } = require('./watch');

describe('Watch command formatting', () => {
  let consoleOutput;
  const originalLog = console.log;

  function captureConsole() {
    consoleOutput = [];
    console.log = (...args) => consoleOutput.push(args.join(' '));
  }

  afterEach(() => {
    console.log = originalLog;
  });

  describe('formatAgentEvent', () => {
    it('displays assistant message with persona and requirement', () => {
      captureConsole();
      formatAgentEvent({
        source: 'agent',
        persona: 'Jordan',
        requirementId: 'user-auth',
        group: 'A',
        event: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Implementing login form' }]
          }
        }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('Jordan'));
      assert.ok(consoleOutput[0].includes('user-auth'));
      assert.ok(consoleOutput[0].includes('Implementing login form'));
    });

    it('truncates long messages', () => {
      captureConsole();
      const longText = 'x'.repeat(300);
      formatAgentEvent({
        source: 'agent',
        persona: 'Alex',
        requirementId: 'api-endpoint',
        event: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: longText }]
          }
        }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('...'));
      assert.ok(consoleOutput[0].length < longText.length);
    });

    it('displays result event with status', () => {
      captureConsole();
      formatAgentEvent({
        source: 'agent',
        persona: 'Sam',
        requirementId: 'data-model',
        event: {
          type: 'result',
          is_error: false
        }
      });

      assert.ok(consoleOutput[0].includes('DONE'));
    });

    it('displays error result event', () => {
      captureConsole();
      formatAgentEvent({
        source: 'agent',
        persona: 'Taylor',
        requirementId: 'auth-flow',
        event: {
          type: 'result',
          is_error: true
        }
      });

      assert.ok(consoleOutput[0].includes('ERROR'));
    });

    it('skips events without event payload', () => {
      captureConsole();
      formatAgentEvent({
        source: 'agent',
        persona: 'Jordan',
        requirementId: 'x',
        event: null
      });
      assert.equal(consoleOutput.length, 0);
    });
  });

  describe('formatPairEvent', () => {
    it('displays assistant message with persona only (no requirementId)', () => {
      captureConsole();
      formatPairEvent({
        source: 'pair',
        persona: 'Morgan',
        event: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Looking at the test failures' }]
          }
        }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('Morgan'));
      assert.ok(consoleOutput[0].includes('Looking at the test failures'));
      // Should NOT include parenthesized requirementId like agent events do
      assert.ok(!consoleOutput[0].includes('('));
    });

    it('displays DONE on successful result', () => {
      captureConsole();
      formatPairEvent({
        source: 'pair',
        persona: 'Morgan',
        event: { type: 'result', is_error: false }
      });

      assert.ok(consoleOutput[0].includes('Morgan'));
      assert.ok(consoleOutput[0].includes('DONE'));
    });

    it('displays ERROR on failed result', () => {
      captureConsole();
      formatPairEvent({
        source: 'pair',
        persona: 'Morgan',
        event: { type: 'result', is_error: true }
      });

      assert.ok(consoleOutput[0].includes('Morgan'));
      assert.ok(consoleOutput[0].includes('ERROR'));
    });

    it('skips events without event payload', () => {
      captureConsole();
      formatPairEvent({ source: 'pair', persona: 'Morgan', event: null });
      assert.equal(consoleOutput.length, 0);
    });
  });

  describe('formatRileyEvent', () => {
    it('displays assistant message with persona only (no requirementId)', () => {
      captureConsole();
      formatRileyEvent({
        source: 'riley',
        persona: 'Riley',
        event: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Updating the roadmap now' }]
          }
        }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('Riley'));
      assert.ok(consoleOutput[0].includes('Updating the roadmap now'));
      assert.ok(!consoleOutput[0].includes('('));
    });

    it('displays DONE on successful result', () => {
      captureConsole();
      formatRileyEvent({
        source: 'riley',
        persona: 'Riley',
        event: { type: 'result', is_error: false }
      });

      assert.ok(consoleOutput[0].includes('Riley'));
      assert.ok(consoleOutput[0].includes('DONE'));
    });

    it('displays ERROR on failed result', () => {
      captureConsole();
      formatRileyEvent({
        source: 'riley',
        persona: 'Riley',
        event: { type: 'result', is_error: true }
      });

      assert.ok(consoleOutput[0].includes('Riley'));
      assert.ok(consoleOutput[0].includes('ERROR'));
    });

    it('skips events without event payload', () => {
      captureConsole();
      formatRileyEvent({ source: 'riley', persona: 'Riley', event: null });
      assert.equal(consoleOutput.length, 0);
    });
  });

  describe('formatEvent dispatcher', () => {
    it('routes riley events to formatRileyEvent', () => {
      captureConsole();
      formatEvent({
        source: 'riley',
        persona: 'Riley',
        event: { type: 'result', is_error: false }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('Riley'));
      assert.ok(consoleOutput[0].includes('DONE'));
    });

    it('routes pair events to formatPairEvent', () => {
      captureConsole();
      formatEvent({
        source: 'pair',
        persona: 'Morgan',
        event: { type: 'result', is_error: false }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('Morgan'));
      assert.ok(consoleOutput[0].includes('DONE'));
    });
  });

  describe('formatOrchestratorEvent', () => {
    it('displays info event with dash indicator', () => {
      captureConsole();
      formatOrchestratorEvent({
        source: 'orchestrator',
        level: 'info',
        eventType: 'phase_started',
        event: { phase: 'Phase 1: Setup' }
      });

      assert.ok(consoleOutput[0].startsWith('  - [phase_started]'));
      assert.ok(consoleOutput[0].includes('Phase 1: Setup'));
    });

    it('displays warn event with tilde indicator', () => {
      captureConsole();
      formatOrchestratorEvent({
        source: 'orchestrator',
        level: 'warn',
        eventType: 'budget_warning',
        event: { reason: 'budget low' }
      });

      assert.ok(consoleOutput[0].startsWith('  ~ [budget_warning]'));
      assert.ok(consoleOutput[0].includes('budget low'));
    });

    it('displays error event with bang indicator', () => {
      captureConsole();
      formatOrchestratorEvent({
        source: 'orchestrator',
        level: 'error',
        eventType: 'phase_stuck',
        event: { phase: 'Phase 2' }
      });

      assert.ok(consoleOutput[0].startsWith('  ! [phase_stuck]'));
    });

    it('routes milestone events to formatMilestoneEvent', () => {
      captureConsole();
      formatOrchestratorEvent({
        source: 'orchestrator',
        level: 'info',
        eventType: 'milestone',
        event: { requirementId: 'user-auth', result: 'merged', progress: { completed: 1, total: 3, parked: 0 } }
      });

      // Should show multi-line block, not single-line generic format
      assert.ok(consoleOutput.length > 1);
      assert.ok(consoleOutput.some(l => l.includes('MERGED')));
      assert.ok(consoleOutput.some(l => l.includes('user-auth')));
    });

    it('routes progress events to formatProgressEvent', () => {
      captureConsole();
      formatOrchestratorEvent({
        source: 'orchestrator',
        level: 'info',
        eventType: 'progress',
        event: { phase: 'Phase 1: Setup', completed: 2, total: 5, parked: 0, budgetUsedUsd: 6.30, budgetLimitUsd: 30, elapsedMinutes: 12 }
      });

      assert.ok(consoleOutput[0].includes('[progress]'));
      assert.ok(consoleOutput[0].includes('2/5'));
    });

    it('routes go_look events to formatGoLookEvent', () => {
      captureConsole();
      formatOrchestratorEvent({
        source: 'orchestrator',
        level: 'info',
        eventType: 'go_look',
        event: { message: 'nav-bar merged — refresh localhost:3000' }
      });

      assert.ok(consoleOutput[0].includes('>>>'));
      assert.ok(consoleOutput[0].includes('nav-bar merged'));
    });
  });

  describe('formatMilestoneEvent', () => {
    it('renders multi-line block for merged milestone', () => {
      captureConsole();
      formatMilestoneEvent({
        source: 'orchestrator',
        eventType: 'milestone',
        event: {
          requirementId: 'user-auth',
          result: 'merged',
          persona: 'Taylor',
          attempts: 2,
          costUsd: 3.50,
          diffStat: '5 files changed, 120 insertions(+), 30 deletions(-)',
          reviewSummary: 'Approved — clean implementation',
          previewAvailable: true,
          progress: { completed: 3, total: 7, parked: 0 }
        }
      });

      // Should have separator, result line, persona line, diffstat, review, preview, progress, separator
      assert.ok(consoleOutput.length >= 6);
      assert.ok(consoleOutput[0].includes('\u2500')); // separator
      assert.ok(consoleOutput[1].includes('MERGED'));
      assert.ok(consoleOutput[1].includes('user-auth'));
      assert.ok(consoleOutput[2].includes('Taylor'));
      assert.ok(consoleOutput[2].includes('2 attempts'));
      assert.ok(consoleOutput[2].includes('$3.50'));
      assert.ok(consoleOutput.some(l => l.includes('5 files changed')));
      assert.ok(consoleOutput.some(l => l.includes('Review: Approved')));
      assert.ok(consoleOutput.some(l => l.includes('Preview: available')));
      assert.ok(consoleOutput.some(l => l.includes('3/7 complete')));
    });

    it('renders parked milestone without diff/review', () => {
      captureConsole();
      formatMilestoneEvent({
        source: 'orchestrator',
        eventType: 'milestone',
        event: {
          requirementId: 'payment-flow',
          result: 'parked',
          persona: 'Jordan',
          attempts: 4,
          costUsd: 8.20,
          diffStat: null,
          reviewSummary: null,
          previewAvailable: false,
          progress: { completed: 3, total: 7, parked: 1 }
        }
      });

      assert.ok(consoleOutput.some(l => l.includes('PARKED')));
      assert.ok(consoleOutput.some(l => l.includes('payment-flow')));
      assert.ok(!consoleOutput.some(l => l.includes('Review:')));
      assert.ok(consoleOutput.some(l => l.includes('1 parked')));
    });

    it('omits preview line when previewAvailable is null', () => {
      captureConsole();
      formatMilestoneEvent({
        source: 'orchestrator',
        eventType: 'milestone',
        event: {
          requirementId: 'api-fix',
          result: 'merged',
          progress: { completed: 1, total: 3, parked: 0 }
        }
      });

      assert.ok(!consoleOutput.some(l => l.includes('Preview:')));
    });
  });

  describe('formatProgressEvent', () => {
    it('renders compact progress line', () => {
      captureConsole();
      formatProgressEvent({
        source: 'orchestrator',
        eventType: 'progress',
        event: {
          phase: 'Phase 2: UI Components',
          completed: 2,
          total: 5,
          parked: 0,
          budgetUsedUsd: 6.30,
          budgetLimitUsd: 30,
          elapsedMinutes: 12
        }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('[progress]'));
      assert.ok(consoleOutput[0].includes('Phase 2: UI Components'));
      assert.ok(consoleOutput[0].includes('2/5 complete'));
      assert.ok(consoleOutput[0].includes('$6.30/$30.00'));
      assert.ok(consoleOutput[0].includes('12m elapsed'));
    });

    it('includes parked count when present', () => {
      captureConsole();
      formatProgressEvent({
        source: 'orchestrator',
        eventType: 'progress',
        event: {
          phase: 'Phase 1',
          completed: 2,
          total: 5,
          parked: 1,
          budgetUsedUsd: 4,
          budgetLimitUsd: 30,
          elapsedMinutes: 8
        }
      });

      assert.ok(consoleOutput[0].includes('(1 parked)'));
    });

    it('shows active agents when present', () => {
      captureConsole();
      formatProgressEvent({
        source: 'orchestrator',
        eventType: 'progress',
        event: {
          phase: 'Phase 2',
          completed: 1,
          total: 4,
          parked: 0,
          budgetUsedUsd: 3,
          budgetLimitUsd: 30,
          elapsedMinutes: 5,
          activeAgents: [
            { persona: 'Taylor', requirementId: 'nav-bar' },
            { persona: 'Jordan', requirementId: 'footer' }
          ]
        }
      });

      assert.equal(consoleOutput.length, 2);
      assert.ok(consoleOutput[1].includes('Active:'));
      assert.ok(consoleOutput[1].includes('Taylor(nav-bar)'));
      assert.ok(consoleOutput[1].includes('Jordan(footer)'));
    });
  });

  describe('formatGoLookEvent', () => {
    it('renders prominent message with >>> prefix', () => {
      captureConsole();
      formatGoLookEvent({
        source: 'orchestrator',
        eventType: 'go_look',
        event: { message: 'multi-location-interface merged — refresh localhost:3000' }
      });

      assert.equal(consoleOutput.length, 1);
      assert.ok(consoleOutput[0].includes('>>>'));
      assert.ok(consoleOutput[0].includes('multi-location-interface merged'));
      assert.ok(consoleOutput[0].includes('localhost:3000'));
    });

    it('shows fallback when message is missing', () => {
      captureConsole();
      formatGoLookEvent({
        source: 'orchestrator',
        eventType: 'go_look',
        event: {}
      });

      assert.ok(consoleOutput[0].includes('>>>'));
      assert.ok(consoleOutput[0].includes('Preview available'));
    });
  });
});
