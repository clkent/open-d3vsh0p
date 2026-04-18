const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { auditRoadmapCompletions } = require('./run');

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
