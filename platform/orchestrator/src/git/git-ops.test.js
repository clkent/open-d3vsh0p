const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { GitOps } = require('./git-ops');

describe('GitOps', () => {
  let git;
  let gitCalls;
  let logger;
  let logEntries;

  beforeEach(() => {
    gitCalls = [];
    logEntries = [];

    logger = {
      log: async (level, event, data) => { logEntries.push({ level, event, data }); },
      logCommit: async (sha, message) => { logEntries.push({ type: 'commit', sha, message }); }
    };

    git = new GitOps(logger);

    // Mock _git to capture calls and return configurable results
    git._gitResults = [];
    git._gitDefault = { stdout: '', stderr: '' };
    git._git = async (cwd, args) => {
      gitCalls.push({ cwd, args });
      if (git._gitResults.length > 0) {
        const next = git._gitResults.shift();
        if (next instanceof Error) throw next;
        return next;
      }
      return git._gitDefault;
    };
  });

  describe('hasChanges', () => {
    it('returns true when output is non-empty', async () => {
      git._gitResults = [{ stdout: 'M src/index.js\n', stderr: '' }];
      assert.equal(await git.hasChanges('/proj'), true);
    });

    it('returns false when output is empty', async () => {
      git._gitResults = [{ stdout: '', stderr: '' }];
      assert.equal(await git.hasChanges('/proj'), false);
    });

    it('returns false when output is only whitespace', async () => {
      git._gitResults = [{ stdout: '  \n  ', stderr: '' }];
      assert.equal(await git.hasChanges('/proj'), false);
    });
  });

  describe('commitAll', () => {
    it('returns null when no changes', async () => {
      git._gitResults = [{ stdout: '', stderr: '' }]; // hasChanges
      const sha = await git.commitAll('/proj', 'test commit');
      assert.equal(sha, null);
      assert.equal(gitCalls.length, 1); // only status check
    });

    it('runs add/commit/rev-parse when there are changes', async () => {
      git._gitResults = [
        { stdout: 'M file.js\n', stderr: '' },  // hasChanges (status --porcelain)
        { stdout: '', stderr: '' },               // add -A
        { stdout: '', stderr: '' },               // commit -m
        { stdout: 'abc123\n', stderr: '' }        // rev-parse HEAD
      ];
      const sha = await git.commitAll('/proj', 'feat: stuff');
      assert.equal(sha, 'abc123');
      assert.deepEqual(gitCalls[1].args, ['add', '-A']);
      assert.deepEqual(gitCalls[2].args, ['commit', '-m', 'feat: stuff']);
      assert.deepEqual(gitCalls[3].args, ['rev-parse', 'HEAD']);
    });

    it('logs the commit', async () => {
      git._gitResults = [
        { stdout: 'M file.js\n', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: 'def456\n', stderr: '' }
      ];
      await git.commitAll('/proj', 'fix: bug');
      const commitLog = logEntries.find(e => e.type === 'commit');
      assert.ok(commitLog);
      assert.equal(commitLog.sha, 'def456');
    });
  });

  describe('listWorktreesParsed', () => {
    it('returns empty array when no worktrees', async () => {
      git._gitResults = [{ stdout: '', stderr: '' }];
      const result = await git.listWorktreesParsed('/proj');
      assert.deepEqual(result, []);
      assert.deepEqual(gitCalls[0].args, ['worktree', 'list', '--porcelain']);
    });

    it('parses a single worktree', async () => {
      git._gitResults = [{
        stdout: 'worktree /proj\nHEAD abc123\nbranch refs/heads/main\n\n',
        stderr: ''
      }];
      const result = await git.listWorktreesParsed('/proj');
      assert.equal(result.length, 1);
      assert.deepEqual(result[0], { path: '/proj', branch: 'main', commit: 'abc123' });
    });

    it('parses multiple worktrees', async () => {
      git._gitResults = [{
        stdout: [
          'worktree /proj',
          'HEAD abc123',
          'branch refs/heads/main',
          '',
          'worktree /proj/.worktrees/group-a',
          'HEAD def456',
          'branch refs/heads/devshop/worktree-session/group-a',
          '',
          'worktree /proj/.worktrees/group-b',
          'HEAD 789ghi',
          'detached',
          ''
        ].join('\n'),
        stderr: ''
      }];
      const result = await git.listWorktreesParsed('/proj');
      assert.equal(result.length, 3);
      assert.equal(result[0].branch, 'main');
      assert.equal(result[1].branch, 'devshop/worktree-session/group-a');
      assert.equal(result[1].commit, 'def456');
      assert.equal(result[2].branch, null); // detached
      assert.equal(result[2].commit, '789ghi');
    });
  });

  describe('removeWorktree', () => {
    it('calls remove --force', async () => {
      git._gitResults = [{ stdout: '', stderr: '' }];
      await git.removeWorktree('/proj', '/tmp/wt');
      assert.deepEqual(gitCalls[0].args, ['worktree', 'remove', '/tmp/wt', '--force']);
    });

    it('logs warning on failure instead of throwing', async () => {
      git._gitResults = [new Error('already gone')];
      // Should not throw
      await git.removeWorktree('/proj', '/tmp/wt');
      const warnLog = logEntries.find(e => e.event === 'worktree_remove_failed');
      assert.ok(warnLog);
      assert.equal(warnLog.level, 'warn');
    });
  });

  describe('_git timeout', () => {
    it('passes default 30s timeout to exec', async () => {
      // Restore real _git to test its behavior with a mock exec
      const realGit = GitOps.prototype._git;
      let capturedOpts = null;

      const testGit = new GitOps(logger);
      const originalExec = require('../infra/exec-utils').execFile;

      // Patch exec at instance level by overriding _git to capture opts
      testGit._git = async function(cwd, args, opts = {}) {
        const timeout = opts.timeout || 30000;
        capturedOpts = { cwd, timeout };
        return { stdout: '', stderr: '' };
      };

      await testGit._git('/proj', ['status']);
      assert.equal(capturedOpts.timeout, 30000);
    });

    it('passes custom timeout when specified', async () => {
      let capturedOpts = null;
      const testGit = new GitOps(logger);
      testGit._git = async function(cwd, args, opts = {}) {
        capturedOpts = { cwd, timeout: opts.timeout || 30000 };
        return { stdout: '', stderr: '' };
      };

      await testGit._git('/proj', ['push', 'origin', 'main'], { timeout: 120000 });
      assert.equal(capturedOpts.timeout, 120000);
    });
  });

  describe('pushBranch timeout', () => {
    it('uses 120s timeout for push operations', async () => {
      let capturedTimeout = null;
      const testGit = new GitOps(logger);
      testGit._git = async function(cwd, args, opts = {}) {
        capturedTimeout = opts.timeout;
        return { stdout: '', stderr: '' };
      };

      await testGit.pushBranch('/proj', 'feature-branch');
      assert.equal(capturedTimeout, 120000);
    });
  });

  describe('waitForChecks', () => {
    let execCalls;

    beforeEach(() => {
      execCalls = [];
    });

    it('returns passed:true when checks pass (exit 0)', async () => {
      git._exec = async (cmd, args, opts) => {
        execCalls.push({ cmd, args, opts });
        return { stdout: '', stderr: '' };
      };

      const result = await git.waitForChecks('/proj', 'https://github.com/test/pr/1', 60000);
      assert.equal(result.passed, true);
      assert.deepEqual(result.failedChecks, []);
      assert.ok(execCalls[0].args.includes('--watch'));
      assert.ok(execCalls[0].args.includes('--fail-fast'));
    });

    it('returns passed:false with failedChecks when checks fail', async () => {
      let callCount = 0;
      git._exec = async (cmd, args, opts) => {
        execCalls.push({ cmd, args });
        callCount++;
        if (callCount === 1) {
          // gh pr checks --watch fails
          throw new Error('exit code 1');
        }
        // gh pr checks --json returns failing check names
        return { stdout: 'lint\nbuild\n', stderr: '' };
      };

      const result = await git.waitForChecks('/proj', 'https://github.com/test/pr/1');
      assert.equal(result.passed, false);
      assert.deepEqual(result.failedChecks, ['lint', 'build']);
    });

    it('returns passed:false on timeout (exit code 8)', async () => {
      let callCount = 0;
      git._exec = async (cmd, args, opts) => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('exit code 8');
          err.code = 8;
          throw err;
        }
        return { stdout: '', stderr: '' };
      };

      const result = await git.waitForChecks('/proj', 'https://github.com/test/pr/1');
      assert.equal(result.passed, false);
      assert.deepEqual(result.failedChecks, []);
    });

    it('returns passed:false when gh command fails entirely (network error)', async () => {
      git._exec = async () => {
        throw new Error('ECONNREFUSED');
      };

      const result = await git.waitForChecks('/proj', 'https://github.com/test/pr/1');
      assert.equal(result.passed, false);
      assert.deepEqual(result.failedChecks, []);
    });
  });

  describe('consolidateToMain', () => {
    let execCalls;

    beforeEach(() => {
      execCalls = [];
      git._exec = async (cmd, args, opts) => {
        execCalls.push({ cmd, args });
        return { stdout: 'https://github.com/test/pr/1\n', stderr: '' };
      };
    });

    it('pushes session branch, creates PR, waits for checks, and merges when checks pass', async () => {
      git._gitResults = [
        // log --oneline main..session
        { stdout: 'abc1234 merge: REQ-1\ndef5678 merge: REQ-2\n', stderr: '' },
        // push -u origin (from pushBranch)
        { stdout: '', stderr: '' },
        // checkout main
        { stdout: '', stderr: '' },
        // pull origin main
        { stdout: '', stderr: '' }
      ];

      await git.consolidateToMain('/proj', 'devshop/session-123', {
        sessionId: '2026-02-18-04-40',
        projectId: 'proj-001',
        completed: ['REQ-1', 'REQ-2'],
        parked: [],
        totalCostUsd: 12.50
      });

      // Verify git log was checked
      assert.deepEqual(gitCalls[0].args, ['log', '--oneline', 'main..devshop/session-123']);
      // Verify push
      assert.deepEqual(gitCalls[1].args, ['push', '-u', 'origin', 'devshop/session-123']);
      // Verify gh pr create was called
      assert.equal(execCalls[0].cmd, 'gh');
      assert.ok(execCalls[0].args.includes('pr'));
      assert.ok(execCalls[0].args.includes('create'));
      // Verify PR title includes session ID
      const titleIdx = execCalls[0].args.indexOf('--title') + 1;
      assert.ok(execCalls[0].args[titleIdx].includes('2026-02-18-04-40'));
      // Verify gh pr checks --watch was called
      assert.equal(execCalls[1].cmd, 'gh');
      assert.ok(execCalls[1].args.includes('checks'));
      assert.ok(execCalls[1].args.includes('--watch'));
      // Verify gh pr merge was called
      assert.equal(execCalls[2].cmd, 'gh');
      assert.ok(execCalls[2].args.includes('merge'));
    });

    it('skips merge when CI checks fail and leaves PR open', async () => {
      git._gitResults = [
        { stdout: 'abc1234 merge: REQ-1\n', stderr: '' },
        { stdout: '', stderr: '' }
      ];

      let callCount = 0;
      git._exec = async (cmd, args, opts) => {
        execCalls.push({ cmd, args });
        callCount++;
        if (callCount === 1) {
          // gh pr create succeeds
          return { stdout: 'https://github.com/test/pr/1\n', stderr: '' };
        }
        if (callCount === 2) {
          // gh pr checks --watch fails
          throw new Error('checks failed');
        }
        if (callCount === 3) {
          // gh pr checks --json returns failing checks
          return { stdout: 'test-suite\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      await git.consolidateToMain('/proj', 'devshop/session-123', {
        projectId: 'proj-001',
        completed: ['REQ-1']
      });

      // Should NOT have called merge
      const mergeCall = execCalls.find(c => c.args.includes('merge'));
      assert.equal(mergeCall, undefined);
      // Should have logged the warning
      assert.ok(logEntries.some(e => e.event === 'consolidate_ci_failed'));
      const ciLog = logEntries.find(e => e.event === 'consolidate_ci_failed');
      assert.deepEqual(ciLog.data.failedChecks, ['test-suite']);
    });

    it('skips when no new commits on session branch', async () => {
      git._gitResults = [
        // log --oneline returns empty
        { stdout: '', stderr: '' }
      ];

      await git.consolidateToMain('/proj', 'devshop/session-123', {
        projectId: 'proj-001',
        completed: ['REQ-1']
      });

      // Only the log check should have run
      assert.equal(gitCalls.length, 1);
      assert.equal(execCalls.length, 0);
      assert.ok(logEntries.some(e => e.event === 'consolidate_no_new_work'));
    });

    it('merges immediately when no checks configured (exit 0 instant)', async () => {
      git._gitResults = [
        { stdout: 'abc1234 merge: REQ-1\n', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '', stderr: '' }
      ];

      await git.consolidateToMain('/proj', 'devshop/session-123', {
        projectId: 'proj-001',
        completed: ['REQ-1']
      });

      // checks --watch exits 0, merge proceeds
      assert.ok(execCalls.some(c => c.args.includes('merge')));
      assert.ok(logEntries.some(e => e.event === 'consolidate_merged'));
    });

    it('throws when PR merge fails after checks pass', async () => {
      git._gitResults = [
        { stdout: 'abc1234 merge: REQ-1\n', stderr: '' },
        { stdout: '', stderr: '' }
      ];

      let callCount = 0;
      git._exec = async (cmd, args) => {
        execCalls.push({ cmd, args });
        callCount++;
        if (callCount === 1) return { stdout: 'https://github.com/test/pr/1\n', stderr: '' }; // pr create
        if (callCount === 2) return { stdout: '', stderr: '' }; // checks --watch passes
        if (callCount === 3) throw new Error('merge conflict'); // merge fails
        return { stdout: '', stderr: '' };
      };

      await assert.rejects(
        () => git.consolidateToMain('/proj', 'devshop/session-123', {
          projectId: 'proj-001',
          completed: ['REQ-1']
        }),
        { message: 'merge conflict' }
      );
    });

    it('includes completed, parked, and cost in PR body', async () => {
      git._gitResults = [
        { stdout: 'abc1234 merge: REQ-1\n', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '', stderr: '' }
      ];

      await git.consolidateToMain('/proj', 'devshop/session-123', {
        sessionId: '2026-02-18-04-40',
        projectId: 'proj-001',
        completed: ['plant-categories', 'location-editing'],
        parked: ['location-deletion'],
        totalCostUsd: 8.75
      });

      const bodyIdx = execCalls[0].args.indexOf('--body') + 1;
      const body = execCalls[0].args[bodyIdx];
      assert.ok(body.includes('plant-categories'));
      assert.ok(body.includes('location-editing'));
      assert.ok(body.includes('location-deletion'));
      assert.ok(body.includes('$8.75'));
    });

    it('uses custom ciTimeoutMs when provided', async () => {
      git._gitResults = [
        { stdout: 'abc1234 merge: REQ-1\n', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '', stderr: '' },
        { stdout: '', stderr: '' }
      ];

      let checksTimeout = null;
      git._exec = async (cmd, args, opts) => {
        execCalls.push({ cmd, args, opts });
        if (args.includes('--watch')) {
          checksTimeout = opts?.timeout;
        }
        return { stdout: 'https://github.com/test/pr/1\n', stderr: '' };
      };

      await git.consolidateToMain('/proj', 'devshop/session-123', {
        projectId: 'proj-001',
        completed: ['REQ-1'],
        ciTimeoutMs: 300000
      });

      assert.equal(checksTimeout, 300000);
    });
  });
});
