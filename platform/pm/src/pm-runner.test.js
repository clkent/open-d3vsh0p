const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { PmRunner, PmSession } = require('./pm-runner');
const { CONTEXT_FILES } = require('./devshop-context');

// Stub AgentRunner that records calls
function createMockAgentRunner() {
  const calls = [];
  return {
    calls,
    runAgent: async (opts) => {
      calls.push(opts);
      return {
        success: true,
        output: 'mock response',
        cost: 0.01,
        sessionId: 'sess-123'
      };
    }
  };
}

// Stub TemplateEngine
function createMockTemplateEngine() {
  return {
    _resolvePartials: async (raw) => raw,
    renderString: (template, vars) => {
      // Simple template variable replacement
      let result = template;
      for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
      return result;
    },
    renderAgentPrompt: async (agentName, vars) => `system prompt for ${agentName}`
  };
}

describe('PmRunner.createKickoffSession', () => {
  it('returns a PmSession instance', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();

    const session = await PmRunner.createKickoffSession(runner, engine, {
      projectDir: '/tmp/test-project',
      projectId: 'proj-001-test',
      githubRepo: 'https://github.com/test/test',
      config: {},
      warn: () => {}
    });

    assert.ok(session instanceof PmSession);
  });

  it('starts with read-only tools', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();

    const session = await PmRunner.createKickoffSession(runner, engine, {
      projectDir: '/tmp/test-project',
      projectId: 'proj-001-test',
      githubRepo: 'https://github.com/test/test',
      config: {},
      warn: () => {}
    });

    assert.deepEqual(session.config.allowedTools, ['Read', 'Glob', 'Grep']);
  });

  it('loads DevShop context', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();

    const session = await PmRunner.createKickoffSession(runner, engine, {
      projectDir: '/tmp/test-project',
      projectId: 'proj-001-test',
      githubRepo: 'https://github.com/test/test',
      config: {},
      warn: () => {}
    });

    // Context should be a string (may be empty if DevShop files aren't in test env)
    assert.equal(typeof session.config.devshopContext, 'string');
  });

  it('creates sandbox hooks', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();

    const session = await PmRunner.createKickoffSession(runner, engine, {
      projectDir: '/tmp/test-project',
      projectId: 'proj-001-test',
      githubRepo: 'https://github.com/test/test',
      config: {},
      warn: () => {}
    });

    assert.ok(session.config.sandboxHooks);
    assert.ok(Array.isArray(session.config.sandboxHooks.preToolUse));
  });

  it('uses configured PM model', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();

    const session = await PmRunner.createKickoffSession(runner, engine, {
      projectDir: '/tmp/test-project',
      projectId: 'proj-001-test',
      githubRepo: 'https://github.com/test/test',
      config: { agents: { pm: { model: 'claude-opus-4-20250514' } } },
      warn: () => {}
    });

    assert.equal(session.config.pmModel, 'claude-opus-4-20250514');
  });
});

describe('PmSession.chat', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-test-'));
    // Create a minimal prompt file
    const pmDir = path.join(tmpDir, 'pm-agent');
    await fs.mkdir(pmDir, { recursive: true });
    await fs.writeFile(
      path.join(pmDir, 'kickoff-prompt.md'),
      'You are Riley. Context: {{DEVSHOP_CONTEXT}}. Project: {{PROJECT_ID}}'
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns response matching AgentSession interface', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();
    const session = new PmSession(runner, engine, {
      templatesDir: tmpDir,
      projectDir: '/tmp/project',
      pmModel: 'claude-sonnet-4-20250514',
      devshopContext: '### Parser\n```\ncode\n```',
      sandboxHooks: { preToolUse: [] },
      allowedTools: ['Read', 'Glob', 'Grep']
    });

    const result = await session.chat('Hello Riley');
    assert.equal(result.response, 'mock response');
    assert.equal(result.sessionId, 'sess-123');
    assert.equal(result.cost, 0.01);
    assert.equal(result.success, true);
  });

  it('passes sandbox hooks to agent runner', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();
    const sandboxHooks = { preToolUse: [() => {}] };
    const session = new PmSession(runner, engine, {
      templatesDir: tmpDir,
      projectDir: '/tmp/project',
      pmModel: 'claude-sonnet-4-20250514',
      devshopContext: '',
      sandboxHooks,
      allowedTools: ['Read']
    });

    await session.chat('test');
    assert.equal(runner.calls[0].hooks, sandboxHooks);
  });

  it('injects DEVSHOP_CONTEXT into template vars on first turn', async () => {
    const runner = createMockAgentRunner();
    const renderedPrompts = [];
    const engine = {
      _resolvePartials: async (raw) => raw,
      renderString: (template, vars) => {
        renderedPrompts.push({ template, vars });
        return template.replace('{{DEVSHOP_CONTEXT}}', vars.DEVSHOP_CONTEXT || '');
      }
    };

    const session = new PmSession(runner, engine, {
      templatesDir: tmpDir,
      projectDir: '/tmp/project',
      pmModel: 'claude-sonnet-4-20250514',
      devshopContext: 'PARSER CODE HERE',
      sandboxHooks: { preToolUse: [] },
      allowedTools: ['Read']
    });

    await session.chat('describe my project', {
      promptFile: 'kickoff-prompt.md',
      templateVars: { PROJECT_ID: 'proj-001' }
    });

    assert.equal(renderedPrompts.length, 1);
    assert.equal(renderedPrompts[0].vars.DEVSHOP_CONTEXT, 'PARSER CODE HERE');
    assert.equal(renderedPrompts[0].vars.PROJECT_ID, 'proj-001');
  });

  it('does not send system prompt on subsequent turns', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();
    const session = new PmSession(runner, engine, {
      templatesDir: tmpDir,
      projectDir: '/tmp/project',
      pmModel: 'claude-sonnet-4-20250514',
      devshopContext: '',
      sandboxHooks: { preToolUse: [] },
      allowedTools: ['Read']
    });

    // First turn — system prompt
    await session.chat('first message', { promptFile: 'kickoff-prompt.md', templateVars: {} });
    assert.ok(runner.calls[0].systemPrompt !== null);

    // Second turn — no system prompt (session resumed)
    await session.chat('second message');
    assert.equal(runner.calls[1].systemPrompt, null);
    assert.equal(runner.calls[1].resumeSessionId, 'sess-123');
  });

  it('supports tool restriction changes', async () => {
    const runner = createMockAgentRunner();
    const engine = createMockTemplateEngine();
    const session = new PmSession(runner, engine, {
      templatesDir: tmpDir,
      projectDir: '/tmp/project',
      pmModel: 'claude-sonnet-4-20250514',
      devshopContext: '',
      sandboxHooks: { preToolUse: [] },
      allowedTools: ['Read', 'Glob', 'Grep']
    });

    // Q&A phase — read-only
    await session.chat('question', { promptFile: 'kickoff-prompt.md', templateVars: {} });
    assert.deepEqual(runner.calls[0].allowedTools, ['Read', 'Glob', 'Grep']);

    // Switch to full tools (like kickoff.js does when user types "go")
    session.config.allowedTools = ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit'];
    await session.chat('create specs');
    assert.deepEqual(runner.calls[1].allowedTools, ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit']);
  });
});
