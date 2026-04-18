const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ParallelOrchestrator } = require('./parallel-orchestrator');

function createOrchestrator(overrides = {}) {
  const logs = [];
  const parkedItems = overrides.parkedItems || [
    { id: 'req-1', reason: 'Tests failed:\nModule not found: express' },
    { id: 'req-2', reason: 'Tests failed:\nCannot find module express' }
  ];

  const orch = new ParallelOrchestrator({
    projectDir: '/proj',
    projectId: 'proj-001',
    templatesDir: '/templates'
  });

  orch.logger = {
    log: async (level, event, data) => {
      logs.push({ level, event, data });
    }
  };

  orch.config = {
    agents: {
      diagnostic: {
        model: 'test',
        maxBudgetUsd: 3.00,
        timeoutMs: 300000,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']
      }
    }
  };

  orch.templateEngine = {
    renderString: (template, vars) => {
      let result = template;
      for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(`{{${key}}}`, value);
      }
      return result;
    },
    _resolvePartials: async (template) => template
  };

  orch.stateMachine = {
    getState: () => ({
      requirements: { parked: parkedItems, pending: ['req-3'], completed: [] }
    })
  };

  orch.monitor = {
    recordInvocation: () => {}
  };

  orch._techStack = 'Next.js, TypeScript';

  // Mock fs.readFile for diagnostic prompt
  const originalRequire = require;

  orch.agentRunner = {
    runAgent: async () => ({
      success: overrides.diagnosticSuccess !== undefined ? overrides.diagnosticSuccess : true,
      cost: 1.50,
      error: overrides.diagnosticError || null
    }),
    ...overrides.agentRunner
  };

  return { orch, logs };
}

// Stub the fs.readFile that _runProjectDiagnostic uses
const fs = require('fs/promises');
const originalReadFile = fs.readFile;

describe('Project Diagnostic', () => {
  beforeEach(() => {
    // Stub readFile to return a mock diagnostic prompt
    fs.readFile = async (filePath, encoding) => {
      if (filePath.includes('diagnostic-prompt.md')) {
        return '# Morgan — Project Doctor\n\nDir: {{PROJECT_DIR}}\nStack: {{TECH_STACK}}\nFailures:\n{{FAILURE_CONTEXT}}';
      }
      return originalReadFile(filePath, encoding);
    };
  });

  afterEach(() => {
    fs.readFile = originalReadFile;
  });

  it('triggers diagnostic and returns success when agent succeeds', async () => {
    const { orch, logs } = createOrchestrator({ diagnosticSuccess: true });

    const result = await orch.repair.runProjectDiagnostic({ number: 1, label: 'Foundation' });

    assert.equal(result.success, true);
    const started = logs.find(l => l.event === 'diagnostic_started');
    assert.ok(started, 'should log diagnostic_started');
    assert.equal(started.data.phase, 'Phase 1');
  });

  it('returns failure when agent fails', async () => {
    const { orch, logs } = createOrchestrator({
      diagnosticSuccess: false,
      diagnosticError: 'Could not diagnose issue'
    });

    const result = await orch.repair.runProjectDiagnostic({ number: 2, label: 'Setup' });

    assert.equal(result.success, false);
  });

  it('runs only once per stuck phase', async () => {
    const { orch, logs } = createOrchestrator({ diagnosticSuccess: true });

    const result1 = await orch.repair.runProjectDiagnostic({ number: 1, label: 'Foundation' });
    const result2 = await orch.repair.runProjectDiagnostic({ number: 1, label: 'Foundation' });

    assert.equal(result1.success, true);
    assert.equal(result2.success, false);
    assert.equal(result2.skipped, true);

    const started = logs.filter(l => l.event === 'diagnostic_started');
    assert.equal(started.length, 1, 'should only start diagnostic once per phase');
  });

  it('allows diagnostic on different phases', async () => {
    const { orch, logs } = createOrchestrator({ diagnosticSuccess: true });

    await orch.repair.runProjectDiagnostic({ number: 1, label: 'Foundation' });
    await orch.repair.runProjectDiagnostic({ number: 2, label: 'Features' });

    const started = logs.filter(l => l.event === 'diagnostic_started');
    assert.equal(started.length, 2, 'should start diagnostic for each unique phase');
  });

  it('is non-fatal when agent throws an error', async () => {
    const { orch, logs } = createOrchestrator({
      agentRunner: {
        runAgent: async () => { throw new Error('Agent crashed'); }
      }
    });

    // _runProjectDiagnostic itself throws — the caller catches it
    await assert.rejects(
      () => orch.repair.runProjectDiagnostic({ number: 1, label: 'Foundation' }),
      /Agent crashed/
    );
  });

  it('includes failure context from parked items', async () => {
    let capturedPrompt = null;
    const { orch } = createOrchestrator({
      agentRunner: {
        runAgent: async (opts) => {
          capturedPrompt = opts.systemPrompt;
          return { success: true, cost: 0.50 };
        }
      }
    });

    await orch.repair.runProjectDiagnostic({ number: 1, label: 'Foundation' });

    assert.ok(capturedPrompt.includes('req-1: Tests failed'));
    assert.ok(capturedPrompt.includes('req-2: Tests failed'));
    assert.ok(capturedPrompt.includes('Next.js, TypeScript'));
    assert.ok(capturedPrompt.includes('/proj'));
  });

});
