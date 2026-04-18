const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ParallelOrchestrator } = require('./parallel-orchestrator');

function createOrchestrator(overrides = {}) {
  const logs = [];
  const orch = new ParallelOrchestrator({ projectDir: '/proj', projectId: 'proj-001' });

  orch.logger = {
    log: async (level, event, data) => {
      logs.push({ level, event, data });
    }
  };

  orch.config = {
    agents: {
      'principal-engineer': {
        model: 'test',
        maxBudgetUsd: 2.00,
        timeoutMs: 60000,
        allowedTools: []
      }
    }
  };

  orch.templateEngine = {
    renderAgentPrompt: async () => 'system prompt'
  };

  orch.monitor = {
    recordInvocation: () => {}
  };

  orch.cliOptions = { projectDir: '/proj', projectId: 'proj-001' };

  // Mock directory listing so tests don't need a real filesystem
  orch._getProjectListing = () => './package.json\n./next.config.js\n./src/app/page.tsx';

  orch._techStack = overrides.techStack !== undefined ? overrides.techStack : 'Next.js, TypeScript, Tailwind CSS';

  orch.agentRunner = {
    runAgent: async () => ({
      success: true,
      cost: 0.50,
      output: overrides.reviewOutput || JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 5, test_coverage: 4, code_quality: 4, security: 5, simplicity: 4 },
        summary: 'Architecture matches',
        issues: []
      })
    }),
    ...overrides.agentRunner
  };

  return { orch, logs };
}

describe('Architecture Checkpoint', () => {
  it('logs architecture_validated when review returns APPROVE', async () => {
    const { orch, logs } = createOrchestrator({
      reviewOutput: JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 5 },
        summary: 'Architecture matches Next.js',
        issues: []
      })
    });

    await orch.healthGate.runArchitectureCheck();

    const validated = logs.find(l => l.event === 'architecture_validated');
    assert.ok(validated, 'should log architecture_validated');
    assert.equal(validated.level, 'info');
    assert.equal(validated.data.summary, 'Architecture matches Next.js');
  });

  it('logs architecture_mismatch when review returns REQUEST_CHANGES', async () => {
    const { orch, logs } = createOrchestrator({
      reviewOutput: JSON.stringify({
        decision: 'REQUEST_CHANGES',
        scores: { spec_adherence: 2 },
        summary: 'Project uses Express instead of Next.js',
        issues: [{ severity: 'critical', description: 'Wrong framework' }]
      })
    });

    await orch.healthGate.runArchitectureCheck();

    const mismatch = logs.find(l => l.event === 'architecture_mismatch');
    assert.ok(mismatch, 'should log architecture_mismatch');
    assert.equal(mismatch.level, 'warn');
    assert.equal(mismatch.data.summary, 'Project uses Express instead of Next.js');
    assert.equal(mismatch.data.issues.length, 1);
  });

  it('runs only once per session', async () => {
    const { orch, logs } = createOrchestrator();

    await orch.healthGate.runArchitectureCheck();
    await orch.healthGate.runArchitectureCheck();
    await orch.healthGate.runArchitectureCheck();

    const validated = logs.filter(l => l.event === 'architecture_validated');
    assert.equal(validated.length, 1, 'should only log once');
  });

  it('is non-fatal on agent failure', async () => {
    const { orch, logs } = createOrchestrator({
      agentRunner: {
        runAgent: async () => ({ success: false, cost: 0.10, error: 'Agent timed out' })
      }
    });

    // Should not throw
    await orch.healthGate.runArchitectureCheck();

    const failed = logs.find(l => l.event === 'architecture_check_failed');
    assert.ok(failed, 'should log architecture_check_failed');
    assert.equal(failed.level, 'warn');
  });

  it('is non-fatal on unexpected error', async () => {
    const { orch, logs } = createOrchestrator({
      agentRunner: {
        runAgent: async () => { throw new Error('Network error'); }
      }
    });

    // Should not throw
    await orch.healthGate.runArchitectureCheck();

    const errLog = logs.find(l => l.event === 'architecture_check_error');
    assert.ok(errLog, 'should log architecture_check_error');
    assert.equal(errLog.level, 'warn');
    assert.ok(errLog.data.error.includes('Network error'));
  });

  it('skips when tech stack is "Not specified"', async () => {
    const { orch, logs } = createOrchestrator({ techStack: 'Not specified' });

    await orch.healthGate.runArchitectureCheck();

    assert.equal(logs.length, 0, 'should not log anything');
    assert.equal(orch._architectureCheckDone, true, 'flag should still be set');
  });

  it('skips when tech stack is not set', async () => {
    const { orch, logs } = createOrchestrator({ techStack: null });

    await orch.healthGate.runArchitectureCheck();

    assert.equal(logs.length, 0, 'should not log anything');
  });
});
