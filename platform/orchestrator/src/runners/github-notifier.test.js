const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { GitHubNotifier } = require('./github-notifier');

describe('GitHubNotifier', () => {
  function createNotifier(overrides = {}) {
    const notifier = new GitHubNotifier('/tmp/test-project', 'Test Project');

    // Override CLI-wrapping methods to avoid real gh calls
    notifier._findIssue = overrides.findIssue || (async () => null);
    notifier._createIssue = overrides.createIssue || (async () => 42);
    notifier._addComment = overrides.addComment || (async () => {});

    // Override isAvailable
    if (overrides.available !== undefined) {
      notifier.available = overrides.available;
    }

    return notifier;
  }

  describe('isAvailable', () => {
    it('returns true when available is pre-set to true', async () => {
      // isAvailable() checks this.available !== null and returns cached value
      const n = createNotifier({ available: true });
      assert.equal(n.available, true); // pre-set, not null
      const result = await n.isAvailable();
      assert.equal(result, true);
    });

    it('returns false when available is pre-set to false', async () => {
      const n = createNotifier({ available: false });
      assert.equal(n.available, false); // pre-set, not null
      const result = await n.isAvailable();
      assert.equal(result, false);
    });

    it('caching: returns same value on repeated calls without re-checking', async () => {
      // Verify the caching branch: when available !== null, it returns immediately
      const n = createNotifier({ available: true });
      const r1 = await n.isAvailable();
      // Manually set to false to verify it returns cached (true), not re-checking
      // But isAvailable short-circuits on this.available !== null, so if we call again
      // it returns the cached true.
      const r2 = await n.isAvailable();
      assert.equal(r1, true);
      assert.equal(r2, true);
      assert.equal(n.available, true);
    });

    it('starts as null before first check', () => {
      const n = new GitHubNotifier('/tmp/test-project', 'Test Project');
      assert.equal(n.available, null);
    });
  });

  describe('postDailyDigest', () => {
    it('returns null when gh is unavailable', async () => {
      const n = createNotifier({ available: false });
      const result = await n.postDailyDigest({ sessionId: 's1' });
      assert.equal(result, null);
    });

    it('creates new issue when none exists for today', async () => {
      let createdTitle = null;
      const n = createNotifier({
        available: true,
        findIssue: async () => null,
        createIssue: async (title) => { createdTitle = title; return 99; }
      });

      const result = await n.postDailyDigest({ sessionId: 's1', totalCostUsd: 5.0 });
      assert.equal(result, 99);
      assert.match(createdTitle, /\[DevShop Daily\] Test Project/);
    });

    it('adds comment to existing issue', async () => {
      let commentedIssue = null;
      const n = createNotifier({
        available: true,
        findIssue: async () => ({ number: 50, title: 'existing' }),
        addComment: async (num) => { commentedIssue = num; }
      });

      const result = await n.postDailyDigest({ sessionId: 's1' });
      assert.equal(result, 50);
      assert.equal(commentedIssue, 50);
    });

    it('returns null on error', async () => {
      const n = createNotifier({
        available: true,
        findIssue: async () => { throw new Error('network error'); }
      });

      const result = await n.postDailyDigest({ sessionId: 's1' });
      assert.equal(result, null);
    });
  });

  describe('postWeeklyReport', () => {
    it('returns null when unavailable', async () => {
      const n = createNotifier({ available: false });
      const result = await n.postWeeklyReport({ branches: { merged: 2 } });
      assert.equal(result, null);
    });

    it('creates new weekly issue', async () => {
      let createdTitle = null;
      const n = createNotifier({
        available: true,
        findIssue: async () => null,
        createIssue: async (title) => { createdTitle = title; return 77; }
      });

      const result = await n.postWeeklyReport({ branches: { merged: 3 } });
      assert.equal(result, 77);
      assert.match(createdTitle, /\[DevShop Weekly\] Test Project/);
    });

    it('adds comment to existing weekly issue', async () => {
      const n = createNotifier({
        available: true,
        findIssue: async () => ({ number: 88 }),
        addComment: async () => {}
      });

      const result = await n.postWeeklyReport({ branches: {} });
      assert.equal(result, 88);
    });
  });

  describe('postMonthlyReport', () => {
    it('returns null when unavailable', async () => {
      const n = createNotifier({ available: false });
      const result = await n.postMonthlyReport({ cost: { totalCost: 100 } });
      assert.equal(result, null);
    });

    it('creates monthly issue', async () => {
      let createdTitle = null;
      const n = createNotifier({
        available: true,
        createIssue: async (title) => { createdTitle = title; return 101; }
      });

      const result = await n.postMonthlyReport({ cost: { totalCost: 50 } });
      assert.equal(result, 101);
      assert.match(createdTitle, /\[DevShop Monthly\] Test Project/);
    });

    it('returns null on error', async () => {
      const n = createNotifier({
        available: true,
        createIssue: async () => { throw new Error('create failed'); }
      });

      const result = await n.postMonthlyReport({ cost: {} });
      assert.equal(result, null);
    });
  });

  describe('_formatDailyDigest', () => {
    it('includes session ID, cost, and invocations', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({
        sessionId: 'test-session-42',
        totalCostUsd: 12.50,
        agentInvocations: 7
      });
      assert.match(body, /test-session-42/);
      assert.match(body, /\$12\.50/);
      assert.match(body, /7/);
    });

    it('handles missing fields gracefully', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({});
      assert.match(body, /N\/A/);
      assert.match(body, /\$0\.00/);
    });

    it('includes results section when present', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({
        sessionId: 's1',
        results: {
          completed: ['req-1', 'req-2'],
          parked: ['req-3'],
          remaining: []
        }
      });
      assert.match(body, /Completed: 2/);
      assert.match(body, /Parked: 1/);
      assert.match(body, /req-1, req-2/);
    });

    it('includes preview info when available', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({
        sessionId: 's1',
        preview: { available: true, command: 'npm run dev', port: 3000 }
      });
      assert.match(body, /Preview available/);
      assert.match(body, /npm run dev/);
    });

    it('includes parked item reasons when parked are objects', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({
        sessionId: 's1',
        results: {
          completed: [],
          parked: [
            { id: 'ios-signing', reason: 'Build failed: code signing is required for product type' },
            { id: 'api-keys', reason: 'Error: STRIPE_KEY is missing' }
          ],
          remaining: []
        }
      });
      assert.match(body, /ios-signing/);
      assert.match(body, /code signing/);
      assert.match(body, /api-keys/);
      assert.match(body, /STRIPE_KEY/);
    });

    it('includes interventions section when present', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({
        sessionId: 's1',
        results: { completed: [], parked: [], remaining: [] },
        interventions: [{
          requirementId: 'ios-signing',
          title: 'Configure code signing',
          category: 'signing',
          steps: ['Open Xcode', 'Select team', 'Verify profiles'],
          verifyCommand: 'xcodebuild -showBuildSettings | grep DEVELOPMENT_TEAM'
        }]
      });
      assert.match(body, /Interventions Required/);
      assert.match(body, /ios-signing/);
      assert.match(body, /Configure code signing/);
      assert.match(body, /Open Xcode/);
      assert.match(body, /xcodebuild/);
    });

    it('includes stop reason', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({
        sessionId: 's1',
        stopReason: 'budget_exhausted'
      });
      assert.match(body, /budget_exhausted/);
    });

    it('includes window when present', () => {
      const n = createNotifier();
      const body = n._formatDailyDigest({
        sessionId: 's1',
        window: 'implementation'
      });
      assert.match(body, /implementation/);
    });
  });

  describe('_formatWeeklyReport', () => {
    it('includes branch cleanup counts', () => {
      const n = createNotifier();
      const body = n._formatWeeklyReport({
        branches: { merged: 5, abandoned: 2 }
      });
      assert.match(body, /Merged branches removed: 5/);
      assert.match(body, /Abandoned branches removed: 2/);
    });

    it('includes collapsible details', () => {
      const n = createNotifier();
      const body = n._formatWeeklyReport({
        branches: {
          merged: 1,
          details: [{ name: 'old-branch', reason: 'merged 7d ago' }]
        }
      });
      assert.match(body, /<details>/);
      assert.match(body, /old-branch/);
    });

    it('includes worktree cleanup', () => {
      const n = createNotifier();
      const body = n._formatWeeklyReport({
        worktrees: { pruned: 3 }
      });
      assert.match(body, /Pruned: 3/);
    });
  });

  describe('_formatMonthlyReport', () => {
    it('includes cost summary', () => {
      const n = createNotifier();
      const body = n._formatMonthlyReport({
        cost: {
          totalCost: 150.50,
          sessionCount: 10,
          avgCostPerSession: 15.05,
          totalInvocations: 45
        }
      });
      assert.match(body, /\$150\.50/);
      assert.match(body, /Sessions: 10/);
      assert.match(body, /\$15\.05/);
    });

    it('includes month-over-month change', () => {
      const n = createNotifier();
      const body = n._formatMonthlyReport({
        cost: {
          totalCost: 200,
          monthOverMonthChange: 25.5,
          previousMonth: { totalCost: 160 }
        }
      });
      assert.match(body, /25\.5%/);
      assert.match(body, /increase/);
    });

    it('shows warning when cost increase exceeds 50%', () => {
      const n = createNotifier();
      const body = n._formatMonthlyReport({
        cost: {
          totalCost: 300,
          monthOverMonthChange: 75.0,
          previousMonth: { totalCost: 171 }
        }
      });
      assert.match(body, /Warning/);
      assert.match(body, /exceeds 50%/);
    });

    it('shows decrease correctly', () => {
      const n = createNotifier();
      const body = n._formatMonthlyReport({
        cost: {
          totalCost: 100,
          monthOverMonthChange: -20.0,
          previousMonth: { totalCost: 125 }
        }
      });
      assert.match(body, /decrease/);
    });

    it('includes archived items', () => {
      const n = createNotifier();
      const body = n._formatMonthlyReport({
        archived: { count: 2, items: ['old-req-1', 'old-req-2'] }
      });
      assert.match(body, /Archived: 2/);
      assert.match(body, /old-req-1/);
    });
  });

  describe('_getWeekId', () => {
    it('returns YYYY-Wnn format', () => {
      const n = createNotifier();
      const weekId = n._getWeekId();
      assert.match(weekId, /^\d{4}-W\d{2}$/);
    });

    it('zero-pads week number', () => {
      const n = createNotifier();
      const weekId = n._getWeekId();
      const weekPart = weekId.split('-W')[1];
      assert.equal(weekPart.length, 2);
    });
  });
});
