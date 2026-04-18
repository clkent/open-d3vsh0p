const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ParallelOrchestrator } = require('./parallel-orchestrator');
const { AgentSession } = require('./agents/agent-session');

// Stub the health-checker module
const healthChecker = require('./quality/health-checker');
const originalRunHealthCheck = healthChecker.runHealthCheck;
const originalResolveConfig = healthChecker.resolveHealthCheckConfig;
const originalDetectCommands = healthChecker.detectHealthCheckCommands;
const originalChat = AgentSession.prototype.chat;

function createOrchestrator(overrides = {}) {
  const logs = [];
  const transitions = [];

  const orch = new ParallelOrchestrator({
    projectDir: '/proj',
    projectId: 'proj-001',
    templatesDir: '/templates',
    resume: overrides.resume || false
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
      }
    },
    healthCheck: overrides.healthCheckConfig || { commands: [], timeoutMs: 120000 }
  };

  orch.templateEngine = {
    renderString: (template, vars) => {
      let result = template;
      for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(`{{${key}}}`, String(value));
      }
      return result;
    },
    renderAgentPrompt: async () => 'system prompt',
    _resolvePartials: async (template) => template
  };

  let currentState = 'SELECTING_REQUIREMENT';
  orch.stateMachine = {
    getState: () => ({
      state: currentState,
      requirements: { parked: [], pending: ['req-1'], completed: [] },
      consumption: { totalCostUsd: 0, totalDurationMs: 0, agentInvocations: 0 }
    }),
    transition: async (newState, updates) => {
      transitions.push({ to: newState, updates });
      currentState = newState;
    },
    update: async () => {}
  };

  orch.monitor = {
    recordInvocation: () => {},
    getStateForPersistence: () => ({ totalCostUsd: 0, totalDurationMs: 0, agentInvocations: 0 })
  };

  orch.gitOps = {
    commitAll: async () => {},
    _git: async () => {}
  };

  orch.agentRunner = {
    runAgent: async () => ({
      success: true,
      cost: 1.50,
      output: 'Fixed the issues',
      sessionId: 'session-123'
    })
  };

  orch._techStack = 'Next.js, TypeScript';
  orch._conventions = null;

  return { orch, logs, transitions };
}

describe('Project Repair — healthGate.runHealthCheckGate', () => {
  afterEach(() => {
    healthChecker.runHealthCheck = originalRunHealthCheck;
    healthChecker.resolveHealthCheckConfig = originalResolveConfig;
    healthChecker.detectHealthCheckCommands = originalDetectCommands;
    AgentSession.prototype.chat = originalChat;
  });

  it('returns true when no health check commands are configured', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: [],
      timeoutMs: 120000
    });

    const { orch, logs } = createOrchestrator();
    const result = await orch.healthGate.runHealthCheckGate();

    assert.equal(result, true);
    const skipped = logs.find(l => l.event === 'health_check_skipped');
    assert.ok(skipped, 'should log health_check_skipped');
  });

  it('returns true when all health check commands pass', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: true,
      results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
    });

    const { orch, logs } = createOrchestrator();
    const result = await orch.healthGate.runHealthCheckGate();

    assert.equal(result, true);
    assert.ok(logs.find(l => l.event === 'health_check_started'));
    assert.ok(logs.find(l => l.event === 'health_check_passed'));
  });

  it('transitions to PROJECT_REPAIR when health check fails', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    });

    const { orch, logs, transitions } = createOrchestrator();

    // Mock _handleProjectRepair to avoid needing full flow
    orch.healthGate.handleProjectRepair = async () => true;

    await orch.healthGate.runHealthCheckGate();

    assert.ok(logs.find(l => l.event === 'health_check_failed'));
    const repairTransition = transitions.find(t => t.to === 'PROJECT_REPAIR');
    assert.ok(repairTransition, 'should transition to PROJECT_REPAIR');
  });
});

describe('Project Repair — healthGate.handleProjectRepair', () => {
  afterEach(() => {
    healthChecker.runHealthCheck = originalRunHealthCheck;
    healthChecker.resolveHealthCheckConfig = originalResolveConfig;
    healthChecker.detectHealthCheckCommands = originalDetectCommands;
    AgentSession.prototype.chat = originalChat;
  });

  it('returns true when Morgan fixes and re-check passes', async () => {
    let recheckCalls = 0;
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => {
      recheckCalls++;
      return {
        passed: true,
        results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
      };
    };

    // Stub AgentSession.chat to return success
    AgentSession.prototype.chat = async function() {
      return { response: 'Fixed', cost: 1.00, success: true };
    };

    const { orch, logs, transitions } = createOrchestrator();

    const healthCheckResult = {
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL tests' }]
    };

    const result = await orch.healthGate.handleProjectRepair(healthCheckResult);

    assert.equal(result, true);
    assert.ok(logs.find(l => l.event === 'project_repair_started'));
    assert.ok(logs.find(l => l.event === 'project_repair_succeeded'));
    const backToSelecting = transitions.find(t => t.to === 'SELECTING_REQUIREMENT');
    assert.ok(backToSelecting, 'should transition back to SELECTING_REQUIREMENT');
    assert.equal(recheckCalls, 1, 'should re-run health check once');
  });

  it('falls back to pair mode when Morgan agent fails', async () => {
    // Stub AgentSession.chat to return failure
    AgentSession.prototype.chat = async function() {
      return { response: '', cost: 1.00, success: false };
    };

    const { orch, logs } = createOrchestrator();

    let pairCalled = false;
    orch.healthGate.projectRepairPairFallback = async () => {
      pairCalled = true;
      return false;
    };

    const healthCheckResult = {
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    };

    const result = await orch.healthGate.handleProjectRepair(healthCheckResult);

    assert.equal(result, false);
    assert.ok(pairCalled, 'should call pair fallback');
    assert.ok(logs.find(l => l.event === 'project_repair_agent_failed'));
  });

  it('falls back to pair mode when re-check fails after Morgan succeeds', async () => {
    // Stub AgentSession.chat to return success
    AgentSession.prototype.chat = async function() {
      return { response: 'Fixed', cost: 1.00, success: true };
    };

    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'still failing' }]
    });

    const { orch, logs } = createOrchestrator();

    let pairCalled = false;
    orch.healthGate.projectRepairPairFallback = async () => {
      pairCalled = true;
      return false;
    };

    const healthCheckResult = {
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    };

    const result = await orch.healthGate.handleProjectRepair(healthCheckResult);

    assert.equal(result, false);
    assert.ok(pairCalled, 'should fall back to pair when re-check fails');
    assert.ok(logs.find(l => l.event === 'project_repair_recheck_failed'));
  });

  it('falls back to pair mode when agent throws an error', async () => {
    // Stub AgentSession.chat to throw
    AgentSession.prototype.chat = async function() {
      throw new Error('Agent crashed');
    };

    const { orch, logs } = createOrchestrator();

    let pairCalled = false;
    orch.healthGate.projectRepairPairFallback = async () => {
      pairCalled = true;
      return false;
    };

    const healthCheckResult = {
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    };

    const result = await orch.healthGate.handleProjectRepair(healthCheckResult);

    assert.equal(result, false);
    assert.ok(pairCalled, 'should fall back to pair on error');
    assert.ok(logs.find(l => l.event === 'project_repair_error'));
  });

  it('formats only failing commands in health check output for Morgan', async () => {
    let capturedTemplateVars = null;

    // Stub AgentSession.chat to capture template vars
    AgentSession.prototype.chat = async function(msg, opts) {
      capturedTemplateVars = opts.templateVars;
      return { response: 'Fixed', cost: 1.00, success: true };
    };

    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: true,
      results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
    });

    const { orch } = createOrchestrator();

    const healthCheckResult = {
      passed: false,
      results: [
        { command: 'npm test', exitCode: 1, stdout: 'test output', stderr: 'Error: test failed' },
        { command: 'npm run build', exitCode: 0, stdout: 'ok', stderr: '' }
      ]
    };

    await orch.healthGate.handleProjectRepair(healthCheckResult);

    assert.ok(capturedTemplateVars, 'should have captured template vars');
    assert.ok(capturedTemplateVars.HEALTH_CHECK_OUTPUT.includes('npm test'), 'should include failing command');
    assert.ok(!capturedTemplateVars.HEALTH_CHECK_OUTPUT.includes('npm run build'), 'should not include passing command');
    assert.ok(capturedTemplateVars.HEALTH_CHECK_OUTPUT.includes('exit code 1'), 'should include exit code');
  });
});

describe('Project Repair — healthGate.projectRepairPairFallback', () => {
  afterEach(() => {
    healthChecker.runHealthCheck = originalRunHealthCheck;
    healthChecker.resolveHealthCheckConfig = originalResolveConfig;
    healthChecker.detectHealthCheckCommands = originalDetectCommands;
    AgentSession.prototype.chat = originalChat;
  });

  it('returns true when pair mode fixes and re-check passes', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: true,
      results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
    });

    const { orch, logs, transitions } = createOrchestrator();

    // Simulate: pair mode runs, re-check passes
    // We override to skip the actual require('./commands/pair')
    orch.healthGate.projectRepairPairFallback = async function(hcResult) {
      await this.o.logger.log('info', 'project_repair_pair_fallback');
      // Simulate pair mode completing
      // After pair mode, re-run health check
      const hcConfig = await healthChecker.resolveHealthCheckConfig(
        this.o.cliOptions.projectDir,
        this.o.config
      );
      const recheck = await healthChecker.runHealthCheck(this.o.cliOptions.projectDir, hcConfig);

      if (recheck.passed) {
        await this.o.logger.log('info', 'project_repair_succeeded', { method: 'pair_mode' });
        await this.o.stateMachine.transition('SELECTING_REQUIREMENT', {
          consumption: this.o.monitor.getStateForPersistence()
        });
        return true;
      }
      return false;
    };

    const healthCheckResult = {
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    };

    const result = await orch.healthGate.projectRepairPairFallback(healthCheckResult);

    assert.equal(result, true);
    const succeeded = logs.find(l => l.event === 'project_repair_succeeded');
    assert.ok(succeeded);
    assert.equal(succeeded.data.method, 'pair_mode');
  });

  it('returns false and completes session when pair mode cannot fix', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'still broken' }]
    });

    const { orch, logs, transitions } = createOrchestrator();

    orch.healthGate.projectRepairPairFallback = async function(hcResult) {
      await this.o.logger.log('info', 'project_repair_pair_fallback');
      // Simulate pair mode completing but health check still fails
      const hcConfig = await healthChecker.resolveHealthCheckConfig(
        this.o.cliOptions.projectDir,
        this.o.config
      );
      const recheck = await healthChecker.runHealthCheck(this.o.cliOptions.projectDir, hcConfig);

      if (!recheck.passed) {
        await this.o.logger.log('error', 'project_repair_failed', {
          message: 'Health check still failing after pair mode'
        });
        await this.o.stateMachine.transition('SESSION_COMPLETE', {
          consumption: this.o.monitor.getStateForPersistence()
        });
        return false;
      }
      return true;
    };

    const healthCheckResult = {
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    };

    const result = await orch.healthGate.projectRepairPairFallback(healthCheckResult);

    assert.equal(result, false);
    assert.ok(logs.find(l => l.event === 'project_repair_failed'));
    assert.ok(transitions.find(t => t.to === 'SESSION_COMPLETE'));
  });
});

describe('HealthGate — runPhaseGate', () => {
  afterEach(() => {
    healthChecker.runHealthCheck = originalRunHealthCheck;
    healthChecker.resolveHealthCheckConfig = originalResolveConfig;
    healthChecker.detectHealthCheckCommands = originalDetectCommands;
    AgentSession.prototype.chat = originalChat;
  });

  it('returns passed when no health check commands configured', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: [],
      timeoutMs: 120000
    });

    const { orch } = createOrchestrator();
    const result = await orch.healthGate.runPhaseGate({ number: 1, label: 'Core' });
    assert.deepEqual(result, { passed: true });
  });

  it('returns passed when health check passes', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: true,
      results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
    });

    const { orch, logs } = createOrchestrator();
    const result = await orch.healthGate.runPhaseGate({ number: 1, label: 'Core' });

    assert.deepEqual(result, { passed: true });
    assert.ok(logs.find(l => l.event === 'phase_gate_passed'));
  });

  it('attempts diagnostic on failure and returns passed if diagnostic fixes it', async () => {
    let healthCheckCalls = 0;
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => {
      healthCheckCalls++;
      if (healthCheckCalls <= 1) {
        return {
          passed: false,
          results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
        };
      }
      return {
        passed: true,
        results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
      };
    };

    const { orch, logs } = createOrchestrator();
    // Mock diagnostic to succeed
    orch.repair.runProjectDiagnostic = async () => ({ success: true });

    const result = await orch.healthGate.runPhaseGate({ number: 1, label: 'Core' });

    assert.deepEqual(result, { passed: true });
    assert.ok(logs.find(l => l.event === 'phase_gate_fixed'));
  });

  it('proceeds with warning when diagnostic cannot fix', async () => {
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => ({
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    });

    const { orch, logs } = createOrchestrator();
    orch.repair.runProjectDiagnostic = async () => ({ success: false });

    const result = await orch.healthGate.runPhaseGate({ number: 1, label: 'Core' });

    assert.deepEqual(result, { passed: false });
    assert.ok(logs.find(l => l.event === 'phase_gate_proceeding'));
  });
});

describe('HealthGate — runPostMergeSmokeTest', () => {
  afterEach(() => {
    healthChecker.runHealthCheck = originalRunHealthCheck;
    healthChecker.resolveHealthCheckConfig = originalResolveConfig;
    healthChecker.detectHealthCheckCommands = originalDetectCommands;
    AgentSession.prototype.chat = originalChat;
  });

  it('returns passed when no test commands detected', async () => {
    healthChecker.detectHealthCheckCommands = async () => [];

    const { orch } = createOrchestrator();
    const result = await orch.healthGate.runPostMergeSmokeTest('req-1');

    assert.deepEqual(result, { passed: true });
  });

  it('returns passed when smoke tests pass', async () => {
    healthChecker.detectHealthCheckCommands = async () => ['npm test'];
    healthChecker.runHealthCheck = async () => ({
      passed: true,
      results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
    });

    const { orch, logs } = createOrchestrator();
    const result = await orch.healthGate.runPostMergeSmokeTest('req-1');

    assert.deepEqual(result, { passed: true });
    assert.ok(logs.find(l => l.event === 'post_merge_smoke_passed'));
  });

  it('attempts diagnostic fix on failure and returns passed if fixed', async () => {
    let healthCheckCalls = 0;
    healthChecker.detectHealthCheckCommands = async () => ['npm test'];
    healthChecker.runHealthCheck = async () => {
      healthCheckCalls++;
      if (healthCheckCalls <= 1) {
        return {
          passed: false,
          results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
        };
      }
      return {
        passed: true,
        results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
      };
    };

    AgentSession.prototype.chat = async function() {
      return { response: 'Fixed', cost: 0.50, success: true };
    };

    const { orch, logs } = createOrchestrator();
    orch.repair.runDiagnosticFix = async () => ({ success: true });

    const result = await orch.healthGate.runPostMergeSmokeTest('req-1');

    assert.deepEqual(result, { passed: true });
    assert.ok(logs.find(l => l.event === 'post_merge_smoke_fixed'));
  });

  it('returns failure with error message when smoke test and diagnostic both fail', async () => {
    healthChecker.detectHealthCheckCommands = async () => ['npm test'];
    healthChecker.runHealthCheck = async () => ({
      passed: false,
      results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
    });

    const { orch } = createOrchestrator();
    orch.repair.runDiagnosticFix = async () => ({ success: false });

    const result = await orch.healthGate.runPostMergeSmokeTest('req-1');

    assert.equal(result.passed, false);
    assert.ok(result.error.includes('req-1'));
  });

  it('filters out build commands from smoke tests', async () => {
    let commandsUsed = null;
    healthChecker.detectHealthCheckCommands = async () => ['npm test', 'npm run build'];
    healthChecker.runHealthCheck = async (dir, config) => {
      commandsUsed = config.commands;
      return { passed: true, results: [] };
    };

    const { orch } = createOrchestrator();
    await orch.healthGate.runPostMergeSmokeTest('req-1');

    assert.deepEqual(commandsUsed, ['npm test']);
  });
});

describe('HealthGate — runPreviewCheck', () => {
  afterEach(() => {
    healthChecker.runHealthCheck = originalRunHealthCheck;
    healthChecker.resolveHealthCheckConfig = originalResolveConfig;
    healthChecker.detectHealthCheckCommands = originalDetectCommands;
    AgentSession.prototype.chat = originalChat;
  });

  it('does nothing when no preview config', async () => {
    const { orch, logs } = createOrchestrator();
    orch.cliOptions.preview = undefined;

    await orch.healthGate.runPreviewCheck();

    // No logs related to preview should be emitted
    assert.equal(logs.filter(l => l.event?.includes('preview')).length, 0);
  });

  it('updates state when preview becomes available', async () => {
    const { orch, logs } = createOrchestrator();
    orch.cliOptions.preview = { command: 'npm run dev', port: 3000, timeoutSeconds: 10 };
    orch._lastMergedRequirementId = 'req-1';

    // Mock preview checker
    const previewChecker = require('./quality/preview-checker');
    const origCheck = previewChecker.checkPreview;
    previewChecker.checkPreview = async () => ({ available: true });

    // Track logger calls
    let previewCheckLogged = false;
    orch.logger.logPreviewCheck = async () => { previewCheckLogged = true; };
    orch.logger.logGoLook = async () => {};

    try {
      await orch.healthGate.runPreviewCheck();
      assert.equal(previewCheckLogged, true, 'should log the preview check');
    } finally {
      previewChecker.checkPreview = origCheck;
    }
  });
});

describe('Project Repair — integration flow', () => {
  afterEach(() => {
    healthChecker.runHealthCheck = originalRunHealthCheck;
    healthChecker.resolveHealthCheckConfig = originalResolveConfig;
    healthChecker.detectHealthCheckCommands = originalDetectCommands;
    AgentSession.prototype.chat = originalChat;
  });

  it('full flow: health check fails → Morgan fixes → continues', async () => {
    let healthCheckCallCount = 0;
    healthChecker.resolveHealthCheckConfig = async () => ({
      commands: ['npm test'],
      timeoutMs: 120000
    });
    healthChecker.runHealthCheck = async () => {
      healthCheckCallCount++;
      if (healthCheckCallCount === 1) {
        return {
          passed: false,
          results: [{ command: 'npm test', exitCode: 1, stdout: '', stderr: 'FAIL' }]
        };
      }
      // After Morgan's fix, re-check passes
      return {
        passed: true,
        results: [{ command: 'npm test', exitCode: 0, stdout: 'ok', stderr: '' }]
      };
    };

    // Stub AgentSession.chat to return success
    AgentSession.prototype.chat = async function() {
      return { response: 'Fixed', cost: 1.00, success: true };
    };

    const { orch, logs, transitions } = createOrchestrator();

    const result = await orch.healthGate.runHealthCheckGate();

    assert.equal(result, true);
    assert.equal(healthCheckCallCount, 2, 'health check should run twice');

    // Should have transitioned: PROJECT_REPAIR → SELECTING_REQUIREMENT
    assert.ok(transitions.find(t => t.to === 'PROJECT_REPAIR'));
    assert.ok(transitions.find(t => t.to === 'SELECTING_REQUIREMENT'));

    // Should have logged the full flow
    assert.ok(logs.find(l => l.event === 'health_check_started'));
    assert.ok(logs.find(l => l.event === 'health_check_failed'));
    assert.ok(logs.find(l => l.event === 'project_repair_started'));
    assert.ok(logs.find(l => l.event === 'project_repair_succeeded'));
  });

  it('stores resume flag so run() can skip health check', () => {
    // The run() method gates health check with: if (!this.cliOptions.resume)
    // This test verifies the flag is correctly passed through the constructor
    const { orch } = createOrchestrator();
    assert.equal(orch.cliOptions.resume, false, 'resume should be false by default');

    const resumeOrch = new ParallelOrchestrator({
      projectDir: '/proj',
      projectId: 'proj-001',
      templatesDir: '/templates',
      resume: true
    });
    assert.equal(resumeOrch.cliOptions.resume, true, 'resume flag should be stored');
  });
});
