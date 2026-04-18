const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { RecoveryManager } = require('./recovery-manager');
const { recoverCommand } = require('../commands/recover');

describe('RecoveryManager', () => {
  let rm;
  let gitOps;
  let gitCalls;
  let logEntries;
  let logger;
  let tmpDir;
  let stateFilePath;

  beforeEach(async () => {
    gitCalls = [];
    logEntries = [];

    logger = {
      log: async (level, event, data) => { logEntries.push({ level, event, data }); }
    };

    gitOps = {
      _git: async (cwd, args) => {
        gitCalls.push({ cwd, args });
        if (gitOps._gitResults && gitOps._gitResults.length > 0) {
          const next = gitOps._gitResults.shift();
          if (next instanceof Error) throw next;
          return next;
        }
        return { stdout: '', stderr: '' };
      },
      _gitResults: [],
      listWorktreesParsed: async (projectDir) => {
        return gitOps._worktrees || [];
      },
      removeWorktree: async (projectDir, wtPath) => {
        gitCalls.push({ cwd: projectDir, args: ['worktree', 'remove', wtPath, '--force'] });
      }
    };

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-test-'));
    stateFilePath = path.join(tmpDir, 'state.json');

    rm = new RecoveryManager({
      gitOps,
      logger,
      projectDir: '/proj',
      stateFilePath
    });
  });

  describe('analyze - orphaned worktrees', () => {
    it('detects worktrees under .worktrees/', async () => {
      gitOps._worktrees = [
        { path: '/proj', branch: 'main', commit: 'abc' },
        { path: '/proj/.worktrees/group-a', branch: 'devshop/worktree-old/group-a', commit: 'def' }
      ];

      const plan = await rm.analyze();
      assert.deepEqual(plan.orphanedWorktrees, ['/proj/.worktrees/group-a']);
    });

    it('returns empty when no worktrees under .worktrees/', async () => {
      gitOps._worktrees = [
        { path: '/proj', branch: 'main', commit: 'abc' }
      ];

      const plan = await rm.analyze();
      assert.deepEqual(plan.orphanedWorktrees, []);
    });

    it('ignores non-DevShop worktrees', async () => {
      gitOps._worktrees = [
        { path: '/proj', branch: 'main', commit: 'abc' },
        { path: '/other/worktree', branch: 'feature', commit: 'def' }
      ];

      const plan = await rm.analyze();
      assert.deepEqual(plan.orphanedWorktrees, []);
    });

    it('detects stale worktree directories git does not track', async () => {
      // Use tmpDir as projectDir so we can create real directories
      const rmLocal = new RecoveryManager({
        gitOps,
        logger,
        projectDir: tmpDir,
        stateFilePath
      });

      // git knows about no worktrees
      gitOps._worktrees = [
        { path: tmpDir, branch: 'main', commit: 'abc' }
      ];
      gitOps._gitResults = [{ stdout: '', stderr: '' }];

      // But a stale directory exists on disk
      const worktreesDir = path.join(tmpDir, '.worktrees');
      await fs.mkdir(path.join(worktreesDir, 'group-a'), { recursive: true });

      const plan = await rmLocal.analyze();
      assert.equal(plan.orphanedWorktrees.length, 1);
      assert.ok(plan.orphanedWorktrees[0].endsWith('.worktrees/group-a'));
    });
  });

  describe('analyze - stale branches', () => {
    it('detects devshop/* branches from old sessions', async () => {
      gitOps._gitResults = [{
        stdout: '  devshop/session-old-session\n  devshop/work-old-session/req-1\n',
        stderr: ''
      }];

      const plan = await rm.analyze('current-session');
      assert.deepEqual(plan.staleBranches, [
        'devshop/session-old-session',
        'devshop/work-old-session/req-1'
      ]);
    });

    it('preserves current session branches', async () => {
      gitOps._gitResults = [{
        stdout: '  devshop/session-my-session\n  devshop/work-my-session/req-1\n  devshop/worktree-my-session/group-a\n',
        stderr: ''
      }];

      const plan = await rm.analyze('my-session');
      assert.deepEqual(plan.staleBranches, []);
    });

    it('ignores non-devshop branches', async () => {
      gitOps._gitResults = [{ stdout: '', stderr: '' }];
      const plan = await rm.analyze();
      assert.deepEqual(plan.staleBranches, []);
    });
  });

  describe('analyze - state reconciliation', () => {
    it('detects active agents in state', async () => {
      await fs.writeFile(stateFilePath, JSON.stringify({
        activeAgents: [
          { persona: 'jordan', requirementId: 'req-1' },
          { persona: 'alex', requirementId: 'req-2' }
        ],
        requirements: { pending: [], completed: [], parked: [] }
      }));

      // Provide git branch result for stale branch detection
      gitOps._gitResults = [{ stdout: '', stderr: '' }];

      const plan = await rm.analyze();
      assert.ok(plan.stateChanges);
      assert.equal(plan.stateChanges.clearActiveAgents, true);
      assert.equal(plan.stateChanges.agentCount, 2);
      assert.deepEqual(plan.stateChanges.requirementIds, ['req-1', 'req-2']);
    });

    it('returns null when state is clean', async () => {
      await fs.writeFile(stateFilePath, JSON.stringify({
        activeAgents: [],
        requirements: { pending: [], completed: [], parked: [] }
      }));

      gitOps._gitResults = [{ stdout: '', stderr: '' }];

      const plan = await rm.analyze();
      assert.equal(plan.stateChanges, null);
    });

    it('returns null when no state file exists', async () => {
      gitOps._gitResults = [{ stdout: '', stderr: '' }];

      const plan = await rm.analyze();
      assert.equal(plan.stateChanges, null);
    });
  });

  describe('execute', () => {
    it('removes orphaned worktrees', async () => {
      const plan = {
        orphanedWorktrees: ['/proj/.worktrees/group-a'],
        staleBranches: [],
        stateChanges: null
      };

      await rm.execute(plan);
      const removeCall = gitCalls.find(c => c.args.includes('worktree'));
      assert.ok(removeCall);
      assert.ok(logEntries.find(e => e.event === 'recovery_cleanup' && e.data.type === 'worktree'));
    });

    it('falls back to rm when git worktree remove fails', async () => {
      // Use tmpDir as projectDir
      const rmLocal = new RecoveryManager({
        gitOps: {
          ...gitOps,
          removeWorktree: async () => { throw new Error('not a worktree'); },
          _git: async (cwd, args) => {
            gitCalls.push({ cwd, args });
            return { stdout: '', stderr: '' };
          }
        },
        logger,
        projectDir: tmpDir,
        stateFilePath
      });

      // Create a stale directory
      const staleDir = path.join(tmpDir, '.worktrees', 'group-a');
      await fs.mkdir(staleDir, { recursive: true });
      await fs.writeFile(path.join(staleDir, 'dummy.txt'), 'stale');

      const plan = {
        orphanedWorktrees: [staleDir],
        staleBranches: [],
        stateChanges: null
      };

      await rmLocal.execute(plan);

      // Directory should be gone
      try {
        await fs.access(staleDir);
        assert.fail('directory should have been removed');
      } catch (err) {
        assert.equal(err.code, 'ENOENT');
      }

      // Should have called worktree prune
      const pruneCall = gitCalls.find(c => c.args.includes('prune'));
      assert.ok(pruneCall);

      // Should log cleanup
      assert.ok(logEntries.find(e => e.event === 'recovery_cleanup' && e.data.type === 'worktree_dir'));
    });

    it('deletes stale branches', async () => {
      const plan = {
        orphanedWorktrees: [],
        staleBranches: ['devshop/session-old'],
        stateChanges: null
      };

      await rm.execute(plan);
      const deleteCall = gitCalls.find(c => c.args.includes('branch'));
      assert.ok(deleteCall);
      assert.deepEqual(deleteCall.args, ['branch', '-D', 'devshop/session-old']);
      assert.ok(logEntries.find(e => e.event === 'recovery_cleanup' && e.data.type === 'branch'));
    });

    it('reconciles state - clears agents and restores pending', async () => {
      await fs.writeFile(stateFilePath, JSON.stringify({
        activeAgents: [
          { persona: 'jordan', requirementId: 'req-1' }
        ],
        requirements: { pending: ['req-2'], completed: ['req-3'], parked: [] }
      }));

      const plan = {
        orphanedWorktrees: [],
        staleBranches: [],
        stateChanges: { clearActiveAgents: true, agentCount: 1, requirementIds: ['req-1'] }
      };

      await rm.execute(plan);

      const raw = await fs.readFile(stateFilePath, 'utf-8');
      const state = JSON.parse(raw);
      assert.deepEqual(state.activeAgents, []);
      assert.ok(state.requirements.pending.includes('req-1'));
      assert.ok(state.requirements.pending.includes('req-2'));
      assert.ok(logEntries.find(e => e.event === 'recovery_cleanup' && e.data.type === 'state'));
    });

    it('does not re-add completed requirements to pending', async () => {
      await fs.writeFile(stateFilePath, JSON.stringify({
        activeAgents: [
          { persona: 'jordan', requirementId: 'req-done' }
        ],
        requirements: { pending: [], completed: ['req-done'], parked: [] }
      }));

      const plan = {
        orphanedWorktrees: [],
        staleBranches: [],
        stateChanges: { clearActiveAgents: true, agentCount: 1, requirementIds: ['req-done'] }
      };

      await rm.execute(plan);

      const raw = await fs.readFile(stateFilePath, 'utf-8');
      const state = JSON.parse(raw);
      assert.deepEqual(state.activeAgents, []);
      assert.ok(!state.requirements.pending.includes('req-done'));
    });
  });

  describe('isEmpty', () => {
    it('returns true for clean plan', () => {
      assert.equal(rm.isEmpty({
        orphanedWorktrees: [], staleBranches: [], stateChanges: null
      }), true);
    });

    it('returns false when orphaned worktrees exist', () => {
      assert.equal(rm.isEmpty({
        orphanedWorktrees: ['/proj/.worktrees/group-a'], staleBranches: [], stateChanges: null
      }), false);
    });

    it('returns false when stale branches exist', () => {
      assert.equal(rm.isEmpty({
        orphanedWorktrees: [], staleBranches: ['devshop/old'], stateChanges: null
      }), false);
    });

    it('returns false when state changes needed', () => {
      assert.equal(rm.isEmpty({
        orphanedWorktrees: [], staleBranches: [], stateChanges: { clearActiveAgents: true }
      }), false);
    });
  });

  describe('integration: analyze + execute full cycle', () => {
    it('detects and cleans up orphans in a single flow', async () => {
      // Set up orphaned worktree
      gitOps._worktrees = [
        { path: '/proj', branch: 'main', commit: 'abc' },
        { path: '/proj/.worktrees/group-a', branch: 'devshop/worktree-old/group-a', commit: 'def' }
      ];
      // Set up stale branch
      gitOps._gitResults = [
        { stdout: '  devshop/session-old\n', stderr: '' }
      ];
      // Set up dirty state
      await fs.writeFile(stateFilePath, JSON.stringify({
        activeAgents: [{ persona: 'jordan', requirementId: 'req-1' }],
        requirements: { pending: [], completed: [], parked: [] }
      }));

      const plan = await rm.analyze('current');
      assert.equal(plan.orphanedWorktrees.length, 1);
      assert.equal(plan.staleBranches.length, 1);
      assert.ok(plan.stateChanges);

      await rm.execute(plan);

      // Verify state was cleaned
      const raw = await fs.readFile(stateFilePath, 'utf-8');
      const state = JSON.parse(raw);
      assert.deepEqual(state.activeAgents, []);
      assert.ok(state.requirements.pending.includes('req-1'));

      // Verify logging
      const cleanupLogs = logEntries.filter(e => e.event === 'recovery_cleanup');
      assert.equal(cleanupLogs.length, 3); // worktree + branch + state
    });
  });
});

describe('recoverCommand', () => {
  let tmpDir;
  let consoleOutput;
  let originalLog;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recover-cmd-'));
    consoleOutput = [];
    originalLog = console.log;
    console.log = (...args) => { consoleOutput.push(args.join(' ')); };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('prints header with project name when invoked', async () => {
    const project = { name: 'Test', id: 'proj-001-test' };
    const config = {
      projectDir: tmpDir,
      activeAgentsDir: tmpDir
    };

    // Create the orchestrator dir so state file lookup doesn't fail
    await fs.mkdir(path.join(tmpDir, 'orchestrator'), { recursive: true });

    // recoverCommand will fail on git ops (no real repo), but should print the header first
    try {
      await recoverCommand(project, config);
    } catch {
      // Expected — not a real git repo
    }

    // Verify the header line includes the project name
    const headerLine = consoleOutput.find(line => line.includes('Test'));
    assert.ok(headerLine, 'should print header containing project name "Test"');
    assert.ok(consoleOutput.some(line => line.includes('Recovery') || line.includes('recover')),
      'should print a line mentioning recovery');
  });
});
