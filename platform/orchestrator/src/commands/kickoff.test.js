const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { isValidProjectName, findMissingFiles, bootstrapProject, generateClaudeMd, isFrontendTechStack } = require('./kickoff');

describe('isValidProjectName', () => {
  it('accepts simple kebab-case names', () => {
    assert.equal(isValidProjectName('garden-planner'), true);
    assert.equal(isValidProjectName('task-api'), true);
    assert.equal(isValidProjectName('weather-dash'), true);
  });

  it('accepts single-word names', () => {
    assert.equal(isValidProjectName('myapp'), true);
  });

  it('accepts names with numbers', () => {
    assert.equal(isValidProjectName('app2'), true);
    assert.equal(isValidProjectName('my-app-v2'), true);
  });

  it('rejects names starting with a number', () => {
    assert.equal(isValidProjectName('2fast'), false);
  });

  it('rejects names starting with a hyphen', () => {
    assert.equal(isValidProjectName('-bad-name'), false);
  });

  it('rejects names with uppercase', () => {
    assert.equal(isValidProjectName('MyApp'), false);
    assert.equal(isValidProjectName('garden-Planner'), false);
  });

  it('rejects names with spaces', () => {
    assert.equal(isValidProjectName('my app'), false);
  });

  it('rejects names with underscores', () => {
    assert.equal(isValidProjectName('my_app'), false);
  });

  it('rejects empty string', () => {
    assert.equal(isValidProjectName(''), false);
  });
});

describe('findMissingFiles', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kickoff-test-'));
    // Create base openspec structure
    await fs.mkdir(path.join(tmpDir, 'openspec', 'specs'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns all missing when openspec is empty', async () => {
    const missing = await findMissingFiles(tmpDir);

    assert.ok(missing.some(m => m.includes('project.md')));
    assert.ok(missing.some(m => m.includes('roadmap.md')));
    assert.ok(missing.some(m => m.includes('conventions.md')));
    assert.ok(missing.some(m => m.includes('specs')));
  });

  it('returns empty array when all files exist', async () => {
    await fs.writeFile(path.join(tmpDir, 'openspec', 'project.md'), '# Project');
    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), '# Roadmap');
    await fs.writeFile(path.join(tmpDir, 'openspec', 'conventions.md'), '# Conventions');
    await fs.mkdir(path.join(tmpDir, 'openspec', 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'openspec', 'specs', 'auth', 'spec.md'), '# Auth');

    const missing = await findMissingFiles(tmpDir);

    assert.deepEqual(missing, []);
  });

  it('detects missing roadmap.md', async () => {
    await fs.writeFile(path.join(tmpDir, 'openspec', 'project.md'), '# Project');
    await fs.writeFile(path.join(tmpDir, 'openspec', 'conventions.md'), '# Conventions');
    await fs.mkdir(path.join(tmpDir, 'openspec', 'specs', 'auth'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'openspec', 'specs', 'auth', 'spec.md'), '# Auth');

    const missing = await findMissingFiles(tmpDir);

    assert.deepEqual(missing, ['openspec/roadmap.md']);
  });

  it('detects empty spec directory with spec.md missing', async () => {
    await fs.writeFile(path.join(tmpDir, 'openspec', 'project.md'), '# Project');
    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), '# Roadmap');
    await fs.writeFile(path.join(tmpDir, 'openspec', 'conventions.md'), '# Conventions');
    await fs.mkdir(path.join(tmpDir, 'openspec', 'specs', 'auth'), { recursive: true });
    // auth directory exists but no spec.md inside

    const missing = await findMissingFiles(tmpDir);

    assert.deepEqual(missing, ['openspec/specs/auth/spec.md']);
  });

  it('detects missing project.md only', async () => {
    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), '# Roadmap');
    await fs.writeFile(path.join(tmpDir, 'openspec', 'conventions.md'), '# Conventions');
    await fs.mkdir(path.join(tmpDir, 'openspec', 'specs', 'api'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'openspec', 'specs', 'api', 'spec.md'), '# API');

    const missing = await findMissingFiles(tmpDir);

    assert.deepEqual(missing, ['openspec/project.md']);
  });

  it('detects missing conventions.md', async () => {
    await fs.writeFile(path.join(tmpDir, 'openspec', 'project.md'), '# Project');
    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), '# Roadmap');
    await fs.mkdir(path.join(tmpDir, 'openspec', 'specs', 'api'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'openspec', 'specs', 'api', 'spec.md'), '# API');

    const missing = await findMissingFiles(tmpDir);

    assert.deepEqual(missing, ['openspec/conventions.md']);
  });
});

describe('bootstrapProject', () => {
  let logEntries;
  let logger;

  beforeEach(() => {
    logEntries = [];
    logger = {
      log: async (level, event, data) => { logEntries.push({ level, event, data }); }
    };
  });

  it('calls bootstrap agent and returns cost', async () => {
    let chatCalled = false;
    const mockAgentRunner = {};
    const mockTemplateEngine = {};

    // Mock AgentSession — bootstrapProject requires agent-session internally
    // We test the integration by verifying it handles agent success
    const mockResult = { cost: 1.5, buildPassed: false };

    // Since bootstrapProject creates AgentSession internally, we test the
    // error handling path by providing an agentRunner that will cause
    // AgentSession.chat() to fail gracefully
    const result = await bootstrapProject(
      { runAgent: async () => { throw new Error('mock agent not available'); } },
      { renderString: (s) => s, renderAgentPrompt: async () => '' },
      {
        templatesDir: path.join(os.tmpdir(), 'nonexistent-templates'),
        projectDir: os.tmpdir(),
        projectId: 'proj-test'
      },
      logger
    );

    assert.equal(result.cost, 0);
    assert.equal(result.buildPassed, false);
    assert.ok(logEntries.find(e => e.event === 'bootstrap_started'));
    assert.ok(logEntries.find(e => e.event === 'bootstrap_failed'));
  });

  it('logs bootstrap_started on entry', async () => {
    await bootstrapProject(
      { runAgent: async () => { throw new Error('mock'); } },
      { renderString: (s) => s, renderAgentPrompt: async () => '' },
      {
        templatesDir: os.tmpdir(),
        projectDir: os.tmpdir(),
        projectId: 'proj-test-log'
      },
      logger
    );

    const startLog = logEntries.find(e => e.event === 'bootstrap_started');
    assert.ok(startLog);
    assert.equal(startLog.data.projectId, 'proj-test-log');
  });

  it('handles agent failure gracefully without crashing', async () => {
    const result = await bootstrapProject(
      { runAgent: async () => { throw new Error('agent exploded'); } },
      { renderString: (s) => s, renderAgentPrompt: async () => '' },
      {
        templatesDir: os.tmpdir(),
        projectDir: os.tmpdir(),
        projectId: 'proj-test-fail'
      },
      logger
    );

    // Should not throw — returns gracefully
    assert.equal(result.buildPassed, false);
    assert.equal(result.cost, 0);

    const failLog = logEntries.find(e => e.event === 'bootstrap_failed');
    assert.ok(failLog);
    assert.ok(failLog.data.error);
  });
});

describe('generateClaudeMd', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudemd-test-'));
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes design skills section when .claude/skills/frontend-design exists', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'frontend-design'), { recursive: true });

    await generateClaudeMd(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('## Design Skills'));
    assert.ok(content.includes('Impeccable design skills installed'));
    assert.ok(content.includes('/polish'));
  });

  it('omits design skills section when .claude/skills/frontend-design does not exist', async () => {
    await generateClaudeMd(tmpDir);

    const content = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(!content.includes('## Design Skills'));
    assert.ok(!content.includes('Impeccable'));
  });
});

describe('isFrontendTechStack', () => {
  it('detects React projects', () => {
    assert.equal(isFrontendTechStack('- React\n- TypeScript\n- Node.js'), true);
  });

  it('detects Next.js projects', () => {
    assert.equal(isFrontendTechStack('- Next.js\n- PostgreSQL'), true);
  });

  it('detects Vue projects', () => {
    assert.equal(isFrontendTechStack('- Vue 3\n- Vite'), true);
  });

  it('detects Svelte projects', () => {
    assert.equal(isFrontendTechStack('- SvelteKit\n- Svelte'), true);
  });

  it('detects React Native projects', () => {
    assert.equal(isFrontendTechStack('- React Native\n- Expo'), true);
  });

  it('detects Astro projects', () => {
    assert.equal(isFrontendTechStack('- Astro\n- Tailwind'), true);
  });

  it('returns false for backend-only projects', () => {
    assert.equal(isFrontendTechStack('- Node.js\n- Express\n- PostgreSQL'), false);
  });

  it('returns false for Python projects', () => {
    assert.equal(isFrontendTechStack('- Python\n- FastAPI\n- SQLAlchemy'), false);
  });

  it('is case-insensitive', () => {
    assert.equal(isFrontendTechStack('- REACT\n- NEXT.JS'), true);
  });
});
