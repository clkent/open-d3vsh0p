const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { reconcile } = require('./roadmap-reconciler');
const { RoadmapReader } = require('./roadmap-reader');
const { GitOps } = require('../git/git-ops');

describe('roadmap-reconciler', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconciler-test-'));
    const { execSync } = require('child_process');
    execSync('git init', { cwd: tmpDir });
    execSync('git checkout -b main', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function createMockState(pending = [], completed = []) {
    const state = {
      requirements: { pending: [...pending], completed: [...completed], parked: [] }
    };
    return {
      getState: () => state,
      update: async (patch) => {
        if (patch.requirements) state.requirements = patch.requirements;
      }
    };
  }

  it('returns 0 when no items need reconciliation', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Auth',
      '- [ ] `user-auth` — User authentication',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial"', { cwd: tmpDir });

    const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
    const gitOps = new GitOps(logger);
    const reader = new RoadmapReader(tmpDir);
    const stateMachine = createMockState(['user-auth']);

    const result = await reconcile({
      gitOps, roadmapReader: reader, stateMachine, projectDir: tmpDir, logger
    });

    assert.equal(result.reconciled, 0);
    assert.deepEqual(result.items, []);
  });

  it('reconciles 2 pending items with merge commits on main', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Auth',
      '- [ ] `user-auth` — User authentication',
      '- [ ] `api-routes` — API routes',
      '- [ ] `no-merge` — Not yet merged',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: user-auth (Jordan, Group A)"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: api-routes (Alex, Group A)"', { cwd: tmpDir });

    const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
    const gitOps = new GitOps(logger);
    const reader = new RoadmapReader(tmpDir);
    const stateMachine = createMockState(['user-auth', 'api-routes', 'no-merge']);

    const result = await reconcile({
      gitOps, roadmapReader: reader, stateMachine, projectDir: tmpDir, logger
    });

    assert.equal(result.reconciled, 2);
    assert.deepEqual(result.items.sort(), ['api-routes', 'user-auth']);

    // Verify roadmap was updated
    const updated = await fs.readFile(path.join(tmpDir, 'openspec', 'roadmap.md'), 'utf-8');
    assert.match(updated, /- \[x\] `user-auth`/);
    assert.match(updated, /- \[x\] `api-routes`/);
    assert.match(updated, /- \[ \] `no-merge`/);

    // Verify state machine was updated
    const state = stateMachine.getState();
    assert.ok(state.requirements.completed.includes('user-auth'));
    assert.ok(state.requirements.completed.includes('api-routes'));
    assert.ok(!state.requirements.pending.includes('user-auth'));
    assert.ok(state.requirements.pending.includes('no-merge'));
  });

  it('handles missing git log gracefully', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Auth',
      '- [ ] `user-auth` — User authentication',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    // Create a mock gitOps that throws on git log
    const gitOps = {
      _git: async () => { throw new Error('fatal: bad default revision'); }
    };
    const logger = { log: async () => {} };
    const reader = new RoadmapReader(tmpDir);
    const stateMachine = createMockState(['user-auth']);

    const result = await reconcile({
      gitOps, roadmapReader: reader, stateMachine, projectDir: tmpDir, logger
    });

    assert.equal(result.reconciled, 0);
    assert.deepEqual(result.items, []);
  });

  it('extracts IDs correctly from various merge commit formats', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Items',
      '- [ ] `calendar-navigation` — Calendar nav',
      '- [ ] `form-validation-system` — Form validation',
      '- [ ] `simple-item` — Simple item',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: calendar-navigation (Morgan, Group B)"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: form-validation-system (Jordan, Group A)"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: simple-item work into worktree"', { cwd: tmpDir });

    const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
    const gitOps = new GitOps(logger);
    const reader = new RoadmapReader(tmpDir);
    const stateMachine = createMockState(['calendar-navigation', 'form-validation-system', 'simple-item']);

    const result = await reconcile({
      gitOps, roadmapReader: reader, stateMachine, projectDir: tmpDir, logger
    });

    assert.equal(result.reconciled, 3);
    assert.ok(result.items.includes('calendar-navigation'));
    assert.ok(result.items.includes('form-validation-system'));
    assert.ok(result.items.includes('simple-item'));
  });

  it('skips items already marked complete', async () => {
    const roadmap = [
      '# Roadmap: Test',
      '## Phase I: Core',
      '### Group A: Auth',
      '- [x] `user-auth` — Already marked complete',
      '- [ ] `api-routes` — Pending but merged',
    ].join('\n');

    await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), roadmap);

    const { execSync } = require('child_process');
    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: user-auth (Jordan, Group A)"', { cwd: tmpDir });
    execSync('git commit --allow-empty -m "merge: api-routes (Alex, Group A)"', { cwd: tmpDir });

    const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
    const gitOps = new GitOps(logger);
    const reader = new RoadmapReader(tmpDir);
    const stateMachine = createMockState(['api-routes'], ['user-auth']);

    const result = await reconcile({
      gitOps, roadmapReader: reader, stateMachine, projectDir: tmpDir, logger
    });

    // Only api-routes should be reconciled, not user-auth (already complete)
    assert.equal(result.reconciled, 1);
    assert.deepEqual(result.items, ['api-routes']);
  });
});
