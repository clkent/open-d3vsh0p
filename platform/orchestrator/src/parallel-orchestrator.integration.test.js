const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { GitOps } = require('./git/git-ops');
const { MergeLock } = require('./git/merge-lock');

// Strip GIT_* env vars that leak from outer git processes (e.g. pre-commit hooks).
// GIT_INDEX_FILE and GIT_DIR cause worktree operations to fail in test repos.
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) {
  if (key.startsWith('GIT_')) delete cleanEnv[key];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000, env: cleanEnv });
}

/**
 * Create a fresh git repo in a tmpdir with:
 *  - package.json, src/index.js, src/index.test.js
 *  - initial commit on main
 *  - session branch checked out
 */
function initTestRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-integ-'));

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

/** No-op logger that satisfies GitOps */
const noopLogger = {
  log: async () => {},
  logCommit: async () => {},
  logMerge: async () => {},
};

/** GitOps subclass that strips GIT_* env vars from all git calls */
class CleanGitOps extends GitOps {
  async _git(cwd, args, { timeout = 30000 } = {}) {
    const { execFile: execFilePromise } = require('./infra/exec-utils');
    try {
      return await execFilePromise('git', args, {
        cwd, maxBuffer: 10 * 1024 * 1024, timeout, env: cleanEnv
      });
    } catch (err) {
      const message = err.stderr || err.message;
      throw new Error(`git ${args[0]} failed: ${message}`);
    }
  }
}

// ── Integration Tests ────────────────────────────────────────────────────────

describe('ParallelOrchestrator integration (worktree + merge-lock)', () => {
  const tmpDirs = [];

  after(() => {
    for (const d of tmpDirs) cleanup(d);
  });

  function freshRepo() {
    const d = initTestRepo();
    tmpDirs.push(d);
    return d;
  }

  // Test 1: Worktree lifecycle — create, verify, commit, remove
  it('worktree lifecycle: create, verify branch, commit, remove', async () => {
    const projectDir = freshRepo();
    const gitOps = new CleanGitOps(noopLogger);

    const worktreePath = path.join(projectDir, '.worktrees', 'group-a');
    const worktreeBranch = 'devshop/worktree-test/group-a';

    // Create worktree with new branch from session
    await gitOps.createWorktreeWithNewBranch(
      projectDir, worktreePath, worktreeBranch, 'devshop/session-test'
    );

    // Verify worktree directory exists
    assert.ok(fs.existsSync(worktreePath), 'worktree directory should exist');

    // Verify worktree is on the correct branch
    const branch = git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    assert.equal(branch, worktreeBranch);

    // Write a file and commit in the worktree
    fs.writeFileSync(path.join(worktreePath, 'src', 'feature-a.js'),
      'module.exports = { featureA: () => "a" };\n');
    git(worktreePath, ['add', '-A']);
    git(worktreePath, ['commit', '-m', 'feat: add feature-a']);

    // Verify commit exists in worktree
    const log = git(worktreePath, ['log', '--oneline', '-1']);
    assert.ok(log.includes('feat: add feature-a'));

    // Remove worktree
    await gitOps.removeWorktree(projectDir, worktreePath);

    // Verify directory is gone
    assert.ok(!fs.existsSync(worktreePath), 'worktree directory should be removed');

    // Verify worktree list no longer includes it
    const worktreeList = await gitOps.listWorktrees(projectDir);
    assert.ok(!worktreeList.includes(worktreePath),
      'worktree list should not include removed worktree');
  });

  // Test 2: Two worktrees merge to session without conflict
  it('two worktrees merge to session without conflict', async () => {
    const projectDir = freshRepo();
    const gitOps = new CleanGitOps(noopLogger);
    const mergeLock = new MergeLock();

    const worktreeA = path.join(projectDir, '.worktrees', 'group-a');
    const worktreeB = path.join(projectDir, '.worktrees', 'group-b');
    const branchA = 'devshop/worktree-test/group-a';
    const branchB = 'devshop/worktree-test/group-b';
    const sessionBranch = 'devshop/session-test';

    // Create two worktrees from session branch
    await gitOps.createWorktreeWithNewBranch(projectDir, worktreeA, branchA, sessionBranch);
    await gitOps.createWorktreeWithNewBranch(projectDir, worktreeB, branchB, sessionBranch);

    // In worktree A: create a work branch, write file, commit
    const workBranchA = 'devshop/work-test/feature-a';
    git(worktreeA, ['checkout', '-b', workBranchA]);
    fs.writeFileSync(path.join(worktreeA, 'src', 'feature-a.js'),
      'module.exports = { featureA: () => "a" };\n');
    git(worktreeA, ['add', '-A']);
    git(worktreeA, ['commit', '-m', 'feat: add feature-a']);

    // In worktree B: create a work branch, write different file, commit
    const workBranchB = 'devshop/work-test/feature-b';
    git(worktreeB, ['checkout', '-b', workBranchB]);
    fs.writeFileSync(path.join(worktreeB, 'src', 'feature-b.js'),
      'module.exports = { featureB: () => "b" };\n');
    git(worktreeB, ['add', '-A']);
    git(worktreeB, ['commit', '-m', 'feat: add feature-b']);

    // Merge chain for A (replicates _handleMergedItem L1061-1079):
    // 1. checkout worktree branch, merge work branch into it
    // 2. mergeToSession from main projectDir
    // 3. checkout worktree branch again, merge session back into worktree
    await mergeLock.withLock(async () => {
      git(worktreeA, ['checkout', branchA]);
      git(worktreeA, ['merge', '--no-ff', workBranchA, '-m', 'merge: feature-a work into worktree']);
      await gitOps.mergeToSession(projectDir, sessionBranch, branchA, 'merge: feature-a');
      git(worktreeA, ['checkout', branchA]);
      git(worktreeA, ['merge', sessionBranch]);
    });

    // Merge chain for B
    await mergeLock.withLock(async () => {
      git(worktreeB, ['checkout', branchB]);
      git(worktreeB, ['merge', '--no-ff', workBranchB, '-m', 'merge: feature-b work into worktree']);
      await gitOps.mergeToSession(projectDir, sessionBranch, branchB, 'merge: feature-b');
      git(worktreeB, ['checkout', branchB]);
      git(worktreeB, ['merge', sessionBranch]);
    });

    // Verify: checkout session branch in main repo and check both files exist
    git(projectDir, ['checkout', sessionBranch]);
    assert.ok(fs.existsSync(path.join(projectDir, 'src', 'feature-a.js')),
      'feature-a.js should exist on session branch');
    assert.ok(fs.existsSync(path.join(projectDir, 'src', 'feature-b.js')),
      'feature-b.js should exist on session branch');

    // Verify merge commits in log
    const log = git(projectDir, ['log', '--oneline']);
    assert.ok(log.includes('merge: feature-a'), 'log should contain feature-a merge');
    assert.ok(log.includes('merge: feature-b'), 'log should contain feature-b merge');

    // Cleanup worktrees
    await gitOps.removeWorktree(projectDir, worktreeA);
    await gitOps.removeWorktree(projectDir, worktreeB);
  });

  // Test 3: MergeLock serializes concurrent merges
  it('MergeLock serializes concurrent merges via Promise.all', async () => {
    const projectDir = freshRepo();
    const gitOps = new CleanGitOps(noopLogger);
    const mergeLock = new MergeLock();

    const worktreeA = path.join(projectDir, '.worktrees', 'group-a');
    const worktreeB = path.join(projectDir, '.worktrees', 'group-b');
    const branchA = 'devshop/worktree-test/group-a';
    const branchB = 'devshop/worktree-test/group-b';
    const sessionBranch = 'devshop/session-test';

    // Create worktrees
    await gitOps.createWorktreeWithNewBranch(projectDir, worktreeA, branchA, sessionBranch);
    await gitOps.createWorktreeWithNewBranch(projectDir, worktreeB, branchB, sessionBranch);

    // Create work in each worktree
    const workBranchA = 'devshop/work-test/concurrent-a';
    git(worktreeA, ['checkout', '-b', workBranchA]);
    fs.writeFileSync(path.join(worktreeA, 'src', 'concurrent-a.js'),
      'module.exports = { a: () => "a" };\n');
    git(worktreeA, ['add', '-A']);
    git(worktreeA, ['commit', '-m', 'feat: concurrent-a']);

    const workBranchB = 'devshop/work-test/concurrent-b';
    git(worktreeB, ['checkout', '-b', workBranchB]);
    fs.writeFileSync(path.join(worktreeB, 'src', 'concurrent-b.js'),
      'module.exports = { b: () => "b" };\n');
    git(worktreeB, ['add', '-A']);
    git(worktreeB, ['commit', '-m', 'feat: concurrent-b']);

    // Track merge order to verify serialization
    const mergeOrder = [];

    // Run both merge chains concurrently
    const mergeA = mergeLock.withLock(async () => {
      mergeOrder.push({ op: 'a-start', time: Date.now() });
      git(worktreeA, ['checkout', branchA]);
      git(worktreeA, ['merge', '--no-ff', workBranchA, '-m', 'merge: concurrent-a work into worktree']);
      await gitOps.mergeToSession(projectDir, sessionBranch, branchA, 'merge: concurrent-a');
      git(worktreeA, ['checkout', branchA]);
      git(worktreeA, ['merge', sessionBranch]);
      mergeOrder.push({ op: 'a-end', time: Date.now() });
    });

    const mergeB = mergeLock.withLock(async () => {
      mergeOrder.push({ op: 'b-start', time: Date.now() });
      git(worktreeB, ['checkout', branchB]);
      git(worktreeB, ['merge', '--no-ff', workBranchB, '-m', 'merge: concurrent-b work into worktree']);
      await gitOps.mergeToSession(projectDir, sessionBranch, branchB, 'merge: concurrent-b');
      git(worktreeB, ['checkout', branchB]);
      git(worktreeB, ['merge', sessionBranch]);
      mergeOrder.push({ op: 'b-end', time: Date.now() });
    });

    await Promise.all([mergeA, mergeB]);

    // Verify serialization: one merge completed before the other started
    assert.equal(mergeOrder.length, 4, 'should have 4 merge events');

    // The first merge must finish (end) before the second starts
    // Order should be: X-start, X-end, Y-start, Y-end
    const firstEnd = mergeOrder[1];
    const secondStart = mergeOrder[2];
    assert.ok(
      firstEnd.op.endsWith('-end') && secondStart.op.endsWith('-start'),
      `merges should be serialized: expected end then start, got ${firstEnd.op} then ${secondStart.op}`
    );
    assert.ok(firstEnd.time <= secondStart.time,
      'first merge should complete before second starts');

    // Verify both files on session branch
    git(projectDir, ['checkout', sessionBranch]);
    assert.ok(fs.existsSync(path.join(projectDir, 'src', 'concurrent-a.js')),
      'concurrent-a.js should exist on session branch');
    assert.ok(fs.existsSync(path.join(projectDir, 'src', 'concurrent-b.js')),
      'concurrent-b.js should exist on session branch');

    // Cleanup
    await gitOps.removeWorktree(projectDir, worktreeA);
    await gitOps.removeWorktree(projectDir, worktreeB);
  });

  // Test 4: Cleanup removes worktree and branches
  it('cleanup removes worktree directory and all branches', async () => {
    const projectDir = freshRepo();
    const gitOps = new CleanGitOps(noopLogger);

    const worktreePath = path.join(projectDir, '.worktrees', 'group-a');
    const worktreeBranch = 'devshop/worktree-test/group-a';
    const workBranch1 = 'devshop/work-test/req-1';
    const workBranch2 = 'devshop/work-test/req-2';

    // Create worktree
    await gitOps.createWorktreeWithNewBranch(
      projectDir, worktreePath, worktreeBranch, 'devshop/session-test'
    );

    // Create work branches (simulating microcycle creating work branches in worktree)
    git(worktreePath, ['checkout', '-b', workBranch1]);
    fs.writeFileSync(path.join(worktreePath, 'src', 'req1.js'), 'module.exports = 1;\n');
    git(worktreePath, ['add', '-A']);
    git(worktreePath, ['commit', '-m', 'feat: req-1']);

    // Switch back to worktree branch, create second work branch
    git(worktreePath, ['checkout', worktreeBranch]);
    git(worktreePath, ['checkout', '-b', workBranch2]);
    fs.writeFileSync(path.join(worktreePath, 'src', 'req2.js'), 'module.exports = 2;\n');
    git(worktreePath, ['add', '-A']);
    git(worktreePath, ['commit', '-m', 'feat: req-2']);

    // Verify branches exist before cleanup
    const branchesBefore = git(projectDir, ['branch', '--list']);
    assert.ok(branchesBefore.includes(worktreeBranch), 'worktree branch should exist');
    assert.ok(branchesBefore.includes(workBranch1), 'work branch 1 should exist');
    assert.ok(branchesBefore.includes(workBranch2), 'work branch 2 should exist');

    // Run cleanup sequence (replicates _executeGroup finally block L998-1019)
    // 1. Remove worktree
    await gitOps.removeWorktree(projectDir, worktreePath);

    // 2. Delete worktree branch
    git(projectDir, ['branch', '-D', worktreeBranch]);

    // 3. Delete work branches
    const workBranches = [workBranch1, workBranch2];
    for (const wb of workBranches) {
      git(projectDir, ['branch', '-D', wb]);
    }

    // Verify worktree directory is gone
    assert.ok(!fs.existsSync(worktreePath), 'worktree directory should be removed');

    // Verify all branches are gone
    const branchesAfter = git(projectDir, ['branch', '--list']);
    assert.ok(!branchesAfter.includes(worktreeBranch),
      'worktree branch should be deleted');
    assert.ok(!branchesAfter.includes(workBranch1),
      'work branch 1 should be deleted');
    assert.ok(!branchesAfter.includes(workBranch2),
      'work branch 2 should be deleted');

    // Verify session and main branches still exist
    assert.ok(branchesAfter.includes('devshop/session-test'),
      'session branch should still exist');
    assert.ok(branchesAfter.includes('main'),
      'main branch should still exist');
  });
});
