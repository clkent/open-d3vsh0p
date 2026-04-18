const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { AgentSession } = require('./agent-session');

/**
 * Creates a mock AgentRunner that captures runAgent() calls
 * and returns a configurable result.
 */
function createMockAgentRunner(result = {}) {
  const calls = [];
  return {
    calls,
    runAgent: async (params) => {
      calls.push(params);
      return {
        success: true,
        output: 'mock response',
        sessionId: 'sess-mock-1',
        cost: 0.01,
        duration: 100,
        error: null,
        ...result
      };
    }
  };
}

/**
 * Creates a mock TemplateEngine.
 */
function createMockTemplateEngine() {
  return {
    renderAgentPrompt: async (template, vars) => `system-prompt-for-${template}`,
    renderString: (raw, vars) => `rendered: ${raw}`
  };
}

describe('AgentSession', () => {
  let mockRunner;
  let mockTemplate;
  let baseConfig;

  beforeEach(() => {
    mockRunner = createMockAgentRunner();
    mockTemplate = createMockTemplateEngine();
    baseConfig = {
      templatesDir: '/templates',
      projectDir: '/my/project',
      pmModel: 'claude-sonnet-4-20250514',
      pmBudgetUsd: 2.00,
      pmTimeoutMs: 300000
    };
  });

  describe('config.allowedTools passthrough', () => {
    it('passes allowedTools from config to runAgent', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        allowedTools: ['Read', 'Glob', 'Grep']
      });

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.deepEqual(mockRunner.calls[0].allowedTools, ['Read', 'Glob', 'Grep']);
    });

    it('uses default allowedTools when not set in config', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, baseConfig);

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.deepEqual(
        mockRunner.calls[0].allowedTools,
        ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit']
      );
    });

    it('passes empty array when config sets allowedTools to []', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        allowedTools: []
      });

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      // [] is truthy in JS, so `[] || default` returns [].
      // The empty array passes through to AgentRunner, which then
      // handles it via --disallowedTools to block all tools.
      assert.deepEqual(mockRunner.calls[0].allowedTools, []);
    });
  });

  describe('config.budget and timeout passthrough', () => {
    it('passes undefined budget and timeout when not set in config', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        templatesDir: '/templates',
        projectDir: '/my/project',
        pmModel: 'claude-sonnet-4-20250514'
        // no pmBudgetUsd or pmTimeoutMs
      });

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.equal(mockRunner.calls[0].maxBudgetUsd, undefined);
      assert.equal(mockRunner.calls[0].timeoutMs, undefined);
    });

    it('passes explicit budget and timeout from config', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        pmBudgetUsd: 5.00,
        pmTimeoutMs: 600000
      });

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.equal(mockRunner.calls[0].maxBudgetUsd, 5.00);
      assert.equal(mockRunner.calls[0].timeoutMs, 600000);
    });
  });

  describe('config.projectDir passthrough', () => {
    it('passes projectDir as workingDir to runAgent', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        projectDir: '/custom/project/dir'
      });

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.equal(mockRunner.calls[0].workingDir, '/custom/project/dir');
    });
  });

  describe('session ID management', () => {
    it('stores session ID after first chat', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, baseConfig);

      assert.equal(session.sessionId, null);

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.equal(session.sessionId, 'sess-mock-1');
    });

    it('reuses stored session ID for subsequent turns', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, baseConfig);

      await session.chat('first message', { systemPromptTemplate: 'pm-agent' });
      await session.chat('second message', {});

      // Second call should use the stored session ID as resumeSessionId
      assert.equal(mockRunner.calls[1].resumeSessionId, 'sess-mock-1');
    });

    it('fresh AgentSession has no session ID (no cross-session leakage)', () => {
      const session1 = new AgentSession(mockRunner, mockTemplate, baseConfig);
      const session2 = new AgentSession(mockRunner, mockTemplate, baseConfig);

      assert.equal(session1.sessionId, null);
      assert.equal(session2.sessionId, null);
    });
  });

  describe('system prompt handling', () => {
    it('builds system prompt on first turn', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, baseConfig);

      await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.ok(mockRunner.calls[0].systemPrompt !== null, 'system prompt should be set on first turn');
      assert.equal(mockRunner.calls[0].systemPrompt, 'system-prompt-for-pm-agent');
    });

    it('skips system prompt on resume (subsequent turns)', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, baseConfig);

      await session.chat('first', { systemPromptTemplate: 'pm-agent' });
      await session.chat('second', {});

      // Second call should have null systemPrompt since we're resuming
      assert.equal(mockRunner.calls[1].systemPrompt, null);
    });
  });

  describe('return value', () => {
    it('returns response, sessionId, cost, and success', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, baseConfig);

      const result = await session.chat('hello', { systemPromptTemplate: 'pm-agent' });

      assert.equal(result.response, 'mock response');
      assert.equal(result.sessionId, 'sess-mock-1');
      assert.equal(result.cost, 0.01);
      assert.equal(result.success, true);
    });
  });

  describe('context refresh', () => {
    it('does not inject reminder on turns 1 through 4 (default interval 5)', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        contextRefresh: {
          interval: 5,
          persona: 'Riley, the PM',
          projectId: 'proj-001',
          projectDir: '/my/project'
        }
      });

      for (let i = 0; i < 4; i++) {
        await session.chat(`turn ${i + 1}`, { systemPromptTemplate: 'pm-agent' });
      }

      // None of the first 4 turns should have context reminder
      for (let i = 0; i < 4; i++) {
        assert.ok(!mockRunner.calls[i].userPrompt.includes('[Context Reminder:'),
          `turn ${i + 1} should not have context reminder`);
      }
    });

    it('injects reminder on turn 5 with default interval', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        contextRefresh: {
          interval: 5,
          persona: 'Riley, the PM',
          projectId: 'proj-001',
          projectDir: '/my/project'
        }
      });

      for (let i = 0; i < 5; i++) {
        await session.chat(`turn ${i + 1}`, { systemPromptTemplate: 'pm-agent' });
      }

      // Turn 5 (index 4) should have context reminder
      // Turn 5 is _turnCount=5, 5 % 5 === 0 and _turnCount > 1
      assert.ok(mockRunner.calls[4].userPrompt.includes('[Context Reminder:'),
        'turn 5 should have context reminder');
      assert.ok(mockRunner.calls[4].userPrompt.includes('Riley, the PM'));
      assert.ok(mockRunner.calls[4].userPrompt.includes('proj-001'));
    });

    it('uses custom interval', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        contextRefresh: {
          interval: 3,
          persona: 'Morgan',
          projectId: 'proj-002',
          projectDir: '/other'
        }
      });

      for (let i = 0; i < 6; i++) {
        await session.chat(`turn ${i + 1}`, { systemPromptTemplate: 'pm-agent' });
      }

      // Turn 3 (_turnCount=3, 3%3===0, >1) should have reminder
      assert.ok(mockRunner.calls[2].userPrompt.includes('[Context Reminder:'),
        'turn 3 should have context reminder');
      // Turn 6 should also have reminder
      assert.ok(mockRunner.calls[5].userPrompt.includes('[Context Reminder:'),
        'turn 6 should have context reminder');
      // Turn 4 should not
      assert.ok(!mockRunner.calls[3].userPrompt.includes('[Context Reminder:'),
        'turn 4 should not have context reminder');
    });

    it('does not inject conventions into context reminder', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        contextRefresh: {
          interval: 2,
          persona: 'Riley',
          projectId: 'proj-001',
          projectDir: '/my/project',
          conventions: 'Use Jest for testing'
        }
      });

      // Send 2 turns to trigger at turn 2
      await session.chat('turn 1', { systemPromptTemplate: 'pm-agent' });
      await session.chat('turn 2', { systemPromptTemplate: 'pm-agent' });

      const prompt = mockRunner.calls[1].userPrompt;
      assert.ok(prompt.includes('[Context Reminder:'),
        'should have context reminder');
      assert.ok(!prompt.includes('Key conventions:'),
        'should not inject conventions — agents read CLAUDE.md natively');
      assert.ok(!prompt.includes('Use Jest'),
        'should not include conventions text');
    });

    it('omits conventions line when no conventions provided', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, {
        ...baseConfig,
        contextRefresh: {
          interval: 2,
          persona: 'Morgan',
          projectId: 'proj-001',
          projectDir: '/my/project',
          conventions: null
        }
      });

      await session.chat('turn 1', { systemPromptTemplate: 'pm-agent' });
      await session.chat('turn 2', { systemPromptTemplate: 'pm-agent' });

      const prompt = mockRunner.calls[1].userPrompt;
      assert.ok(prompt.includes('[Context Reminder:'));
      assert.ok(prompt.includes('Morgan'));
      assert.ok(!prompt.includes('Key conventions:'),
        'should not include conventions line when null');
    });

    it('does not inject when no contextRefresh config', async () => {
      const session = new AgentSession(mockRunner, mockTemplate, baseConfig);

      for (let i = 0; i < 10; i++) {
        await session.chat(`turn ${i + 1}`, { systemPromptTemplate: 'pm-agent' });
      }

      // No turn should have context reminder
      for (let i = 0; i < 10; i++) {
        assert.ok(!mockRunner.calls[i].userPrompt.includes('[Context Reminder:'),
          `turn ${i + 1} should not have context reminder without config`);
      }
    });
  });
});
