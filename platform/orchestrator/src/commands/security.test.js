const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('securityCommand', () => {
  let securityCommand, VALID_FOCUS_AREAS;
  let mockSecurityRun;
  let capturedRunnerConfig;

  const modulesToMock = [
    './security',
    '../runners/security-runner',
    '../session/path-utils'
  ];
  const savedCaches = {};

  beforeEach(() => {
    for (const mod of modulesToMock) {
      const resolved = require.resolve(mod);
      savedCaches[resolved] = require.cache[resolved];
      delete require.cache[resolved];
    }

    mockSecurityRun = async () => ({
      success: true, cost: 1.5, output: '## Findings\nNo critical issues found.'
    });
    capturedRunnerConfig = null;

    require.cache[require.resolve('../runners/security-runner')] = {
      id: require.resolve('../runners/security-runner'),
      filename: require.resolve('../runners/security-runner'),
      loaded: true,
      exports: {
        SecurityRunner: class MockSecurityRunner {
          constructor(config) {
            capturedRunnerConfig = config;
            this.focusAreas = config.focusAreas;
          }
          async run() { return mockSecurityRun(); }
          async writeReport(output) { return '/tmp/report.md'; }
          parseSeverityCounts() { return { critical: 0, high: 0, medium: 0, low: 0, total: 0 }; }
          printSummary() {}
        }
      }
    };

    require.cache[require.resolve('../session/path-utils')] = {
      id: require.resolve('../session/path-utils'),
      filename: require.resolve('../session/path-utils'),
      loaded: true,
      exports: { getOrchestratorPaths: () => ({ stateDir: '/tmp/state', logsDir: '/tmp/logs' }) }
    };

    ({ securityCommand, VALID_FOCUS_AREAS } = require('./security'));
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

  const project = { id: 'proj-001', name: 'test-app', projectDir: '/tmp/test-project' };
  const baseConfig = {
    projectId: 'proj-001',
    projectDir: '/tmp/test-project',
    templatesDir: '/tmp/templates',
    activeAgentsDir: '/tmp/agents'
  };

  it('returns 0 on successful scan', async () => {
    const exitCode = await securityCommand(project, baseConfig);
    assert.equal(exitCode, 0);
  });

  it('returns 1 on scan failure', async () => {
    mockSecurityRun = async () => ({ success: false, cost: 0, error: 'timeout', output: null });
    const exitCode = await securityCommand(project, baseConfig);
    assert.equal(exitCode, 1);
  });

  it('passes focusAreas to SecurityRunner', async () => {
    await securityCommand(project, { ...baseConfig, focus: 'secrets,deps' });
    assert.deepEqual(capturedRunnerConfig.focusAreas, ['secrets', 'deps']);
  });

  it('rejects invalid focus areas', async () => {
    const exitCode = await securityCommand(project, { ...baseConfig, focus: 'invalid-area' });
    assert.equal(exitCode, 1);
  });

  it('passes budget override to SecurityRunner', async () => {
    await securityCommand(project, { ...baseConfig, securityBudget: 5 });
    assert.equal(capturedRunnerConfig.maxBudgetUsd, 5);
  });

  it('passes timeout override to SecurityRunner', async () => {
    await securityCommand(project, { ...baseConfig, securityTimeout: 10 });
    assert.equal(capturedRunnerConfig.timeoutMs, 600000);
  });

  it('does not set overrides when not provided', async () => {
    await securityCommand(project, baseConfig);
    assert.equal(capturedRunnerConfig.maxBudgetUsd, undefined);
    assert.equal(capturedRunnerConfig.timeoutMs, undefined);
  });

  it('exports VALID_FOCUS_AREAS', () => {
    assert.ok(Array.isArray(VALID_FOCUS_AREAS));
    assert.ok(VALID_FOCUS_AREAS.includes('secrets'));
    assert.ok(VALID_FOCUS_AREAS.includes('deps'));
    assert.ok(VALID_FOCUS_AREAS.includes('injection'));
    assert.ok(VALID_FOCUS_AREAS.includes('auth'));
    assert.ok(VALID_FOCUS_AREAS.includes('config'));
  });
});
