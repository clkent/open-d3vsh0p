const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ParallelOrchestrator has 15+ dependencies. We test individual methods in
// isolation by constructing the object with cliOptions only, then assigning
// mocked properties directly before calling the method under test.

const { ParallelOrchestrator } = require('./parallel-orchestrator');

function createOrchestrator(overrides = {}) {
  const po = new ParallelOrchestrator({
    projectId: 'proj-001',
    projectDir: '/tmp/test-project',
    templatesDir: '/tmp/templates',
    activeAgentsDir: '/tmp/agents',
    ...overrides.cliOptions
  });

  const logEntries = [];

  po.logger = {
    log: async (level, event, data) => { logEntries.push({ level, event, data }); },
    logMilestone: async (data) => { logEntries.push({ level: 'info', event: 'milestone', data }); },
    logProgress: async (data) => { logEntries.push({ level: 'info', event: 'progress', data }); },
    logGoLook: async (data) => { logEntries.push({ level: 'info', event: 'go_look', data }); },
    logPreviewCheck: async () => {},
    writeSummary: async () => '/tmp/summary.json',
    init: async () => {},
    setBroadcast: () => {},
    ...overrides.logger
  };

  po.stateMachine = {
    getState: () => ({
      sessionId: 'test-session',
      sessionBranch: 'devshop/session-test',
      startedAt: new Date().toISOString(),
      requirements: {
        pending: ['req-1', 'req-2'],
        inProgress: null,
        completed: ['req-0'],
        parked: []
      },
      completedMicrocycles: [],
      consumption: { totalCostUsd: 5, totalDurationMs: 30000, agentInvocations: 3 },
      activeAgents: [],
      preview: null,
      ...overrides.state
    }),
    transition: async () => {},
    update: async () => {},
    initialize: async () => {},
    load: async () => null,
    ...overrides.stateMachine
  };

  po.monitor = {
    shouldStop: () => ({ stop: false }),
    getStateForPersistence: () => ({}),
    getSnapshot: () => ({
      budgetUsedUsd: 5, budgetRemainingUsd: 25, budgetUsedPct: '16.7',
      totalCostUsd: 5, agentInvocations: 3
    }),
    recordInvocation: () => {},
    totalCostUsd: 5,
    requestPause: () => {},
    installSignalHandlers: () => {},
    removeSignalHandlers: () => {},
    resetCycleCost: () => {},
    ...overrides.monitor
  };

  po.gitOps = {
    pushBranch: async () => {},
    commitAll: async () => 'abc123',
    createSessionBranch: async () => {},
    createWorktreeWithNewBranch: async () => {},
    removeWorktree: async () => {},
    mergeToSession: async () => {},
    checkoutBranch: async () => {},
    branchExists: async () => false,
    getDiffStat: async () => '3 files changed',
    _git: async () => {},
    ensureWorktreeIgnored: async () => {},
    ...overrides.gitOps
  };

  po.config = {
    budgetLimitUsd: 30,
    retryLimits: { implementation: 3, testFix: 3, reviewFix: 2 },
    agents: {
      'implementation': { model: 'test', maxBudgetUsd: 5, timeoutMs: 60000, allowedTools: [] },
      'principal-engineer': { model: 'test', maxBudgetUsd: 2, timeoutMs: 60000, allowedTools: [] }
    },
    git: { commitPrefix: 'feat' },
    ...overrides.config
  };

  po.roadmapReader = {
    parse: async () => ({ title: 'Test', phases: [] }),
    isComplete: () => false,
    isSpikePhase: () => false,
    getNextPhase: () => null,
    getAllItems: () => [],
    getPendingGroups: () => [],
    getParkedItemsInPhase: () => [],
    markItemComplete: async () => {},
    resetParkedItems: async () => false,
    ...overrides.roadmapReader
  };

  po.agentRunner = {
    runAgent: async () => ({ success: true, cost: 0.5, duration: 1000, output: 'done' }),
    ...overrides.agentRunner
  };

  po.templateEngine = {
    renderAgentPrompt: async () => 'system prompt',
    ...overrides.templateEngine
  };

  po.broadcastServer = {
    isRunning: false,
    start: async () => {},
    stop: async () => {},
    broadcast: () => {},
    ...overrides.broadcastServer
  };

  po.healthGate = {
    runHealthCheckGate: async () => true,
    runPhaseGate: async () => ({ passed: true }),
    runPostMergeSmokeTest: async () => ({ passed: true }),
    runArchitectureCheck: async () => {},
    runPreviewCheck: async () => {},
    ...overrides.healthGate
  };

  po.repair = {
    runProjectDiagnostic: async () => ({ success: false, skipped: true }),
    handleBlockingFix: async () => null,
    ...overrides.repair
  };

  po.triage = {
    parkItem: async () => ({ classification: 'non_blocking' }),
    triageParkedItems: async () => {},
    ...overrides.triage
  };

  po.agentPool = {
    assignMany: (count) => Array.from({ length: count }, (_, i) => ({
      name: `Agent-${i}`, agentType: 'implementation-agent'
    })),
    ...overrides.agentPool
  };

  po.openspec = {
    parseTechStack: async () => 'Node.js',
    parseConventions: async () => null,
    getRequirementById: async () => null,
    ...overrides.openspec
  };

  po.costEstimator = {
    init: async () => {},
    predictSufficiency: () => ({ sufficient: true }),
    ...overrides.costEstimator
  };

  po._techStack = overrides.techStack || 'Node.js';
  po._conventions = overrides.conventions || null;

  return { po, logEntries };
}

describe('ParallelOrchestrator', () => {
  describe('_getStopReason', () => {
    it('returns all_requirements_processed when nothing pending or in progress', () => {
      const { po } = createOrchestrator();
      const reason = po._getStopReason({
        requirements: { pending: [], inProgress: null }
      });
      assert.equal(reason, 'all_requirements_processed');
    });

    it('returns monitor reason when monitor says stop', () => {
      const { po } = createOrchestrator({
        monitor: {
          shouldStop: () => ({ stop: true, reason: 'budget_exhausted' }),
          getStateForPersistence: () => ({}),
          getSnapshot: () => ({}),
          totalCostUsd: 30,
          requestPause: () => {},
          installSignalHandlers: () => {},
          removeSignalHandlers: () => {},
          resetCycleCost: () => {},
          recordInvocation: () => {}
        }
      });
      const reason = po._getStopReason({
        requirements: { pending: ['req-1'], inProgress: null }
      });
      assert.equal(reason, 'budget_exhausted');
    });

    it('returns session_ended as fallback', () => {
      const { po } = createOrchestrator();
      const reason = po._getStopReason({
        requirements: { pending: ['req-1'], inProgress: null }
      });
      assert.equal(reason, 'session_ended');
    });

    it('returns session_ended when item is in progress', () => {
      const { po } = createOrchestrator();
      const reason = po._getStopReason({
        requirements: { pending: [], inProgress: 'req-1' }
      });
      assert.equal(reason, 'session_ended');
    });
  });

  describe('_getBlockingIdsFromState', () => {
    it('returns empty set when no parked items', () => {
      const { po } = createOrchestrator({
        state: { requirements: { parked: [] } }
      });
      const blocking = po._getBlockingIdsFromState();
      assert.equal(blocking.size, 0);
    });

    it('returns only items classified as blocking', () => {
      const { po } = createOrchestrator();
      po.stateMachine.getState = () => ({
        requirements: {
          parked: [
            { id: 'block-1', triageClassification: 'blocking' },
            { id: 'non-block', triageClassification: 'non_blocking' },
            { id: 'block-2', triageClassification: 'blocking' }
          ]
        }
      });

      const blocking = po._getBlockingIdsFromState();
      assert.equal(blocking.size, 2);
      assert.equal(blocking.has('block-1'), true);
      assert.equal(blocking.has('block-2'), true);
      assert.equal(blocking.has('non-block'), false);
    });

    it('excludes parked items without triageClassification', () => {
      const { po } = createOrchestrator();
      po.stateMachine.getState = () => ({
        requirements: {
          parked: [
            { id: 'no-class', reason: 'some error' }
          ]
        }
      });

      const blocking = po._getBlockingIdsFromState();
      assert.equal(blocking.size, 0);
    });
  });

  describe('_createAgentOnEvent', () => {
    it('returns undefined when no broadcast server and watch disabled', () => {
      const { po } = createOrchestrator({
        broadcastServer: { isRunning: false }
      });

      const result = po._createAgentOnEvent('Jordan', 'req-1', 'Group A');
      assert.equal(result, undefined);
    });

    it('returns a callback when watch enabled even without broadcast server', () => {
      const { po } = createOrchestrator({
        broadcastServer: { isRunning: false },
        cliOptions: { watch: true }
      });

      const result = po._createAgentOnEvent('Jordan', 'req-1', 'Group A');
      assert.notEqual(result, undefined);
      assert.equal(typeof result, 'function');
    });

    it('calls formatter when watch enabled', () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        const { po } = createOrchestrator({
          broadcastServer: { isRunning: false },
          cliOptions: { watch: true }
        });

        const onEvent = po._createAgentOnEvent('Jordan', 'req-1', 'Group A');
        onEvent({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Working on it' }] }
        });

        assert.ok(logs.some(l => l.includes('[Jordan]') && l.includes('(req-1)') && l.includes('Working on it')));
      } finally {
        console.log = originalLog;
      }
    });

    it('does not call formatter when watch disabled', () => {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));

      try {
        const broadcasts = [];
        const { po } = createOrchestrator({
          broadcastServer: { isRunning: true, broadcast: (msg) => broadcasts.push(msg) }
        });

        const onEvent = po._createAgentOnEvent('Jordan', 'req-1', 'Group A');
        onEvent({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Working on it' }] }
        });

        // Should broadcast but not print to console
        assert.equal(broadcasts.length, 1);
        assert.ok(!logs.some(l => l.includes('[Jordan]')));
      } finally {
        console.log = originalLog;
      }
    });

    it('returns a function that broadcasts when server is running', () => {
      const broadcasts = [];
      const { po } = createOrchestrator({
        broadcastServer: { isRunning: true, broadcast: (msg) => broadcasts.push(msg) }
      });

      const onEvent = po._createAgentOnEvent('Jordan', 'req-1', 'Group A');
      onEvent({ type: 'test' });
      assert.equal(broadcasts.length, 1);
      assert.equal(broadcasts[0].persona, 'Jordan');
    });

    it('returned function broadcasts event with correct metadata', () => {
      const broadcasts = [];
      const { po } = createOrchestrator({
        broadcastServer: {
          isRunning: true,
          broadcast: (msg) => broadcasts.push(msg)
        }
      });

      const onEvent = po._createAgentOnEvent('Jordan', 'req-1', 'Group A');
      onEvent({ type: 'progress', data: 'working' });

      assert.equal(broadcasts.length, 1);
      assert.equal(broadcasts[0].source, 'agent');
      assert.equal(broadcasts[0].persona, 'Jordan');
      assert.equal(broadcasts[0].requirementId, 'req-1');
      assert.equal(broadcasts[0].group, 'Group A');
      assert.deepEqual(broadcasts[0].event, { type: 'progress', data: 'working' });
    });
  });

  describe('_completeSession', () => {
    it('clears progress timer', async () => {
      const { po } = createOrchestrator();
      po._progressTimer = setInterval(() => {}, 999999);

      await po._completeSession();
      assert.equal(po._progressTimer, null);
    });

    it('stops broadcast server when running', async () => {
      let stopped = false;
      const { po } = createOrchestrator({
        broadcastServer: {
          isRunning: true,
          stop: async () => { stopped = true; }
        }
      });

      await po._completeSession();
      assert.equal(stopped, true);
    });

    it('does not throw when broadcast server is not running', async () => {
      const { po } = createOrchestrator({
        broadcastServer: { isRunning: false }
      });

      await assert.doesNotReject(() => po._completeSession());
    });

    it('transitions to SESSION_COMPLETE', async () => {
      let transitionedTo = null;
      const { po } = createOrchestrator({
        stateMachine: {
          transition: async (state) => { transitionedTo = state; },
          getState: () => ({
            sessionId: 's1', sessionBranch: 'b', startedAt: new Date().toISOString(),
            requirements: { pending: [], inProgress: null, completed: [], parked: [] },
            completedMicrocycles: [], consumption: {}, activeAgents: [], preview: null
          }),
          update: async () => {},
          initialize: async () => {},
          load: async () => null
        }
      });

      await po._completeSession();
      assert.equal(transitionedTo, 'SESSION_COMPLETE');
    });
  });

  describe('_pushSessionBranch', () => {
    it('skips push when no completed items', async () => {
      let pushCalled = false;
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => { pushCalled = true; },
          commitAll: async () => 'abc123',
          _git: async () => {},
          ensureWorktreeIgnored: async () => {}
        }
      });
      po.stateMachine.getState = () => ({
        requirements: { completed: [] },
        sessionBranch: 'devshop/session-test'
      });

      await po._pushSessionBranch('test');
      assert.equal(pushCalled, false);
    });

    it('pushes when completed items exist', async () => {
      let pushedBranch = null;
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async (dir, branch) => { pushedBranch = branch; },
          commitAll: async () => 'abc123',
          _git: async () => {},
          ensureWorktreeIgnored: async () => {}
        }
      });
      po.stateMachine.getState = () => ({
        requirements: { completed: ['req-1'] },
        sessionBranch: 'devshop/session-test'
      });

      await po._pushSessionBranch('phase_end');
      assert.equal(pushedBranch, 'devshop/session-test');
    });

    it('logs warning on push failure without throwing', async () => {
      const { po, logEntries } = createOrchestrator({
        gitOps: {
          pushBranch: async () => { throw new Error('network error'); },
          commitAll: async () => 'abc123',
          _git: async () => {},
          ensureWorktreeIgnored: async () => {}
        }
      });
      po.stateMachine.getState = () => ({
        requirements: { completed: ['req-1'] },
        sessionBranch: 'devshop/session-test'
      });

      await assert.doesNotReject(() => po._pushSessionBranch('test'));
      assert.equal(logEntries.some(e => e.event === 'push_failed'), true);
    });
  });

  describe('_handleParkedItem', () => {
    it('parks item and returns false for non-blocking', async () => {
      const { po } = createOrchestrator();

      const result = await po._handleParkedItem(
        { id: 'req-1' },
        { error: 'tests failed', attempts: 2, cost: 1.5 },
        { name: 'Jordan' },
        { letter: 'A' },
        { number: 1, label: 'Core', groups: [] }
      );
      assert.equal(result, false);
    });

    it('returns true and requests pause for blocking park', async () => {
      let pauseRequested = false;
      const { po } = createOrchestrator({
        triage: {
          parkItem: async () => ({ classification: 'blocking' })
        },
        monitor: {
          shouldStop: () => ({ stop: false }),
          getStateForPersistence: () => ({}),
          getSnapshot: () => ({ budgetUsedUsd: 5, budgetRemainingUsd: 25, budgetUsedPct: '16.7' }),
          recordInvocation: () => {},
          totalCostUsd: 5,
          requestPause: () => { pauseRequested = true; },
          installSignalHandlers: () => {},
          removeSignalHandlers: () => {},
          resetCycleCost: () => {}
        }
      });

      const result = await po._handleParkedItem(
        { id: 'req-1' },
        { error: 'critical failure', attempts: 3, cost: 5.0 },
        { name: 'Jordan' },
        { letter: 'A' },
        { number: 1, label: 'Core', groups: [] }
      );
      assert.equal(result, true);
      assert.equal(pauseRequested, true);
    });
  });

  describe('_handleMergedItem', () => {
    it('merges, runs smoke test, marks complete on success', async () => {
      let markedComplete = null;
      let commitMsg = null;
      const { po } = createOrchestrator({
        roadmapReader: {
          markItemComplete: async (id) => { markedComplete = id; },
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getPendingGroups: () => [],
          getParkedItemsInPhase: () => [],
          resetParkedItems: async () => false
        },
        gitOps: {
          pushBranch: async () => {},
          commitAll: async (dir, msg) => { commitMsg = msg; return 'abc123'; },
          _git: async () => {},
          mergeToSession: async () => {},
          checkoutBranch: async () => {},
          getDiffStat: async () => '3 files changed',
          ensureWorktreeIgnored: async () => {}
        }
      });

      const state = po.stateMachine.getState();
      const result = await po._handleMergedItem(
        { id: 'req-1' },
        { status: 'merged', cost: 2.5, attempts: 1, commitSha: 'abc', workBranch: 'work-1', reviewScores: null },
        state, '/tmp/worktree', 'worktree-branch',
        { name: 'Jordan' }, { letter: 'A' },
        { number: 1, label: 'Core', groups: [] }
      );

      assert.equal(result, false);
      assert.equal(markedComplete, 'req-1');
      assert.match(commitMsg, /mark req-1 complete/);
    });

    it('parks item when smoke test fails', async () => {
      let parkedId = null;
      const { po } = createOrchestrator({
        healthGate: {
          runHealthCheckGate: async () => true,
          runPhaseGate: async () => ({ passed: true }),
          runPostMergeSmokeTest: async () => ({ passed: false, error: 'regression' }),
          runArchitectureCheck: async () => {},
          runPreviewCheck: async () => {}
        },
        triage: {
          parkItem: async (id) => { parkedId = id; return { classification: 'non_blocking' }; }
        }
      });

      const state = po.stateMachine.getState();
      await po._handleMergedItem(
        { id: 'req-1' },
        { status: 'merged', cost: 2.5, attempts: 1, commitSha: 'abc', workBranch: 'work-1' },
        state, '/tmp/worktree', 'worktree-branch',
        { name: 'Jordan' }, { letter: 'A' },
        { number: 1, label: 'Core', groups: [] }
      );
      assert.equal(parkedId, 'req-1');
    });
  });

  describe('_handleSalvagedItem', () => {
    it('marks complete when salvage merge and tests succeed', async () => {
      let markedComplete = null;
      const { po } = createOrchestrator({
        roadmapReader: {
          markItemComplete: async (id) => { markedComplete = id; },
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getPendingGroups: () => [],
          getParkedItemsInPhase: () => [],
          resetParkedItems: async () => false
        }
      });

      // Mock the exec call for npm test
      // _handleSalvagedItem uses require('./infra/exec-utils').exec internally
      // We need to make the merge + test succeed
      delete require.cache[require.resolve('./infra/exec-utils')];
      require.cache[require.resolve('./infra/exec-utils')] = {
        id: require.resolve('./infra/exec-utils'),
        filename: require.resolve('./infra/exec-utils'),
        loaded: true,
        exports: {
          exec: async () => ({ stdout: 'pass', stderr: '' }),
          execFile: async () => ({ stdout: '', stderr: '' })
        }
      };

      const state = po.stateMachine.getState();
      const result = await po._handleSalvagedItem(
        { id: 'req-1' },
        { status: 'parked', salvaged: true, cost: 3.0, attempts: 2, workBranch: 'work-1', error: 'partial' },
        state, '/tmp/worktree', 'worktree-branch',
        { name: 'Jordan' }, { letter: 'A' },
        { number: 1, label: 'Core', groups: [] }
      );

      assert.equal(result, false);
      assert.equal(markedComplete, 'req-1');

      // Clean up mock
      delete require.cache[require.resolve('./infra/exec-utils')];
    });

    it('parks item when merge fails and returns blocking status', async () => {
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async () => { throw new Error('merge conflict'); },
          mergeToSession: async () => {},
          checkoutBranch: async () => {},
          getDiffStat: async () => '',
          ensureWorktreeIgnored: async () => {}
        },
        triage: {
          parkItem: async () => ({ classification: 'blocking' })
        }
      });

      // Need to make mergeLock.withLock throw
      po.mergeLock = { withLock: async (fn) => { await fn(); } };

      const state = po.stateMachine.getState();
      const result = await po._handleSalvagedItem(
        { id: 'req-1' },
        { status: 'parked', salvaged: true, cost: 3.0, attempts: 2, workBranch: 'work-1', error: 'failed' },
        state, '/tmp/worktree', 'worktree-branch',
        { name: 'Jordan' }, { letter: 'A' },
        { number: 1, label: 'Core', groups: [] }
      );

      assert.equal(result, true); // blocking → true
    });
  });

  describe('_executePhase', () => {
    it('auto-parks HUMAN items before running groups', async () => {
      const parkedItems = [];
      const { po, logEntries } = createOrchestrator({
        triage: {
          parkItem: async (id, opts) => { parkedItems.push({ id, ...opts }); return { classification: opts.triageClassification }; },
          triageParkedItems: async () => {}
        },
        roadmapReader: {
          getPendingGroups: () => [],
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });

      const phase = {
        number: 1,
        label: 'Core',
        groups: [{
          letter: 'A',
          label: 'Auth',
          items: [
            { id: 'human-1', status: 'pending', isHuman: true, description: 'Manual deploy' },
            { id: 'auto-1', status: 'pending', isHuman: false, description: 'Add login' }
          ]
        }]
      };

      await po._executePhase(phase);
      assert.equal(parkedItems.length, 1);
      assert.equal(parkedItems[0].id, 'human-1');
      assert.match(parkedItems[0].reason, /\[HUMAN\]/);
    });

    it('classifies HUMAN items in Group Z as non_blocking', async () => {
      const parkedItems = [];
      const { po } = createOrchestrator({
        triage: {
          parkItem: async (id, opts) => { parkedItems.push({ id, ...opts }); return { classification: opts.triageClassification }; },
          triageParkedItems: async () => {}
        },
        roadmapReader: {
          getPendingGroups: () => [],
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });

      const phase = {
        number: 1,
        label: 'Core',
        groups: [{
          letter: 'Z',
          label: 'User Testing',
          items: [
            { id: 'test-phase-1', status: 'pending', isHuman: true, description: '[HUMAN] Verify auth flow' }
          ]
        }]
      };

      await po._executePhase(phase);
      assert.equal(parkedItems.length, 1);
      assert.equal(parkedItems[0].triageClassification, 'non_blocking');
    });

    it('classifies HUMAN items in non-Z groups as blocking', async () => {
      const parkedItems = [];
      const { po } = createOrchestrator({
        triage: {
          parkItem: async (id, opts) => { parkedItems.push({ id, ...opts }); return { classification: opts.triageClassification }; },
          triageParkedItems: async () => {}
        },
        roadmapReader: {
          getPendingGroups: () => [],
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });

      const phase = {
        number: 2,
        label: 'Human Prerequisites',
        groups: [{
          letter: 'A',
          label: 'External Services',
          items: [
            { id: 'get-api-keys', status: 'pending', isHuman: true, description: '[HUMAN] Obtain API keys' }
          ]
        }]
      };

      await po._executePhase(phase);
      assert.equal(parkedItems.length, 1);
      assert.equal(parkedItems[0].triageClassification, 'blocking');
    });

    it('pauses orchestrator when phase has only blocking HUMAN items', async () => {
      let pauseRequest = null;
      const { po } = createOrchestrator({
        triage: {
          parkItem: async (id, opts) => { return { classification: opts.triageClassification }; },
          triageParkedItems: async () => {}
        },
        monitor: {
          shouldStop: () => ({ stop: false }),
          requestPause: (req) => { pauseRequest = req; },
          getSnapshot: () => ({}),
          recordInvocation: () => {},
          installSignalHandlers: () => {},
          removeSignalHandlers: () => {},
          resetCycleCost: () => {}
        },
        roadmapReader: {
          getPendingGroups: () => [],
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });

      const phase = {
        number: 2,
        label: 'Human Prerequisites',
        groups: [
          {
            letter: 'A',
            label: 'External Services',
            items: [
              { id: 'get-api-keys', status: 'pending', isHuman: true, description: '[HUMAN] Obtain API keys' },
              { id: 'get-smtp', status: 'pending', isHuman: true, description: '[HUMAN] Get SMTP credentials' }
            ]
          },
          {
            letter: 'Z',
            label: 'User Testing',
            items: [
              { id: 'test-phase-2', status: 'pending', isHuman: true, description: '[HUMAN] Verify credentials stored' }
            ]
          }
        ]
      };

      await po._executePhase(phase);
      assert.notEqual(pauseRequest, null);
      assert.equal(pauseRequest.reason, 'blocking_park');
      assert.equal(pauseRequest.blockingItem.id, 'get-api-keys');
    });

    it('does not pause when phase has agent-executable work alongside HUMAN items', async () => {
      let pauseRequest = null;
      const { po } = createOrchestrator({
        triage: {
          parkItem: async (id, opts) => { return { classification: opts.triageClassification }; },
          triageParkedItems: async () => {}
        },
        monitor: {
          shouldStop: () => ({ stop: false }),
          requestPause: (req) => { pauseRequest = req; },
          getSnapshot: () => ({}),
          recordInvocation: () => {},
          installSignalHandlers: () => {},
          removeSignalHandlers: () => {},
          resetCycleCost: () => {}
        },
        roadmapReader: {
          getPendingGroups: (phase) => phase.groups.filter(g => g.items.some(i => i.status === 'pending')),
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });

      // Mock _executeGroup to avoid full group execution
      po._executeGroup = async () => [];

      const phase = {
        number: 3,
        label: 'Foundation',
        groups: [
          {
            letter: 'A',
            label: 'Data Layer',
            items: [
              { id: 'task-schema', status: 'pending', isHuman: false, description: 'Database schema' }
            ]
          },
          {
            letter: 'B',
            label: 'Human Setup',
            items: [
              { id: 'get-keys', status: 'pending', isHuman: true, description: '[HUMAN] Get API keys' }
            ]
          }
        ]
      };

      await po._executePhase(phase);
      assert.equal(pauseRequest, null);
    });

    it('assigns personas to groups', async () => {
      let assignedCount = 0;
      const { po } = createOrchestrator({
        agentPool: {
          assignMany: (count) => {
            assignedCount = count;
            return Array.from({ length: count }, (_, i) => ({
              name: `Agent-${i}`, agentType: 'implementation-agent'
            }));
          }
        },
        roadmapReader: {
          getPendingGroups: (phase) => phase.groups.filter(g => g.items.some(i => i.status === 'pending')),
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });

      // Mock _executeGroup to avoid full group execution
      po._executeGroup = async () => [];

      const phase = {
        number: 1,
        label: 'Core',
        groups: [
          { letter: 'A', label: 'Auth', items: [{ id: 'r1', status: 'pending', isHuman: false }] },
          { letter: 'B', label: 'API', items: [{ id: 'r2', status: 'pending', isHuman: false }] }
        ]
      };

      await po._executePhase(phase);
      assert.equal(assignedCount, 2);
    });
  });

  describe('_runPhases', () => {
    it('stops when consumption limit reached', async () => {
      const { po, logEntries } = createOrchestrator({
        monitor: {
          shouldStop: () => ({ stop: true, reason: 'budget_exhausted' }),
          getStateForPersistence: () => ({}),
          getSnapshot: () => ({}),
          recordInvocation: () => {},
          totalCostUsd: 30,
          requestPause: () => {},
          installSignalHandlers: () => {},
          removeSignalHandlers: () => {},
          resetCycleCost: () => {}
        },
        roadmapReader: {
          parse: async () => ({ title: 'Test', phases: [{ number: 1, label: 'Core', groups: [] }] }),
          isComplete: () => false,
          getNextPhase: () => ({ number: 1, label: 'Core', groups: [] }),
          getAllItems: () => [{ id: 'r1', status: 'pending' }],
          getPendingGroups: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });

      await po._runPhases({ title: 'Test', phases: [] });
      assert.equal(logEntries.some(e => e.event === 'graceful_shutdown'), true);
    });

    it('completes when all phases done', async () => {
      let completeCalled = false;
      const { po } = createOrchestrator({
        roadmapReader: {
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => true,
          getNextPhase: () => null,
          getAllItems: () => [],
          getPendingGroups: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        }
      });
      po._completeSession = async () => { completeCalled = true; };

      await po._runPhases({ title: 'Test', phases: [] });
      assert.equal(completeCalled, true);
    });

    it('handles consecutive failures and parks items', async () => {
      let parseCount = 0;
      let parkedIds = [];
      const { po, logEntries } = createOrchestrator({
        roadmapReader: {
          parse: async () => {
            parseCount++;
            // After parking, items are no longer pending — let isComplete kick in
            if (parkedIds.length > 0) {
              return { title: 'Test', phases: [] };
            }
            return {
              title: 'Test',
              phases: [{
                number: 1, label: 'Core',
                groups: [{ letter: 'A', label: 'Auth', items: [{ id: 'r1', status: 'pending' }] }]
              }]
            };
          },
          isComplete: (roadmap) => parkedIds.length > 0, // Complete once items are parked
          isSpikePhase: () => false,
          getNextPhase: () => {
            if (parkedIds.length > 0) return null;
            return {
              number: 1, label: 'Core',
              groups: [{ letter: 'A', label: 'Auth', items: [{ id: 'r1', status: 'pending' }] }]
            };
          },
          getAllItems: () => [{ id: 'r1', status: 'pending' }],
          getPendingGroups: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        },
        triage: {
          parkItem: async (id) => { parkedIds.push(id); return { classification: 'non_blocking' }; },
          triageParkedItems: async () => {}
        },
        repair: {
          runProjectDiagnostic: async () => ({ success: false, skipped: true })
        }
      });

      po._executePhase = async () => {};
      po._processReportQueue = async () => {};
      po._checkPhaseBudget = async () => {};

      await po._runPhases({ title: 'Test', phases: [] });
      // After 3 consecutive failures on the same phase, items should be parked
      assert.equal(parkedIds.includes('r1'), true);
    });
  });

  describe('_executeSpikeItems', () => {
    it('calls agentRunner.runAgent with spike agent config', async () => {
      let agentCall = null;
      const { po } = createOrchestrator({
        agentRunner: {
          runAgent: async (opts) => {
            agentCall = opts;
            return { success: true, cost: 1.5, duration: 5000, output: 'findings' };
          }
        },
        config: {
          budgetLimitUsd: 30,
          retryLimits: { implementation: 3, testFix: 3, reviewFix: 2 },
          agents: {
            'implementation': { model: 'test', maxBudgetUsd: 5, timeoutMs: 60000, allowedTools: [] },
            'principal-engineer': { model: 'test', maxBudgetUsd: 2, timeoutMs: 60000, allowedTools: [] },
            'spike': { model: 'test-spike', maxBudgetUsd: 3, timeoutMs: 300000, allowedTools: ['Bash', 'Read', 'Write', 'Glob', 'Grep'] }
          },
          git: { commitPrefix: 'feat' }
        },
        templateEngine: {
          renderAgentPrompt: async (agentType, vars) => `spike prompt for ${vars.SPIKE_ID}`
        }
      });

      const phase = { number: 1, label: 'Spikes' };
      const spikeItems = [
        { id: 'spike-stripe', description: '[SPIKE] Validate Stripe checkout', status: 'pending', isSpike: true }
      ];

      await po._executeSpikeItems(phase, spikeItems);

      assert.ok(agentCall, 'runAgent should have been called');
      assert.equal(agentCall.model, 'test-spike');
      assert.equal(agentCall.maxBudgetUsd, 3);
      assert.match(agentCall.systemPrompt, /spike prompt for spike-stripe/);
    });

    it('marks item complete on success', async () => {
      let markedComplete = null;
      const { po } = createOrchestrator({
        agentRunner: {
          runAgent: async () => ({ success: true, cost: 1.0, duration: 3000, output: 'done' })
        },
        config: {
          budgetLimitUsd: 30,
          retryLimits: { implementation: 3, testFix: 3, reviewFix: 2 },
          agents: {
            'implementation': { model: 'test', maxBudgetUsd: 5, timeoutMs: 60000, allowedTools: [] },
            'principal-engineer': { model: 'test', maxBudgetUsd: 2, timeoutMs: 60000, allowedTools: [] },
            'spike': { model: 'test', maxBudgetUsd: 3, timeoutMs: 300000, allowedTools: [] }
          },
          git: { commitPrefix: 'feat' }
        },
        roadmapReader: {
          markItemComplete: async (id) => { markedComplete = id; },
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getPendingGroups: () => [],
          getParkedItemsInPhase: () => [],
          resetParkedItems: async () => false
        },
        templateEngine: {
          renderAgentPrompt: async () => 'spike prompt'
        }
      });

      await po._executeSpikeItems(
        { number: 1, label: 'Spikes' },
        [{ id: 'spike-api', description: '[SPIKE] Test API', status: 'pending', isSpike: true }]
      );

      assert.equal(markedComplete, 'spike-api');
    });

    it('parks item on failure', async () => {
      let parkedId = null;
      const { po } = createOrchestrator({
        agentRunner: {
          runAgent: async () => ({ success: false, cost: 0.5, duration: 2000, output: '', error: 'agent failed' })
        },
        config: {
          budgetLimitUsd: 30,
          retryLimits: { implementation: 3, testFix: 3, reviewFix: 2 },
          agents: {
            'implementation': { model: 'test', maxBudgetUsd: 5, timeoutMs: 60000, allowedTools: [] },
            'principal-engineer': { model: 'test', maxBudgetUsd: 2, timeoutMs: 60000, allowedTools: [] },
            'spike': { model: 'test', maxBudgetUsd: 3, timeoutMs: 300000, allowedTools: [] }
          },
          git: { commitPrefix: 'feat' }
        },
        triage: {
          parkItem: async (id) => { parkedId = id; return { classification: 'non_blocking' }; },
          triageParkedItems: async () => {}
        },
        templateEngine: {
          renderAgentPrompt: async () => 'spike prompt'
        }
      });

      await po._executeSpikeItems(
        { number: 1, label: 'Spikes' },
        [{ id: 'spike-api', description: '[SPIKE] Test API', status: 'pending', isSpike: true }]
      );

      assert.equal(parkedId, 'spike-api');
    });
  });

  describe('_executePhase with spike items', () => {
    it('executes spike items before normal group execution', async () => {
      const callOrder = [];
      const { po } = createOrchestrator({
        agentRunner: {
          runAgent: async () => {
            callOrder.push('spike_agent');
            return { success: true, cost: 1.0, duration: 3000, output: 'done' };
          }
        },
        config: {
          budgetLimitUsd: 30,
          retryLimits: { implementation: 3, testFix: 3, reviewFix: 2 },
          agents: {
            'implementation': { model: 'test', maxBudgetUsd: 5, timeoutMs: 60000, allowedTools: [] },
            'principal-engineer': { model: 'test', maxBudgetUsd: 2, timeoutMs: 60000, allowedTools: [] },
            'spike': { model: 'test', maxBudgetUsd: 3, timeoutMs: 300000, allowedTools: [] }
          },
          git: { commitPrefix: 'feat' }
        },
        roadmapReader: {
          markItemComplete: async () => {},
          getPendingGroups: () => [],
          parse: async () => ({ title: 'Test', phases: [] }),
          isComplete: () => false,
          getNextPhase: () => null,
          getAllItems: () => [],
          getParkedItemsInPhase: () => [],
          resetParkedItems: async () => false
        },
        templateEngine: {
          renderAgentPrompt: async () => 'spike prompt'
        }
      });

      const phase = {
        number: 1,
        label: 'Spikes',
        groups: [{
          letter: 'A',
          label: 'Validation',
          items: [
            { id: 'spike-api', status: 'pending', isSpike: true, isHuman: false, description: '[SPIKE] Test API' },
            { id: 'setup-db', status: 'pending', isSpike: false, isHuman: false, description: 'Setup DB' }
          ]
        }]
      };

      await po._executePhase(phase);
      assert.ok(callOrder.includes('spike_agent'), 'spike agent should have been called');
    });
  });

  describe('_runPhases spike pause', () => {
    it('pauses after spike-only phase with spike_review_pending', async () => {
      let completeCalled = false;
      let pushContext = null;
      const { po, logEntries } = createOrchestrator({
        roadmapReader: {
          parse: async () => ({
            title: 'Test',
            phases: [{
              number: 'I', label: 'Spikes',
              groups: [{
                letter: 'A', label: 'Validation',
                items: [
                  { id: 'spike-api', status: 'pending', isSpike: true, isHuman: false, description: '[SPIKE] Test API' }
                ]
              }]
            }]
          }),
          isComplete: () => false,
          isSpikePhase: (phase) => {
            const pending = phase.groups.flatMap(g => g.items.filter(i => i.status === 'pending'));
            return pending.length > 0 && pending.every(i => i.isSpike);
          },
          getNextPhase: (roadmap) => roadmap.phases[0],
          getAllItems: () => [{ id: 'spike-api', status: 'pending' }],
          getPendingGroups: () => [],
          getParkedItemsInPhase: () => [],
          markItemComplete: async () => {},
          resetParkedItems: async () => false
        },
        gitOps: {
          pushBranch: async (dir, branch) => { pushContext = 'pushed'; },
          commitAll: async () => 'abc123',
          _git: async () => {},
          ensureWorktreeIgnored: async () => {},
          mergeToSession: async () => {},
          checkoutBranch: async () => {},
          branchExists: async () => false,
          getDiffStat: async () => ''
        }
      });

      po._completeSession = async () => { completeCalled = true; };
      po._executePhase = async () => {};
      po._checkPhaseBudget = async () => {};

      await po._runPhases({ title: 'Test', phases: [] });

      assert.equal(completeCalled, true);
      assert.equal(po._spikeReviewPending, true);
    });
  });

  describe('_getStopReason with spike', () => {
    it('returns spike_review_pending when spike flag is set', () => {
      const { po } = createOrchestrator();
      po._spikeReviewPending = true;
      const reason = po._getStopReason({
        requirements: { pending: ['req-1'], inProgress: null }
      });
      assert.equal(reason, 'spike_review_pending');
    });
  });

  describe('_extractPriorWorkDiffs', () => {
    it('extracts diffs for infra-failure parked items with matching branches', async () => {
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async (cwd, args) => {
            if (args[0] === 'branch' && args[1] === '--list') {
              return { stdout: '  devshop/work-old-session/req-1\n  devshop/work-old-session/req-2\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
          },
          getBranchDiff: async (dir, branch) => {
            if (branch.includes('req-1')) return { diffStat: '2 files changed', diff: '+new code' };
            if (branch.includes('req-2')) return { diffStat: '1 file changed', diff: '+other code' };
            return { diffStat: '', diff: '' };
          },
          ensureWorktreeIgnored: async () => {}
        }
      });

      const existingState = {
        requirements: {
          parked: [
            { id: 'req-1', reason: 'Agent timed out after 5 minutes' },
            { id: 'req-2', reason: 'SIGKILL during execution' }
          ]
        }
      };

      await po._extractPriorWorkDiffs(existingState);

      assert.ok(po._priorWorkDiffs);
      assert.equal(po._priorWorkDiffs.size, 2);
      assert.equal(po._priorWorkDiffs.get('req-1').diff, '+new code');
      assert.equal(po._priorWorkDiffs.get('req-2').diff, '+other code');
    });

    it('skips non-infra failures', async () => {
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async (cwd, args) => {
            if (args[0] === 'branch' && args[1] === '--list') {
              return { stdout: '  devshop/work-old/req-1\n  devshop/work-old/req-2\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
          },
          getBranchDiff: async () => ({ diffStat: '1 file', diff: '+code' }),
          ensureWorktreeIgnored: async () => {}
        }
      });

      const existingState = {
        requirements: {
          parked: [
            { id: 'req-1', reason: 'Tests failed: 3 assertions' },
            { id: 'req-2', reason: 'Review rejected: missing error handling' }
          ]
        }
      };

      await po._extractPriorWorkDiffs(existingState);
      assert.equal(po._priorWorkDiffs, null);
    });

    it('handles mixed infra and non-infra failures', async () => {
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async (cwd, args) => {
            if (args[0] === 'branch' && args[1] === '--list') {
              return { stdout: '  devshop/work-old/req-1\n  devshop/work-old/req-2\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
          },
          getBranchDiff: async () => ({ diffStat: '1 file', diff: '+code' }),
          ensureWorktreeIgnored: async () => {}
        }
      });

      const existingState = {
        requirements: {
          parked: [
            { id: 'req-1', reason: 'Process exited with SIGTERM' },
            { id: 'req-2', reason: 'Review rejected: bad code' }
          ]
        }
      };

      await po._extractPriorWorkDiffs(existingState);
      assert.ok(po._priorWorkDiffs);
      assert.equal(po._priorWorkDiffs.size, 1);
      assert.ok(po._priorWorkDiffs.has('req-1'));
      assert.ok(!po._priorWorkDiffs.has('req-2'));
    });

    it('returns early when no parked items', async () => {
      const { po } = createOrchestrator();
      await po._extractPriorWorkDiffs({ requirements: { parked: [] } });
      assert.equal(po._priorWorkDiffs, null);
    });

    it('returns early when existingState has no requirements', async () => {
      const { po } = createOrchestrator();
      await po._extractPriorWorkDiffs({});
      assert.equal(po._priorWorkDiffs, null);
    });

    it('handles git branch list failure gracefully', async () => {
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async () => { throw new Error('git not found'); },
          ensureWorktreeIgnored: async () => {}
        }
      });

      const existingState = {
        requirements: {
          parked: [{ id: 'req-1', reason: 'Timeout occurred' }]
        }
      };

      await po._extractPriorWorkDiffs(existingState);
      assert.equal(po._priorWorkDiffs, null);
    });

    it('skips branches with no matching parked requirement', async () => {
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async (cwd, args) => {
            if (args[0] === 'branch' && args[1] === '--list') {
              return { stdout: '  devshop/work-old/unrelated-req\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
          },
          getBranchDiff: async () => ({ diffStat: '1 file', diff: '+code' }),
          ensureWorktreeIgnored: async () => {}
        }
      });

      const existingState = {
        requirements: {
          parked: [{ id: 'req-1', reason: 'Timed out' }]
        }
      };

      await po._extractPriorWorkDiffs(existingState);
      assert.equal(po._priorWorkDiffs, null);
    });

    it('skips branches with empty diff', async () => {
      const { po } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async (cwd, args) => {
            if (args[0] === 'branch' && args[1] === '--list') {
              return { stdout: '  devshop/work-old/req-1\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
          },
          getBranchDiff: async () => ({ diffStat: '', diff: '' }),
          ensureWorktreeIgnored: async () => {}
        }
      });

      const existingState = {
        requirements: {
          parked: [{ id: 'req-1', reason: 'maxBuffer exceeded' }]
        }
      };

      await po._extractPriorWorkDiffs(existingState);
      assert.equal(po._priorWorkDiffs, null);
    });

    it('handles getBranchDiff failure gracefully', async () => {
      const { po, logEntries } = createOrchestrator({
        gitOps: {
          pushBranch: async () => {},
          commitAll: async () => 'abc123',
          _git: async (cwd, args) => {
            if (args[0] === 'branch' && args[1] === '--list') {
              return { stdout: '  devshop/work-old/req-1\n', stderr: '' };
            }
            return { stdout: '', stderr: '' };
          },
          getBranchDiff: async () => { throw new Error('diff exploded'); },
          ensureWorktreeIgnored: async () => {}
        }
      });

      const existingState = {
        requirements: {
          parked: [{ id: 'req-1', reason: 'Timeout' }]
        }
      };

      await po._extractPriorWorkDiffs(existingState);
      assert.equal(po._priorWorkDiffs, null);
      assert.ok(logEntries.some(e => e.event === 'prior_work_diff_failed'));
    });

    it('matches all INFRA_FAILURE_PATTERNS', async () => {
      const testReasons = [
        'Agent timed out',
        'timeout exceeded',
        'null bytes in output',
        'maxBuffer exceeded',
        'STDIO_MAXBUFFER limit reached',
        'process error during execution',
        'process exited unexpectedly',
        'Received SIGTERM',
        'Killed by SIGKILL',
        'phase stuck after 3 consecutive failures',
        'consecutive failures detected'
      ];

      for (const reason of testReasons) {
        const { po } = createOrchestrator({
          gitOps: {
            pushBranch: async () => {},
            commitAll: async () => 'abc123',
            _git: async (cwd, args) => {
              if (args[0] === 'branch' && args[1] === '--list') {
                return { stdout: '  devshop/work-old/req-1\n', stderr: '' };
              }
              return { stdout: '', stderr: '' };
            },
            getBranchDiff: async () => ({ diffStat: '1 file', diff: '+code' }),
            ensureWorktreeIgnored: async () => {}
          }
        });

        await po._extractPriorWorkDiffs({
          requirements: {
            parked: [{ id: 'req-1', reason }]
          }
        });

        assert.ok(po._priorWorkDiffs, `Should match infra pattern: "${reason}"`);
        assert.equal(po._priorWorkDiffs.size, 1);
      }
    });
  });

  describe('_getProjectListing', () => {
    it('returns listing containing files from the project directory', () => {
      const { po } = createOrchestrator({
        cliOptions: { projectDir: process.cwd() }
      });
      const listing = po._getProjectListing();
      // The project directory should contain package.json at minimum
      assert.ok(listing.includes('package.json'), 'listing should include package.json');
    });
  });
});
