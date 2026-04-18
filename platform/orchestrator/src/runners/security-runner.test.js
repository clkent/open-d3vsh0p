const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

describe('SecurityRunner', () => {
  let SecurityRunner, FOCUS_LABELS;
  let mockRunAgent;
  let mockRender;

  const modulesToMock = [
    './security-runner',
    '../agents/agent-runner',
    '../agents/template-engine',
    '../infra/logger',
    '../session/session-utils',
    '../session/path-utils'
  ];
  const savedCaches = {};

  beforeEach(() => {
    for (const mod of modulesToMock) {
      const resolved = require.resolve(mod);
      savedCaches[resolved] = require.cache[resolved];
      delete require.cache[resolved];
    }

    mockRunAgent = async () => ({
      success: true, cost: 1.0, duration: 5000, output: 'All clear'
    });
    mockRender = async () => 'mocked security system prompt';

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

    require.cache[require.resolve('../agents/template-engine')] = {
      id: require.resolve('../agents/template-engine'),
      filename: require.resolve('../agents/template-engine'),
      loaded: true,
      exports: {
        TemplateEngine: class MockTemplateEngine {
          constructor() {}
          async render(agentType, vars) { return mockRender(agentType, vars); }
        }
      }
    };

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

    require.cache[require.resolve('../session/session-utils')] = {
      id: require.resolve('../session/session-utils'),
      filename: require.resolve('../session/session-utils'),
      loaded: true,
      exports: { generateSessionId: () => 'test-session' }
    };

    require.cache[require.resolve('../session/path-utils')] = {
      id: require.resolve('../session/path-utils'),
      filename: require.resolve('../session/path-utils'),
      loaded: true,
      exports: { getOrchestratorPaths: () => ({ stateDir: '/tmp/state', logsDir: '/tmp/logs' }) }
    };

    ({ SecurityRunner, FOCUS_LABELS } = require('./security-runner'));
  });

  afterEach(() => {
    for (const mod of modulesToMock) {
      const resolved = require.resolve(mod);
      delete require.cache[resolved];
      if (savedCaches[resolved]) {
        require.cache[resolved] = savedCaches[resolved];
      }
    }
  });

  function createRunner(overrides = {}) {
    return new SecurityRunner({
      projectId: 'proj-001',
      projectDir: '/tmp/test-project',
      templatesDir: '/tmp/templates',
      activeAgentsDir: '/tmp/agents',
      agents: { security: { model: 'test-model', maxBudgetUsd: 2, timeoutMs: 300000, allowedTools: ['Read'] } },
      ...overrides
    });
  }

  describe('run', () => {
    it('renders security-agent template and invokes agent', async () => {
      let capturedAgentType, capturedOpts;
      mockRender = async (agentType, vars) => { capturedAgentType = agentType; return 'prompt'; };
      mockRunAgent = async (opts) => { capturedOpts = opts; return { success: true, cost: 1.0, output: 'ok' }; };

      const runner = createRunner();
      const result = await runner.run();

      assert.equal(capturedAgentType, 'security-agent');
      assert.equal(result.success, true);
      assert.equal(capturedOpts.workingDir, '/tmp/test-project');
      assert.match(capturedOpts.userPrompt, /security audit/);
    });

    it('uses config budget and timeout', async () => {
      let capturedOpts;
      mockRunAgent = async (opts) => { capturedOpts = opts; return { success: true, cost: 0, output: '' }; };

      const runner = createRunner();
      await runner.run();

      assert.equal(capturedOpts.maxBudgetUsd, 2);
      assert.equal(capturedOpts.timeoutMs, 300000);
    });

    it('uses override budget and timeout over agent config', async () => {
      let capturedOpts;
      mockRunAgent = async (opts) => { capturedOpts = opts; return { success: true, cost: 0, output: '' }; };

      const runner = createRunner({ maxBudgetUsd: 5, timeoutMs: 600000 });
      await runner.run();

      assert.equal(capturedOpts.maxBudgetUsd, 5);
      assert.equal(capturedOpts.timeoutMs, 600000);
    });

    it('returns agent result as-is', async () => {
      mockRunAgent = async () => ({ success: false, cost: 0.5, error: 'timeout', output: null });

      const runner = createRunner();
      const result = await runner.run();

      assert.equal(result.success, false);
      assert.equal(result.error, 'timeout');
    });
  });

  describe('focus areas', () => {
    it('appends focus instructions to user prompt when focusAreas provided', async () => {
      let capturedOpts;
      mockRunAgent = async (opts) => { capturedOpts = opts; return { success: true, cost: 0, output: '' }; };

      const runner = createRunner({ focusAreas: ['secrets', 'deps'] });
      await runner.run();

      assert.match(capturedOpts.userPrompt, /Focus your scan on/);
      assert.match(capturedOpts.userPrompt, /hardcoded secrets/);
      assert.match(capturedOpts.userPrompt, /insecure or outdated dependencies/);
    });

    it('uses full audit prompt when no focusAreas', async () => {
      let capturedOpts;
      mockRunAgent = async (opts) => { capturedOpts = opts; return { success: true, cost: 0, output: '' }; };

      const runner = createRunner();
      await runner.run();

      assert.match(capturedOpts.userPrompt, /hardcoded secrets, injection vulnerabilities/);
      assert.doesNotMatch(capturedOpts.userPrompt, /Focus your scan on/);
    });

    it('passes through unknown focus areas as-is', async () => {
      let capturedOpts;
      mockRunAgent = async (opts) => { capturedOpts = opts; return { success: true, cost: 0, output: '' }; };

      const runner = createRunner({ focusAreas: ['custom-area'] });
      await runner.run();

      assert.match(capturedOpts.userPrompt, /custom-area/);
    });
  });

  describe('writeReport', () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-runner-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('creates openspec/scans dir and writes report', async () => {
      const runner = createRunner({ projectDir: tmpDir });
      const reportPath = await runner.writeReport('# Findings\nAll clear');

      assert.match(reportPath, /security\.md$/);
      const content = await fs.readFile(reportPath, 'utf-8');
      assert.equal(content, '# Findings\nAll clear');
    });

    it('appends numeric suffix on same-day collision', async () => {
      const runner = createRunner({ projectDir: tmpDir });

      const first = await runner.writeReport('Report 1');
      const second = await runner.writeReport('Report 2');

      assert.match(first, /security\.md$/);
      assert.match(second, /security-2\.md$/);

      assert.equal(await fs.readFile(first, 'utf-8'), 'Report 1');
      assert.equal(await fs.readFile(second, 'utf-8'), 'Report 2');
    });
  });

  describe('parseSeverityCounts', () => {
    it('counts severity keywords in output', () => {
      const runner = createRunner();
      const output = 'Critical: XSS found\nHigh: SQL injection\nHigh: CSRF\nMedium: info leak\nLow: verbose errors';
      const counts = runner.parseSeverityCounts(output);

      assert.equal(counts.critical, 1);
      assert.equal(counts.high, 2);
      assert.equal(counts.medium, 1);
      assert.equal(counts.low, 1);
      assert.equal(counts.total, 5);
    });

    it('returns zeros for empty output', () => {
      const runner = createRunner();
      const counts = runner.parseSeverityCounts('');
      assert.equal(counts.total, 0);
    });

    it('returns zeros for null output', () => {
      const runner = createRunner();
      const counts = runner.parseSeverityCounts(null);
      assert.equal(counts.total, 0);
    });
  });

  describe('printSummary', () => {
    it('prints issue counts when findings exist', (t) => {
      const logs = [];
      t.mock.method(console, 'log', (msg) => logs.push(msg));

      const runner = createRunner();
      runner.printSummary({ critical: 1, high: 2, medium: 0, low: 1, total: 4 }, '/tmp/report.md');

      assert.ok(logs.some(l => l.includes('1 critical')));
      assert.ok(logs.some(l => l.includes('2 high')));
      assert.ok(logs.some(l => l.includes('1 low')));
      assert.ok(logs.some(l => l.includes('/tmp/report.md')));
    });

    it('prints clean message when no findings', (t) => {
      const logs = [];
      t.mock.method(console, 'log', (msg) => logs.push(msg));

      const runner = createRunner();
      runner.printSummary({ critical: 0, high: 0, medium: 0, low: 0, total: 0 }, '/tmp/report.md');

      assert.ok(logs.some(l => l.includes('No security issues found')));
    });
  });
});
