const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ParallelOrchestrator } = require('../parallel-orchestrator');
const { AgentSession } = require('../agents/agent-session');

const originalChat = AgentSession.prototype.chat;

function createOrchestrator(overrides = {}) {
  const logs = [];
  const transitions = [];
  const stateUpdates = [];

  const orch = new ParallelOrchestrator({
    projectDir: '/proj',
    projectId: 'proj-001',
    templatesDir: '/templates',
    githubRepo: 'test/repo',
    resume: false
  });

  orch.logger = {
    log: async (level, event, data) => {
      logs.push({ level, event, data });
    }
  };

  orch.config = {
    agents: {
      pair: {
        model: 'test',
        maxBudgetUsd: 5.00,
        timeoutMs: 600000,
        allowedTools: ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit']
      },
      'principal-engineer': {
        model: 'test',
        maxBudgetUsd: 2.00,
        timeoutMs: 120000,
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash']
      },
      diagnostic: {
        model: 'test',
        maxBudgetUsd: 3.00,
        timeoutMs: 300000,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']
      }
    }
  };

  orch.templateEngine = {
    renderAgentPrompt: async () => 'system prompt',
    renderString: (template, vars) => {
      let result = template;
      for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(`{{${key}}}`, String(value));
      }
      return result;
    },
    _resolvePartials: async (template) => template
  };

  let currentState = 'SELECTING_REQUIREMENT';
  orch.stateMachine = {
    getState: () => ({
      state: currentState,
      sessionBranch: 'devshop/session-test',
      projectId: 'proj-001',
      requirements: {
        parked: overrides.parkedItems || [{ id: 'req-1', reason: 'Tests failed' }],
        pending: ['req-2'],
        completed: overrides.completedItems || ['req-0']
      },
      consumption: { totalCostUsd: 5.00, totalDurationMs: 60000, agentInvocations: 3 }
    }),
    transition: async (newState, updates) => {
      transitions.push({ to: newState, updates });
      currentState = newState;
    },
    update: async (updates) => {
      stateUpdates.push(updates);
    }
  };

  orch.monitor = {
    recordInvocation: () => {},
    getStateForPersistence: () => ({ totalCostUsd: 5.00, totalDurationMs: 60000, agentInvocations: 3 })
  };

  orch.gitOps = {
    commitAll: async () => 'sha123',
    _git: async () => ({ stdout: '', stderr: '' }),
    consolidateToMain: async () => {},
    pushBranch: async () => {}
  };

  orch.agentRunner = {
    runAgent: overrides.runAgent || (async () => ({
      success: true,
      cost: 1.50,
      duration: 10000,
      output: 'Fixed the issues'
    }))
  };

  orch.openspec = {
    getRequirementById: async () => null
  };

  orch._techStack = 'Next.js, TypeScript';
  orch._conventions = null;
  orch._createAgentOnEvent = () => undefined;
  orch._diagnosticAttempted = new Set();

  return { orch, logs, transitions, stateUpdates };
}

describe('RepairOrchestrator — handleBlockingFix', () => {
  afterEach(() => {
    AgentSession.prototype.chat = originalChat;
  });

  it('consolidates, runs Morgan, and returns restart on success', async () => {
    let consolidated = false;

    const { orch, logs, transitions } = createOrchestrator();
    orch.gitOps.consolidateToMain = async () => { consolidated = true; };

    // Stub attemptMorganFix to avoid needing to mock execFile
    orch.repair.attemptMorganFix = async () => ({ success: true });

    const result = await orch.repair.handleBlockingFix({ id: 'req-1', error: 'Tests failed' });

    assert.deepEqual(result, { restart: true });
    assert.equal(consolidated, true);
    assert.ok(logs.find(l => l.event === 'blocking_fix_started'));
    assert.ok(logs.find(l => l.event === 'blocking_fix_consolidated'));
    assert.ok(transitions.find(t => t.to === 'BLOCKING_FIX'));
  });

  it('skips consolidation when no completed work', async () => {
    const { orch, logs } = createOrchestrator({ completedItems: [] });

    orch.repair.attemptMorganFix = async () => ({ success: true });

    const result = await orch.repair.handleBlockingFix({ id: 'req-1', error: 'Tests failed' });

    assert.deepEqual(result, { restart: true });
    // Should not have logged consolidation
    assert.ok(!logs.find(l => l.event === 'blocking_fix_consolidated'));
  });

  it('falls back to pair mode when consolidation fails', async () => {
    const { orch, logs } = createOrchestrator();
    orch.gitOps.consolidateToMain = async () => { throw new Error('Network error'); };

    let pairCalled = false;
    orch.repair.blockingFixPairFallback = async () => { pairCalled = true; return undefined; };

    await orch.repair.handleBlockingFix({ id: 'req-1', error: 'Tests failed' });

    assert.ok(pairCalled);
    assert.ok(logs.find(l => l.event === 'blocking_fix_consolidation_failed'));
  });

  it('falls back to pair mode when Morgan fix fails', async () => {
    const { orch } = createOrchestrator();

    orch.repair.attemptMorganFix = async () => ({ success: false });

    let pairCalled = false;
    orch.repair.blockingFixPairFallback = async () => { pairCalled = true; return undefined; };

    await orch.repair.handleBlockingFix({ id: 'req-1', error: 'Tests failed' });

    assert.ok(pairCalled);
  });
});

describe('RepairOrchestrator — attemptMorganFix', () => {
  afterEach(() => {
    AgentSession.prototype.chat = originalChat;
  });

  it('returns failure when agent returns unsuccessful result', async () => {
    AgentSession.prototype.chat = async function() {
      return { response: '', cost: 0.50, success: false, error: 'Agent failed' };
    };

    const { orch, logs } = createOrchestrator();
    const result = await orch.repair.attemptMorganFix({ id: 'req-1', error: 'Tests failed' });

    assert.equal(result.success, false);
    assert.ok(logs.find(l => l.event === 'morgan_fix_agent_failed'));
  });

  it('returns failure when agent throws error', async () => {
    AgentSession.prototype.chat = async function() {
      throw new Error('Agent crashed');
    };

    const { orch, logs } = createOrchestrator();
    const result = await orch.repair.attemptMorganFix({ id: 'req-1', error: 'Tests failed' });

    assert.equal(result.success, false);
    assert.ok(logs.find(l => l.event === 'morgan_fix_error'));
  });

  it('includes requirement spec in prompt when available', async () => {
    let capturedPrompt = null;

    AgentSession.prototype.chat = async function(msg) {
      capturedPrompt = msg;
      return { response: '', cost: 0.50, success: false };
    };

    const { orch } = createOrchestrator();
    orch.openspec.getRequirementById = async () => ({
      id: 'req-1',
      name: 'User auth',
      bullets: ['Login flow', 'Signup flow']
    });

    await orch.repair.attemptMorganFix({ id: 'req-1', error: 'Tests failed' });

    assert.ok(capturedPrompt.includes('User auth'));
    assert.ok(capturedPrompt.includes('Login flow'));
  });
});

describe('RepairOrchestrator — runDiagnosticFix', () => {
  afterEach(() => {
    AgentSession.prototype.chat = originalChat;
  });

  it('returns success and commits when agent succeeds', async () => {
    let committed = false;

    AgentSession.prototype.chat = async function() {
      return { response: 'Fixed', cost: 0.50, success: true };
    };

    const { orch } = createOrchestrator();
    orch.gitOps.commitAll = async () => { committed = true; return 'sha'; };

    const result = await orch.repair.runDiagnosticFix('Post-merge smoke test failed');

    assert.equal(result.success, true);
    assert.equal(committed, true);
  });

  it('returns failure when agent returns unsuccessful result', async () => {
    AgentSession.prototype.chat = async function() {
      return { response: '', cost: 0.30, success: false };
    };

    const { orch } = createOrchestrator();
    const result = await orch.repair.runDiagnosticFix('Test output: FAIL');

    assert.equal(result.success, false);
  });

  it('records invocation cost', async () => {
    let recordedCost = null;

    AgentSession.prototype.chat = async function() {
      return { response: 'Fixed', cost: 0.75, success: true };
    };

    const { orch } = createOrchestrator();
    orch.monitor.recordInvocation = (cost) => { recordedCost = cost; };

    await orch.repair.runDiagnosticFix('Test failed');

    assert.equal(recordedCost, 0.75);
  });
});

describe('RepairOrchestrator — runProjectDiagnostic', () => {
  it('runs diagnostic agent and returns result', async () => {
    const { orch, logs } = createOrchestrator({
      runAgent: async () => ({
        success: true,
        cost: 2.00,
        duration: 30000,
        output: 'Diagnosed and fixed'
      })
    });

    const fs = require('fs/promises');
    const origReadFile = fs.readFile;
    fs.readFile = async (filePath, encoding) => {
      if (filePath.includes('diagnostic-prompt.md')) return 'diagnostic prompt {{PROJECT_DIR}}';
      return origReadFile(filePath, encoding);
    };

    try {
      const result = await orch.repair.runProjectDiagnostic({ number: 1, label: 'Core' });

      assert.equal(result.success, true);
      assert.ok(logs.find(l => l.event === 'diagnostic_started'));
    } finally {
      fs.readFile = origReadFile;
    }
  });

  it('deduplicates via _diagnosticAttempted set', async () => {
    const { orch } = createOrchestrator();

    // First call — mark as attempted
    orch._diagnosticAttempted.add('Phase 1');

    const result = await orch.repair.runProjectDiagnostic({ number: 1, label: 'Core' });

    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
  });

  it('records invocation cost', async () => {
    let recordedCost = null;
    const { orch } = createOrchestrator({
      runAgent: async () => ({
        success: true,
        cost: 2.50,
        duration: 20000,
        output: 'Fixed'
      })
    });

    orch.monitor.recordInvocation = (cost) => { recordedCost = cost; };

    const fs = require('fs/promises');
    const origReadFile = fs.readFile;
    fs.readFile = async (filePath, encoding) => {
      if (filePath.includes('diagnostic-prompt.md')) return 'prompt';
      return origReadFile(filePath, encoding);
    };

    try {
      await orch.repair.runProjectDiagnostic({ number: 2, label: 'Features' });
      assert.equal(recordedCost, 2.50);
    } finally {
      fs.readFile = origReadFile;
    }
  });
});
