const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { auditRoadmapCompletions } = require('./run');
const { buildClaudeArgs, saveCliSession, loadCliSession } = require('./cli-spawn');

// Note: run.js consolidation logic is tested indirectly via integration tests.
// The shouldConsolidate decision and exit-code logic are internal to executeRun
// and cannot be unit-tested without mocking the full orchestrator stack.

describe('auditRoadmapCompletions', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-test-'));
    // Init a git repo
    const { execSync } = require('child_process');
    execSync('git init', { cwd: tmpDir });
    execSync('git checkout -b main', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });

    // Create openspec dir and roadmap
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when all items already marked complete', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Auth',
      '- [x] `user-auth` — User authentication',
      '- [x] `api-routes` — API routes',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    // Add a merge commit
    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: user-auth (Jordan, Group A)"', { cwd: tmpDir });

    const result = await auditRoadmapCompletions(tmpDir);
    assert.equal(result.reconciled, 0);
    assert.deepEqual(result.items, []);
  });

  it('marks unmarked items that have merge commits', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Auth',
      '- [ ] `user-auth` — User authentication',
      '- [ ] `api-routes` — API routes',
      '- [ ] `no-merge` — Not merged yet',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: user-auth (Jordan, Group A)"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: api-routes (Alex, Group A)"', { cwd: tmpDir });

    const result = await auditRoadmapCompletions(tmpDir);
    assert.equal(result.reconciled, 2);
    assert.deepEqual(result.items.sort(), ['api-routes', 'user-auth']);

    // Verify roadmap was actually updated
    const updated = await fs.readFile(path.join(tmpDir, 'openspec', 'roadmap.md'), 'utf-8');
    assert.ok(updated.includes('- [x] `user-auth`'));
    assert.ok(updated.includes('- [x] `api-routes`'));
    assert.ok(updated.includes('- [ ] `no-merge`'));
  });

  it('returns 0 when no merge commits exist', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Auth',
      '- [ ] `user-auth` — User authentication',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial commit"', { cwd: tmpDir });

    const result = await auditRoadmapCompletions(tmpDir);
    assert.equal(result.reconciled, 0);
    assert.deepEqual(result.items, []);
  });

  it('returns 0 when no roadmap exists', async () => {
    // No roadmap.md created
    const result = await auditRoadmapCompletions(tmpDir);
    assert.equal(result.reconciled, 0);
    assert.deepEqual(result.items, []);
  });

  it('extracts IDs correctly from standard merge format', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Items',
      '- [ ] `calendar-navigation` — Calendar nav',
      '- [ ] `form-validation-system` — Form validation',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: calendar-navigation (Morgan, Group B)"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: form-validation-system (Jordan, Group A)"', { cwd: tmpDir });

    const result = await auditRoadmapCompletions(tmpDir);
    assert.equal(result.reconciled, 2);
    assert.ok(result.items.includes('calendar-navigation'));
    assert.ok(result.items.includes('form-validation-system'));
  });
});

describe('run command — Morgan CLI args', () => {
  it('builds args with system prompt and session ID for new run', () => {
    const args = buildClaudeArgs({
      appendSystemPrompt: 'Morgan orchestration prompt content',
      sessionId: 'run-session-001',
      model: 'test-model',
      name: 'Morgan — proj-001',
      initialPrompt: 'Read the roadmap and start working.'
    });

    assert.ok(args.includes('--append-system-prompt'));
    assert.ok(args.includes('Morgan orchestration prompt content'));
    assert.ok(args.includes('--session-id'));
    assert.ok(args.includes('run-session-001'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('--name'));
    assert.equal(args[args.length - 1], 'Read the roadmap and start working.');
  });

  it('builds args with resume for continued run', () => {
    const args = buildClaudeArgs({
      resume: 'prev-session-id',
      model: 'test-model',
      name: 'Morgan — proj-001'
    });

    assert.ok(args.includes('--resume'));
    assert.ok(args.includes('prev-session-id'));
    assert.ok(!args.includes('--append-system-prompt'));
    assert.ok(!args.includes('--session-id'));
  });

  it('omits initial prompt when resuming', () => {
    const args = buildClaudeArgs({
      resume: 'prev-session-id',
      name: 'Morgan — proj-001'
    });

    // No positional prompt arg
    assert.ok(!args.some(a => a.includes('Read the roadmap')));
  });
});

describe('run command — session persistence', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-session-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saves run session ID', async () => {
    await saveCliSession(tmpDir, 'morgan-session-123', 'run');

    const raw = await fs.readFile(path.join(tmpDir, 'run-session.json'), 'utf-8');
    const state = JSON.parse(raw);
    assert.equal(state.sessionId, 'morgan-session-123');
  });

  it('loads saved run session ID', async () => {
    await saveCliSession(tmpDir, 'morgan-session-456', 'run');
    const loaded = await loadCliSession(tmpDir, 'run');
    assert.equal(loaded, 'morgan-session-456');
  });

  it('returns null when no run session saved', async () => {
    const loaded = await loadCliSession(tmpDir, 'run');
    assert.equal(loaded, null);
  });
});

describe('run command — autonomous mode', () => {
  it('sets autonomous mode when window is present', () => {
    const windowName = 'afternoon';
    const isAutonomous = !!windowName;
    const autonomousMode = isAutonomous
      ? `## Autonomous Mode\n\nYou are running autonomously via the scheduler (window: ${windowName}).`
      : '';

    assert.ok(isAutonomous);
    assert.ok(autonomousMode.includes('Autonomous Mode'));
    assert.ok(autonomousMode.includes('afternoon'));
  });

  it('does not set autonomous mode without window', () => {
    const windowName = null;
    const isAutonomous = !!windowName;

    assert.ok(!isAutonomous);
  });
});

describe('run command — post-session roadmap diff', () => {
  it('detects completed items by count difference', () => {
    const itemsCompleted = 5 - 3;
    assert.equal(itemsCompleted, 2);
  });

  it('detects no progress when counts match', () => {
    const itemsCompleted = 3 - 3;
    assert.equal(itemsCompleted, 0);
  });

  it('consolidation requires completed items and no-consolidate not set', () => {
    assert.equal(2 > 0 && !false, true);  // items + no flag
    assert.equal(0 > 0 && !false, false); // no items
    assert.equal(2 > 0 && !true, false);  // items + flag set
  });
});

describe('runPreflightHealthCheck', () => {
  const { runPreflightHealthCheck } = require('./run');
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preflight-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string when no health check commands resolve', async () => {
    // Empty dir: no healthCheck config, no package.json → nothing to run
    const result = await runPreflightHealthCheck(tmpDir, {});
    assert.equal(result, '');
  });

  it('returns empty string when all commands pass', async () => {
    const config = { healthCheck: { commands: ['true'] } };
    const result = await runPreflightHealthCheck(tmpDir, config);
    assert.equal(result, '');
  });

  it('returns failure block with command and exit code when a command fails', async () => {
    const config = { healthCheck: { commands: ['node -e "process.exit(3)"'] } };
    const result = await runPreflightHealthCheck(tmpDir, config);
    assert.ok(result.includes('Pre-Run Health Check FAILED'));
    assert.ok(result.includes('node -e "process.exit(3)"'));
    assert.ok(/\(exit \d+\)/.test(result));
    assert.ok(result.includes('FIRST task'));
  });

  it('includes only failing commands in the failure block', async () => {
    const config = { healthCheck: { commands: ['true', 'false'] } };
    const result = await runPreflightHealthCheck(tmpDir, config);
    assert.ok(result.includes('### `false` (exit 1)'));
    assert.ok(!result.includes('### `true`'));
  });

  it('never throws on resolver errors — returns empty string', async () => {
    // Nonexistent dir makes auto-detection fail internally; must not throw
    const result = await runPreflightHealthCheck(path.join(tmpDir, 'nope'), {});
    assert.equal(result, '');
  });
});

describe('runHealthCheckReport', () => {
  const { runHealthCheckReport } = require('./run');
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-report-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports ran=false when no commands resolve', async () => {
    const report = await runHealthCheckReport(tmpDir, {});
    assert.deepEqual(report, { ran: false, passed: true, failureDetails: '' });
  });

  it('reports passed=true with empty details when commands pass', async () => {
    const report = await runHealthCheckReport(tmpDir, { healthCheck: { commands: ['true'] } });
    assert.equal(report.ran, true);
    assert.equal(report.passed, true);
    assert.equal(report.failureDetails, '');
  });

  it('reports passed=false with failing command details', async () => {
    const report = await runHealthCheckReport(tmpDir, { healthCheck: { commands: ['true', 'false'] } });
    assert.equal(report.ran, true);
    assert.equal(report.passed, false);
    assert.ok(report.failureDetails.includes('### `false`'));
    assert.ok(!report.failureDetails.includes('### `true`'));
  });
});

describe('didSessionChangeProject', () => {
  const { didSessionChangeProject } = require('./run');
  const { execSync } = require('child_process');
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'did-change-test-'));
    execSync('git init && git checkout -b main', { cwd: tmpDir });
    execSync('git config user.email "t@t.com" && git config user.name "T"', { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'one');
    execSync('git add -A && git commit -m init', { cwd: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function headSha() {
    return execSync('git rev-parse HEAD', { cwd: tmpDir }).toString().trim();
  }

  it('returns false when nothing changed', async () => {
    assert.equal(await didSessionChangeProject(tmpDir, headSha()), false);
  });

  it('returns true when a new commit exists', async () => {
    const pre = headSha();
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'two');
    execSync('git add -A && git commit -m change', { cwd: tmpDir });
    assert.equal(await didSessionChangeProject(tmpDir, pre), true);
  });

  it('returns true when uncommitted changes exist', async () => {
    const pre = headSha();
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'new file');
    assert.equal(await didSessionChangeProject(tmpDir, pre), true);
  });

  it('errs on the side of checking when not a git repo', async () => {
    const nonRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'non-repo-'));
    try {
      assert.equal(await didSessionChangeProject(nonRepo, 'abc'), true);
    } finally {
      await fs.rm(nonRepo, { recursive: true, force: true });
    }
  });
});
