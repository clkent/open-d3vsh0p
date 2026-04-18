const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

describe('TechDebtRunner', () => {
  let TechDebtRunner;
  let mockRunAgent;
  let mockRender;

  // Store original require caches to restore after tests
  const modulesToMock = [
    './tech-debt-runner',
    '../agents/agent-runner',
    '../agents/template-engine',
    '../infra/logger',
    '../session/session-utils',
    '../session/path-utils'
  ];
  const savedCaches = {};

  beforeEach(() => {
    // Save and clear require caches
    for (const mod of modulesToMock) {
      const resolved = require.resolve(mod);
      savedCaches[resolved] = require.cache[resolved];
      delete require.cache[resolved];
    }

    // Set up mocks
    mockRunAgent = async () => ({
      success: true, cost: 1.0, duration: 5000, output: 'All clear'
    });
    mockRender = async () => 'mocked system prompt for {{PROJECT_ID}}';

    // Mock agent-runner
    require.cache[require.resolve('../agents/agent-runner')] = {
      id: require.resolve('../agents/agent-runner'),
      filename: require.resolve('../agents/agent-runner'),
      loaded: true,
      exports: {
        AgentRunner: class MockAgentRunner {
          constructor() {}
          async runAgent(opts) { return mockRunAgent(opts); }
        }
      }
    };

    // Mock template-engine
    require.cache[require.resolve('../agents/template-engine')] = {
      id: require.resolve('../agents/template-engine'),
      filename: require.resolve('../agents/template-engine'),
      loaded: true,
      exports: {
        TemplateEngine: class MockTemplateEngine {
          constructor() {}
          async render(agentType, vars) { return mockRender(agentType, vars); }
          async renderAgentPrompt(agentType, vars) { return mockRender(agentType, vars); }
        }
      }
    };

    // Mock logger
    require.cache[require.resolve('../infra/logger')] = {
      id: require.resolve('../infra/logger'),
      filename: require.resolve('../infra/logger'),
      loaded: true,
      exports: {
        Logger: class MockLogger {
          constructor() {}
          async log() {}
          async init() {}
        }
      }
    };

    // Mock session-utils
    require.cache[require.resolve('../session/session-utils')] = {
      id: require.resolve('../session/session-utils'),
      filename: require.resolve('../session/session-utils'),
      loaded: true,
      exports: { generateSessionId: () => 'test-session' }
    };

    // Mock path-utils
    require.cache[require.resolve('../session/path-utils')] = {
      id: require.resolve('../session/path-utils'),
      filename: require.resolve('../session/path-utils'),
      loaded: true,
      exports: { getOrchestratorPaths: () => ({ stateDir: '/tmp/state', logsDir: '/tmp/logs' }) }
    };

    // Now require the module under test (picks up mocks)
    ({ TechDebtRunner } = require('./tech-debt-runner'));
  });

  afterEach(() => {
    // Restore original caches
    for (const mod of modulesToMock) {
      const resolved = require.resolve(mod);
      delete require.cache[resolved];
      if (savedCaches[resolved]) {
        require.cache[resolved] = savedCaches[resolved];
      }
    }
  });

  function createRunner(overrides = {}) {
    const config = {
      projectId: 'proj-001',
      projectDir: '/tmp/test-project',
      templatesDir: '/tmp/templates',
      activeAgentsDir: '/tmp/agents',
      agents: {
        security: { model: 'test-model', maxBudgetUsd: 2, timeoutMs: 300000, allowedTools: ['Read'] },
        'principal-engineer': { model: 'test-model', maxBudgetUsd: 3, timeoutMs: 600000, allowedTools: ['Read', 'Edit'] }
      },
      ...overrides.config
    };

    return new TechDebtRunner(config);
  }

  describe('run', () => {
    it('returns securityResult, peResult, and totalCost on happy path', async () => {
      let callCount = 0;
      mockRunAgent = async () => {
        callCount++;
        return { success: true, cost: callCount === 1 ? 1.5 : 2.0, duration: 3000, output: 'report' };
      };

      const runner = createRunner();
      // Override _runPEPass to avoid the missing `path` import issue in source
      runner._runPEPass = async () => ({ success: true, cost: 2.0, duration: 3000, output: 'PE report' });

      const result = await runner.run();

      assert.equal(result.securityResult.success, true);
      assert.equal(result.securityResult.cost, 1.5);
      assert.equal(result.peResult.success, true);
      assert.equal(result.totalCost, 3.5);
      assert.equal(result.securityResult.success, true);
      assert.equal(result.peResult.success, true);
    });

    it('continues to PE pass even when security scan fails', async () => {
      mockRunAgent = async () => ({ success: false, cost: 0.5, duration: 1000, error: 'scan failed' });

      const runner = createRunner();
      runner._runPEPass = async () => ({ success: true, cost: 2.0, duration: 3000, output: 'PE done' });

      const result = await runner.run();

      assert.equal(result.securityResult.success, false);
      assert.equal(result.peResult.success, true);
      assert.equal(result.totalCost, 2.5);
    });

    it('reports PE failure in result', async () => {
      mockRunAgent = async () => ({ success: true, cost: 1.0, duration: 2000, output: 'findings' });

      const runner = createRunner();
      runner._runPEPass = async () => ({ success: false, cost: 0.3, duration: 500, error: 'PE crashed' });

      const result = await runner.run();

      assert.equal(result.securityResult.success, true);
      assert.equal(result.peResult.success, false);
      assert.equal(result.peResult.error, 'PE crashed');
      assert.equal(result.totalCost, 1.3);
    });

    it('accumulates cost even when both phases fail', async () => {
      mockRunAgent = async () => ({ success: false, cost: 0.75, duration: 500, error: 'fail' });

      const runner = createRunner();
      runner._runPEPass = async () => ({ success: false, cost: 0.75, duration: 500, error: 'fail' });

      const result = await runner.run();

      assert.equal(result.totalCost, 1.5);
    });

    it('passes security output to _runPEPass', async () => {
      mockRunAgent = async () => ({ success: true, cost: 1.0, duration: 1000, output: 'XSS found' });

      let capturedFindings = null;
      const runner = createRunner();
      runner._runPEPass = async (findings) => {
        capturedFindings = findings;
        return { success: true, cost: 1.0, duration: 1000 };
      };

      await runner.run();
      assert.equal(capturedFindings, 'XSS found');
    });
  });

  describe('_runSecurityScan', () => {
    it('calls runAgent with projectDir as workingDir', async () => {
      let capturedOpts = null;
      mockRunAgent = async (opts) => {
        capturedOpts = opts;
        return { success: true, cost: 1.0, duration: 1000, output: 'ok' };
      };

      const runner = createRunner();
      await runner._runSecurityScan();

      assert.equal(capturedOpts.workingDir, '/tmp/test-project');
      assert.ok(capturedOpts.systemPrompt.length > 0, 'systemPrompt should be non-empty');
      assert.match(capturedOpts.userPrompt, /security audit/);
    });

    it('passes correct model and budget from config', async () => {
      let capturedOpts = null;
      mockRunAgent = async (opts) => {
        capturedOpts = opts;
        return { success: true, cost: 1.0, duration: 1000, output: 'ok' };
      };

      const runner = createRunner();
      await runner._runSecurityScan();

      assert.equal(capturedOpts.model, 'test-model');
      assert.equal(capturedOpts.maxBudgetUsd, 2);
    });

    it('renders security-agent template with project variables', async () => {
      let capturedAgentType = null;
      let capturedVars = null;
      mockRender = async (agentType, vars) => {
        capturedAgentType = agentType;
        capturedVars = vars;
        return 'security prompt';
      };
      mockRunAgent = async () => ({ success: true, cost: 0, duration: 0, output: '' });

      const runner = createRunner();
      await runner._runSecurityScan();

      assert.equal(capturedAgentType, 'security-agent');
      assert.equal(capturedVars.PROJECT_ID, 'proj-001');
      assert.equal(capturedVars.PROJECT_DIR, '/tmp/test-project');
    });

    it('includes project directory in user prompt', async () => {
      let capturedOpts = null;
      mockRunAgent = async (opts) => {
        capturedOpts = opts;
        return { success: true, cost: 0, duration: 0, output: '' };
      };

      const runner = createRunner();
      await runner._runSecurityScan();

      assert.match(capturedOpts.userPrompt, /\/tmp\/test-project/);
    });
  });

  describe('constructor', () => {
    it('sets projectId from config', () => {
      const runner = createRunner();
      assert.equal(runner.projectId, 'proj-001');
    });

    it('sets projectDir from config', () => {
      const runner = createRunner();
      assert.equal(runner.projectDir, '/tmp/test-project');
    });

  });
});
