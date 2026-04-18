const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execFile: rawExecFile } = require('child_process');
const { promisify } = require('util');
const { Microcycle } = require('./microcycle');
const { GitOps } = require('./git/git-ops');

const execFileAsync = promisify(rawExecFile);

// ── Helpers ──────────────────────────────────────────────────────────────────

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 });
}

/**
 * Create a fresh git repo in a tmpdir with:
 *  - package.json with `node --test src/*.test.js` script
 *  - src/index.js (trivial module)
 *  - src/index.test.js (trivial passing test)
 *  - initial commit on main
 *  - session branch checked out
 */
function initTestRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-integ-'));

  git(tmpDir, ['init', '-b', 'main']);
  git(tmpDir, ['config', 'user.email', 'test@test.com']);
  git(tmpDir, ['config', 'user.name', 'Test']);

  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
    name: 'integ-test',
    scripts: { test: 'node --test src/*.test.js' }
  }, null, 2));

  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'),
    'module.exports = { greet: (n) => `Hello ${n}` };\n');
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.test.js'),
    `const { describe, it } = require('node:test');\n` +
    `const assert = require('node:assert/strict');\n` +
    `const { greet } = require('./index');\n` +
    `describe('greet', () => {\n` +
    `  it('says hello', () => assert.equal(greet('World'), 'Hello World'));\n` +
    `});\n`
  );

  git(tmpDir, ['add', '-A']);
  git(tmpDir, ['commit', '-m', 'init']);
  git(tmpDir, ['checkout', '-b', 'devshop/session-test']);

  return tmpDir;
}

function cleanup(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** No-op logger that satisfies GitOps and Microcycle */
const noopLogger = {
  log: async () => {},
  logCommit: async () => {},
  logMerge: async () => {},
  logAgentRun: async () => {},
  logTestRun: async () => {}
};

/** Monitor that always allows */
const noopMonitor = {
  shouldStop: () => ({ stop: false }),
  recordInvocation: () => {}
};

/** Standard config matching unit tests */
const baseConfig = {
  retryLimits: { implementation: 3, testFix: 3, reviewFix: 2 },
  agents: {
    'implementation': { model: 'test', maxBudgetUsd: 5, timeoutMs: 60000, allowedTools: [] },
    'principal-engineer': { model: 'test', maxBudgetUsd: 2, timeoutMs: 60000, allowedTools: [] }
  },
  git: { commitPrefix: 'feat' }
};

/**
 * Build a mock agentRunner that distinguishes implementation vs review calls
 * based on the system prompt returned by templateEngine.
 *
 * - Implementation calls: invoke `implFn(workingDir, callIndex)`
 * - Review calls: return APPROVE JSON
 */
function buildMockAgent(implFn) {
  let callIndex = 0;
  return {
    runAgent: async ({ systemPrompt, workingDir }) => {
      callIndex++;
      if (systemPrompt === 'system-prompt-for-principal-engineer') {
        // Review agent — always approve
        return {
          success: true, cost: 0.10, duration: 100,
          output: JSON.stringify({
            decision: 'APPROVE',
            scores: { spec_adherence: 5, test_coverage: 5, code_quality: 5, security: 5, simplicity: 5 },
            summary: 'Looks good',
            issues: []
          })
        };
      }
      // Implementation agent
      return implFn(workingDir, callIndex);
    }
  };
}

/** Template engine that returns distinguishable system prompts */
const mockTemplateEngine = {
  renderAgentPrompt: async (persona) =>
    `system-prompt-for-${persona}`
};

/**
 * Override _runTests to strip NODE_TEST_CONTEXT from the env.
 * When running inside `node --test`, Node sets NODE_TEST_CONTEXT=child-v8
 * which leaks into subprocess npm-test calls and causes the inner test
 * runner to swallow failures. This patches the microcycle to run real
 * `npm test` with a clean env.
 */
function patchRunTests(mc) {
  mc._runTests = async function () {
    const env = { ...process.env, CI: 'true' };
    delete env.NODE_TEST_CONTEXT;
    try {
      const { stdout } = await execFileAsync('npm', ['test'], {
        cwd: this.workingDir,
        timeout: 60000,
        env
      });
      return { passed: true, exitCode: 0, output: stdout, summary: '' };
    } catch (err) {
      return {
        passed: false,
        exitCode: err.code || 1,
        output: (err.stdout || '') + '\n' + (err.stderr || ''),
        summary: ''
      };
    }
  };
}

/** OpenSpec mock — just returns prompt strings */
const mockOpenspec = {
  buildImplementationPrompt: () => 'implement-prompt',
  buildRetryPrompt: () => 'retry-prompt',
  buildReviewPrompt: () => 'review-prompt',
  getDesignSkillsSection: async () => ''
};


// ── Integration Tests ────────────────────────────────────────────────────────

describe('Microcycle integration', () => {
  const tmpDirs = [];

  after(() => {
    for (const d of tmpDirs) cleanup(d);
  });

  function freshRepo() {
    const d = initTestRepo();
    tmpDirs.push(d);
    return d;
  }

  // Test 1: Happy path — agent writes files, real npm test passes, real commit
  it('happy path: real git commit and real npm test', async () => {
    const workDir = freshRepo();
    const gitOps = new GitOps(noopLogger);

    const agentRunner = buildMockAgent((dir) => {
      // Write a new module + test
      fs.writeFileSync(path.join(dir, 'src', 'math.js'),
        'module.exports = { add: (a, b) => a + b };\n');
      fs.writeFileSync(path.join(dir, 'src', 'math.test.js'),
        `const { describe, it } = require('node:test');\n` +
        `const assert = require('node:assert/strict');\n` +
        `const { add } = require('./math');\n` +
        `describe('add', () => {\n` +
        `  it('adds numbers', () => assert.equal(add(2, 3), 5));\n` +
        `});\n`
      );
      return { success: true, cost: 1.00, duration: 2000, output: 'done' };
    });

    const mc = new Microcycle({
      agentRunner, templateEngine: mockTemplateEngine, gitOps,
      openspec: mockOpenspec, logger: noopLogger, monitor: noopMonitor,
      config: baseConfig,
      projectDir: workDir, workingDir: workDir,
      sessionBranch: 'devshop/session-test',
      projectId: 'integ', techStack: 'Node.js',
      persona: 'implementation-agent'
    });

    patchRunTests(mc);

    const result = await mc.run('math-utils', 'add-math', { id: 'math-utils', name: 'Math Utils' });

    assert.equal(result.status, 'merged');
    assert.equal(result.error, null);
    // Real commit SHA is 40 hex chars
    assert.match(result.commitSha, /^[0-9a-f]{40}$/);

    // Files exist on disk
    assert.ok(fs.existsSync(path.join(workDir, 'src', 'math.js')));
    assert.ok(fs.existsSync(path.join(workDir, 'src', 'math.test.js')));

    // Git log shows the commit
    const log = git(workDir, ['log', '--oneline', '-1']);
    assert.ok(log.includes('feat: implement Math Utils'));
  });

  // Test 2: Salvage on agent failure — agent writes+commits, then returns success:false
  it('salvages when agent fails but work was committed', async () => {
    const workDir = freshRepo();
    const gitOps = new GitOps(noopLogger);

    const agentRunner = buildMockAgent((dir, callIndex) => {
      if (callIndex === 1) {
        // Implementation: write files, commit them, then "fail"
        fs.writeFileSync(path.join(dir, 'src', 'utils.js'),
          'module.exports = { double: (n) => n * 2 };\n');
        fs.writeFileSync(path.join(dir, 'src', 'utils.test.js'),
          `const { describe, it } = require('node:test');\n` +
          `const assert = require('node:assert/strict');\n` +
          `const { double } = require('./utils');\n` +
          `describe('double', () => {\n` +
          `  it('doubles', () => assert.equal(double(4), 8));\n` +
          `});\n`
        );
        // Agent commits its own work (simulating what Claude Code does)
        git(dir, ['add', '-A']);
        git(dir, ['commit', '-m', 'feat: add utils']);
        return { success: false, cost: 1.00, duration: 5000, error: 'context window exceeded' };
      }
      // Review — approve (handled by buildMockAgent default)
      return { success: true, cost: 0.10, duration: 100, output: 'APPROVE' };
    });

    const mc = new Microcycle({
      agentRunner, templateEngine: mockTemplateEngine, gitOps,
      openspec: mockOpenspec, logger: noopLogger, monitor: noopMonitor,
      config: baseConfig,
      projectDir: workDir, workingDir: workDir,
      sessionBranch: 'devshop/session-test',
      projectId: 'integ', techStack: 'Node.js',
      persona: 'implementation-agent'
    });

    patchRunTests(mc);

    const result = await mc.run('add-utils', 'add-utils', { id: 'add-utils', name: 'Add Utils' });

    assert.equal(result.status, 'merged');
    // commitSha should be 'agent-committed' because commitAll returns null (agent already committed)
    assert.equal(result.commitSha, 'agent-committed');
    // Files exist
    assert.ok(fs.existsSync(path.join(workDir, 'src', 'utils.js')));
  });

  // Test 3: Test failure triggers retry — first attempt writes buggy code, second fixes
  it('retries when real npm test fails', async () => {
    const workDir = freshRepo();
    const gitOps = new GitOps(noopLogger);
    let implCall = 0;

    const agentRunner = buildMockAgent((dir) => {
      implCall++;
      if (implCall === 1) {
        // Write buggy code — test will fail
        fs.writeFileSync(path.join(dir, 'src', 'calc.js'),
          'module.exports = { multiply: (a, b) => a + b };\n'); // bug: + instead of *
        fs.writeFileSync(path.join(dir, 'src', 'calc.test.js'),
          `const { describe, it } = require('node:test');\n` +
          `const assert = require('node:assert/strict');\n` +
          `const { multiply } = require('./calc');\n` +
          `describe('multiply', () => {\n` +
          `  it('multiplies', () => assert.equal(multiply(3, 4), 12));\n` +
          `});\n`
        );
        return { success: true, cost: 1.00, duration: 2000, output: 'done' };
      }
      // Second attempt — fix the bug
      fs.writeFileSync(path.join(dir, 'src', 'calc.js'),
        'module.exports = { multiply: (a, b) => a * b };\n'); // fixed
      return { success: true, cost: 0.80, duration: 1500, output: 'fixed' };
    });

    const mc = new Microcycle({
      agentRunner, templateEngine: mockTemplateEngine, gitOps,
      openspec: mockOpenspec, logger: noopLogger, monitor: noopMonitor,
      config: baseConfig,
      projectDir: workDir, workingDir: workDir,
      sessionBranch: 'devshop/session-test',
      projectId: 'integ', techStack: 'Node.js',
      persona: 'implementation-agent'
    });

    patchRunTests(mc);

    const result = await mc.run('calc', 'add-calc', { id: 'calc', name: 'Calc' });

    assert.equal(result.status, 'merged');
    assert.ok(result.attempts >= 2, `expected >= 2 attempts, got ${result.attempts}`);
    // File should have the fixed version
    const content = fs.readFileSync(path.join(workDir, 'src', 'calc.js'), 'utf-8');
    assert.ok(content.includes('a * b'), 'file should have the fixed multiplication');
  });

  // Test 4: No code changes retries — first attempt writes nothing, second writes files
  it('retries when no code changes produced', async () => {
    const workDir = freshRepo();
    const gitOps = new GitOps(noopLogger);
    let implCall = 0;

    const agentRunner = buildMockAgent((dir) => {
      implCall++;
      if (implCall === 1) {
        // Write nothing — git status will be clean
        return { success: true, cost: 0.50, duration: 1000, output: 'thinking...' };
      }
      // Second attempt — actually write code
      fs.writeFileSync(path.join(dir, 'src', 'format.js'),
        'module.exports = { upper: (s) => s.toUpperCase() };\n');
      return { success: true, cost: 0.80, duration: 1500, output: 'done' };
    });

    const mc = new Microcycle({
      agentRunner, templateEngine: mockTemplateEngine, gitOps,
      openspec: mockOpenspec, logger: noopLogger, monitor: noopMonitor,
      config: baseConfig,
      projectDir: workDir, workingDir: workDir,
      sessionBranch: 'devshop/session-test',
      projectId: 'integ', techStack: 'Node.js',
      persona: 'implementation-agent'
    });

    // Stub _runTests since focus is on the commit path
    mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

    const result = await mc.run('format', 'add-format', { id: 'format', name: 'Format' });

    assert.equal(result.status, 'merged');
    assert.ok(result.attempts >= 2, `expected >= 2 attempts, got ${result.attempts}`);
    assert.ok(fs.existsSync(path.join(workDir, 'src', 'format.js')));
  });

  // Test 5: Work branch merges cleanly to session
  it('work branch merges cleanly to session after microcycle', async () => {
    const workDir = freshRepo();
    const gitOps = new GitOps(noopLogger);

    const agentRunner = buildMockAgent((dir) => {
      fs.writeFileSync(path.join(dir, 'src', 'strings.js'),
        'module.exports = { reverse: (s) => s.split(\'\').reverse().join(\'\') };\n');
      return { success: true, cost: 1.00, duration: 2000, output: 'done' };
    });

    const mc = new Microcycle({
      agentRunner, templateEngine: mockTemplateEngine, gitOps,
      openspec: mockOpenspec, logger: noopLogger, monitor: noopMonitor,
      config: baseConfig,
      projectDir: workDir, workingDir: workDir,
      sessionBranch: 'devshop/session-test',
      projectId: 'integ', techStack: 'Node.js',
      persona: 'implementation-agent'
    });

    // Stub _runTests since focus is on the merge path
    mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

    const result = await mc.run('strings', 'add-strings', { id: 'strings', name: 'Strings' });

    assert.equal(result.status, 'merged');
    assert.ok(result.workBranch.includes('strings'));

    // Now merge work branch to session — this is what the orchestrator does after microcycle
    await gitOps.mergeWorkToSession(workDir, 'devshop/session-test', result.workBranch, 'strings');

    // Verify we're on session branch and file exists
    const branch = git(workDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    assert.equal(branch, 'devshop/session-test');
    assert.ok(fs.existsSync(path.join(workDir, 'src', 'strings.js')),
      'file should exist on session branch after merge');

    // Verify merge commit exists
    const log = git(workDir, ['log', '--oneline', '-1']);
    assert.ok(log.includes('merge: strings'));
  });
});
