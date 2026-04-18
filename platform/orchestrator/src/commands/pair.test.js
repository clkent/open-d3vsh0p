const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { buildPairContext, buildClaudeArgs, spawnClaudeTerminal } = require('./pair');

describe('buildPairContext', () => {
  let tmpDir, stateDir, logsDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pair-test-'));
    stateDir = path.join(tmpDir, 'orchestrator');
    logsDir = path.join(tmpDir, 'orchestrator', 'logs');
    await fs.mkdir(logsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes session state when state.json exists', async () => {
    await fs.writeFile(path.join(stateDir, 'state.json'), JSON.stringify({
      sessionId: 'test-session',
      state: 'running',
      requirements: {
        completed: ['req-1', 'req-2'],
        pending: ['req-3'],
        parked: [{ id: 'req-4', error: 'test failure' }]
      }
    }));

    const mockRoadmap = { exists: async () => false };
    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    assert.ok(context.includes('Session: test-session'));
    assert.ok(context.includes('State: running'));
    assert.ok(context.includes('Completed: 2 requirements'));
    assert.ok(context.includes('Pending: 1 requirements'));
    assert.ok(context.includes('Parked: 1 requirements'));
    assert.ok(context.includes('Completed items: req-1, req-2'));
    assert.ok(context.includes('Parked items: req-4'));
  });

  it('shows "No active session" when state.json is missing', async () => {
    const mockRoadmap = { exists: async () => false };
    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    assert.ok(context.includes('No active session found.'));
  });

  it('includes roadmap progress when roadmap exists', async () => {
    const mockRoadmap = {
      exists: async () => true,
      parse: async () => ({
        title: 'Test Roadmap',
        phases: [{
          number: 1,
          label: 'Foundation',
          groups: [{
            items: [
              { status: 'complete' },
              { status: 'complete' },
              { status: 'pending' }
            ]
          }]
        }]
      })
    };

    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    assert.ok(context.includes('Roadmap: Test Roadmap'));
    assert.ok(context.includes('Phase 1 (Foundation): 2/3 complete'));
  });

  it('skips roadmap section when no roadmap exists', async () => {
    const mockRoadmap = { exists: async () => false };
    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    assert.ok(!context.includes('Roadmap:'));
  });

  it('includes parked items with failure reasons from latest summary', async () => {
    await fs.writeFile(path.join(logsDir, '2026-01-01-summary.json'), JSON.stringify({
      parked: [{ id: 'old-item', error: 'old failure' }]
    }));
    await fs.writeFile(path.join(logsDir, '2026-02-14-summary.json'), JSON.stringify({
      parked: [
        { id: 'security-setup', error: 'Implementation retries exhausted' },
        { id: 'rate-limiting', error: 'Test fix retries exhausted' }
      ]
    }));

    const mockRoadmap = { exists: async () => false };
    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    assert.ok(context.includes('Parked Items (from last session)'));
    assert.ok(context.includes('**security-setup**: Implementation retries exhausted'));
    assert.ok(context.includes('**rate-limiting**: Test fix retries exhausted'));
    // Should use latest summary, not the old one
    assert.ok(!context.includes('old-item'));
  });

  it('handles parked items as plain strings', async () => {
    await fs.writeFile(path.join(logsDir, '2026-02-14-summary.json'), JSON.stringify({
      parked: ['item-a', 'item-b']
    }));

    const mockRoadmap = { exists: async () => false };
    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    assert.ok(context.includes('**item-a**'));
    assert.ok(context.includes('**item-b**'));
  });

  it('skips parked items section when summary has no parked items', async () => {
    await fs.writeFile(path.join(logsDir, '2026-02-14-summary.json'), JSON.stringify({
      parked: []
    }));

    const mockRoadmap = { exists: async () => false };
    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    assert.ok(!context.includes('Parked Items'));
  });

  it('handles missing logs directory gracefully', async () => {
    const missingLogsDir = path.join(tmpDir, 'nonexistent', 'logs');
    const mockRoadmap = { exists: async () => false };

    const context = await buildPairContext({ stateDir, logsDir: missingLogsDir, roadmapReader: mockRoadmap });

    // Should not throw, just skip the parked items section
    assert.ok(!context.includes('Parked Items'));
  });

  it('handles roadmap reader error gracefully', async () => {
    const mockRoadmap = {
      exists: async () => { throw new Error('file not found'); }
    };

    const context = await buildPairContext({ stateDir, logsDir, roadmapReader: mockRoadmap });

    // Should not throw
    assert.ok(!context.includes('Roadmap:'));
  });
});

describe('buildClaudeArgs', () => {
  it('includes --append-system-prompt and --session-id for new sessions', () => {
    const args = buildClaudeArgs({
      appendSystemPrompt: 'test prompt content',
      sessionId: 'abc-123',
      model: 'claude-sonnet-4-20250514',
      name: 'Morgan — proj-001'
    });

    assert.ok(args.includes('--append-system-prompt'));
    assert.ok(args.includes('test prompt content'));
    assert.ok(args.includes('--session-id'));
    assert.ok(args.includes('abc-123'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('claude-sonnet-4-20250514'));
    assert.ok(args.includes('--name'));
    assert.ok(args.includes('Morgan — proj-001'));
    assert.ok(!args.includes('--resume'));
  });

  it('uses --resume instead of --session-id and --append-system-prompt when resuming', () => {
    const args = buildClaudeArgs({
      appendSystemPrompt: 'should be ignored',
      sessionId: 'should-be-ignored',
      resume: 'existing-session-id',
      model: 'claude-sonnet-4-20250514',
      name: 'Morgan — proj-001'
    });

    assert.ok(args.includes('--resume'));
    assert.ok(args.includes('existing-session-id'));
    assert.ok(!args.includes('--append-system-prompt'));
    assert.ok(!args.includes('should be ignored'));
    assert.ok(!args.includes('--session-id'));
    assert.ok(!args.includes('should-be-ignored'));
    // model and name should still be present
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('--name'));
  });

  it('omits --model when not specified', () => {
    const args = buildClaudeArgs({
      appendSystemPrompt: 'test',
      sessionId: 'abc-123'
    });

    assert.ok(!args.includes('--model'));
  });

  it('omits --name when not specified', () => {
    const args = buildClaudeArgs({
      appendSystemPrompt: 'test',
      sessionId: 'abc-123'
    });

    assert.ok(!args.includes('--name'));
  });

  it('includes --name with project ID', () => {
    const args = buildClaudeArgs({
      appendSystemPrompt: 'test',
      sessionId: 'abc-123',
      name: 'Morgan — proj-000-my-app'
    });

    const nameIdx = args.indexOf('--name');
    assert.ok(nameIdx >= 0);
    assert.equal(args[nameIdx + 1], 'Morgan — proj-000-my-app');
  });

  it('preserves arg order: flags then model then name', () => {
    const args = buildClaudeArgs({
      appendSystemPrompt: 'prompt',
      sessionId: 'sid',
      model: 'claude-sonnet-4-20250514',
      name: 'Morgan'
    });

    const promptIdx = args.indexOf('--append-system-prompt');
    const modelIdx = args.indexOf('--model');
    const nameIdx = args.indexOf('--name');
    assert.ok(promptIdx < modelIdx);
    assert.ok(modelIdx < nameIdx);
  });
});

describe('spawnClaudeTerminal', () => {
  it('is exported as a function', () => {
    assert.equal(typeof spawnClaudeTerminal, 'function');
  });
});
