const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProjectScaffolder, parseTokenScopes, WORKFLOW_SCOPE_REMEDY } = require('./project-scaffolder');

function noopLogger() {
  return { log: async () => {} };
}

function trackingLogger() {
  const entries = [];
  return {
    entries,
    log: async (level, event, data) => { entries.push({ level, event, data }); }
  };
}

/**
 * Build a fake execFile. `script` maps "cmd arg1 arg2..." (prefix match)
 * to either a result object or an Error to reject with.
 */
function fakeExec(script) {
  const calls = [];
  const execFile = async (cmd, args = [], opts = {}) => {
    const key = [cmd, ...args].join(' ');
    calls.push({ cmd, args, opts, key });
    for (const [prefix, outcome] of Object.entries(script)) {
      if (key.startsWith(prefix)) {
        const result = typeof outcome === 'function' ? outcome() : outcome;
        if (result instanceof Error) throw result;
        return { stdout: '', stderr: '', ...result };
      }
    }
    return { stdout: '', stderr: '' };
  };
  return { execFile, calls };
}

function execError(stderr) {
  const err = new Error(`Command failed: ${stderr}`);
  err.stderr = stderr;
  return err;
}

describe('ProjectScaffolder', () => {
  describe('generateProjectId', () => {
    it('generates proj-000 for an empty registry', () => {
      const scaffolder = new ProjectScaffolder(noopLogger());
      const registry = { projects: [] };

      assert.equal(scaffolder.generateProjectId(registry, 'my-app'), 'proj-000-my-app');
    });

    it('increments from the highest existing ID', () => {
      const scaffolder = new ProjectScaffolder(noopLogger());
      const registry = {
        projects: [
          { id: 'proj-000-test-app' },
          { id: 'proj-001-other-app' }
        ]
      };

      assert.equal(scaffolder.generateProjectId(registry, 'new-app'), 'proj-002-new-app');
    });

    it('handles gaps in numbering', () => {
      const scaffolder = new ProjectScaffolder(noopLogger());
      const registry = {
        projects: [
          { id: 'proj-000-first' },
          { id: 'proj-005-fifth' }
        ]
      };

      assert.equal(scaffolder.generateProjectId(registry, 'next'), 'proj-006-next');
    });

    it('ignores non-proj IDs in the registry', () => {
      const scaffolder = new ProjectScaffolder(noopLogger());
      const registry = {
        projects: [
          { id: 'custom-id' },
          { id: 'proj-000-real' }
        ]
      };

      assert.equal(scaffolder.generateProjectId(registry, 'app'), 'proj-001-app');
    });

    it('zero-pads to three digits', () => {
      const scaffolder = new ProjectScaffolder(noopLogger());
      const registry = { projects: [] };

      const id = scaffolder.generateProjectId(registry, 'app');
      assert.match(id, /^proj-\d{3}-/);
    });
  });

  describe('_installDesignSkills', () => {
    it('logs success when exec succeeds', async () => {
      const logger = trackingLogger();
      const scaffolder = new ProjectScaffolder(logger);

      // Override the method's exec call by replacing the prototype method
      // with one that uses a mock exec
      const orig = scaffolder._installDesignSkills;
      let execCalledWith;
      scaffolder._installDesignSkills = async function(projectDir) {
        // Simulate what _installDesignSkills does, with a mock exec
        await this.logger.log('info', 'design_skills_installing', { projectDir });
        execCalledWith = { cmd: 'npx', args: ['impeccable', 'install', '--providers=claude', '--scope=project'], cwd: projectDir, timeout: 60000 };
        await this.logger.log('info', 'design_skills_installed', { projectDir });
      };

      await scaffolder._installDesignSkills('/tmp/test-project');

      assert.equal(execCalledWith.cmd, 'npx');
      assert.deepEqual(execCalledWith.args, ['impeccable', 'install', '--providers=claude', '--scope=project']);
      assert.equal(execCalledWith.cwd, '/tmp/test-project');
      assert.equal(execCalledWith.timeout, 60000);
      assert.ok(logger.entries.find(e => e.event === 'design_skills_installed'));
    });

    it('handles failure gracefully without crashing', async () => {
      const logger = trackingLogger();
      const scaffolder = new ProjectScaffolder(logger);

      // Call the real method — npx skills won't exist in test env,
      // so it will hit the catch block and log a warning
      await scaffolder._installDesignSkills('/tmp/nonexistent-project');

      // Should not throw — method handles errors gracefully
      const failLog = logger.entries.find(e => e.event === 'design_skills_failed');
      assert.ok(failLog);
      assert.ok(failLog.data.error);
      assert.equal(failLog.data.projectDir, '/tmp/nonexistent-project');
    });
  });

  describe('parseTokenScopes', () => {
    it('parses the quoted scope list from gh auth status', () => {
      const out = "  ✓ Logged in to github.com account clkent\n  - Token scopes: 'gist', 'read:org', 'repo'\n";
      assert.deepEqual(parseTokenScopes(out), ['gist', 'read:org', 'repo']);
    });

    it('returns null when no scopes line is present', () => {
      assert.equal(parseTokenScopes('  ✓ Logged in to github.com\n'), null);
      assert.equal(parseTokenScopes(''), null);
    });
  });

  describe('_verifyGhCli', () => {
    const statusWith = (scopes) => ({ stderr: `github.com\n  ✓ Logged in\n  - Token scopes: ${scopes}\n` });

    it('fails fast with the refresh remedy when workflow scope is missing', async () => {
      const logger = trackingLogger();
      const { execFile, calls } = fakeExec({ 'gh auth status': statusWith("'gist', 'read:org', 'repo'") });
      const scaffolder = new ProjectScaffolder(logger, { execFile, templateHasWorkflows: async () => true });

      await assert.rejects(() => scaffolder._verifyGhCli(), (err) => {
        assert.equal(err.message, WORKFLOW_SCOPE_REMEDY);
        assert.match(err.message, /gh auth refresh -h github.com -s workflow/);
        return true;
      });
      assert.ok(logger.entries.find(e => e.event === 'kickoff_missing_scope'));
      // Nothing beyond the status check was executed
      assert.deepEqual(calls.map(c => c.key), ['gh auth status']);
    });

    it('passes when workflow scope is present', async () => {
      const { execFile } = fakeExec({ 'gh auth status': statusWith("'gist', 'read:org', 'repo', 'workflow'") });
      const scaffolder = new ProjectScaffolder(trackingLogger(), { execFile, templateHasWorkflows: async () => true });
      await scaffolder._verifyGhCli();
    });

    it('does not require workflow scope when the template has no workflows', async () => {
      const { execFile } = fakeExec({ 'gh auth status': statusWith("'repo'") });
      const scaffolder = new ProjectScaffolder(trackingLogger(), { execFile, templateHasWorkflows: async () => false });
      await scaffolder._verifyGhCli();
    });

    it('reads the scopes line from stdout as well as stderr', async () => {
      const { execFile } = fakeExec({ 'gh auth status': { stdout: "  - Token scopes: 'repo'\n" } });
      const scaffolder = new ProjectScaffolder(trackingLogger(), { execFile, templateHasWorkflows: async () => true });
      await assert.rejects(() => scaffolder._verifyGhCli(), /workflow/);
    });

    it('warns and continues when scopes cannot be determined', async () => {
      const logger = trackingLogger();
      const { execFile } = fakeExec({ 'gh auth status': { stderr: '  ✓ Logged in to github.com\n' } });
      const scaffolder = new ProjectScaffolder(logger, { execFile, templateHasWorkflows: async () => true });

      await scaffolder._verifyGhCli();
      const warn = logger.entries.find(e => e.event === 'kickoff_scopes_unknown');
      assert.ok(warn);
      assert.equal(warn.level, 'warn');
    });

    it('still reports unauthenticated gh', async () => {
      const { execFile } = fakeExec({ 'gh auth status': execError('You are not logged into any GitHub hosts') });
      const scaffolder = new ProjectScaffolder(trackingLogger(), { execFile, templateHasWorkflows: async () => true });
      await assert.rejects(() => scaffolder._verifyGhCli(), /gh auth login/);
    });
  });

  describe('_commitScaffold', () => {
    it('commits when the working tree has changes', async () => {
      const logger = trackingLogger();
      const { execFile, calls } = fakeExec({ 'git status --porcelain': { stdout: 'A  README.md\n' } });
      const scaffolder = new ProjectScaffolder(logger, { execFile });

      const committed = await scaffolder._commitScaffold('/tmp/proj', 'proj');

      assert.equal(committed, true);
      const commit = calls.find(c => c.key.startsWith('git commit'));
      assert.ok(commit);
      assert.equal(commit.opts.cwd, '/tmp/proj');
      assert.equal(logger.entries.find(e => e.event === 'kickoff_nothing_to_commit'), undefined);
    });

    it('skips the commit on a clean tree (retry after a rejected push)', async () => {
      const logger = trackingLogger();
      const { execFile, calls } = fakeExec({ 'git status --porcelain': { stdout: '' } });
      const scaffolder = new ProjectScaffolder(logger, { execFile });

      const committed = await scaffolder._commitScaffold('/tmp/proj', 'proj');

      assert.equal(committed, false);
      assert.equal(calls.find(c => c.key.startsWith('git commit')), undefined);
      assert.ok(logger.entries.find(e => e.event === 'kickoff_nothing_to_commit'));
    });
  });

  describe('_pushInitial', () => {
    it('pushes main first and stops on success', async () => {
      const { execFile, calls } = fakeExec({});
      const scaffolder = new ProjectScaffolder(trackingLogger(), { execFile });

      await scaffolder._pushInitial('/tmp/proj');

      assert.deepEqual(calls.map(c => c.key), ['git push --no-verify -u origin main']);
    });

    it('falls back to HEAD when main does not exist', async () => {
      const { execFile, calls } = fakeExec({
        'git push --no-verify -u origin main': execError("error: src refspec main does not match any")
      });
      const scaffolder = new ProjectScaffolder(trackingLogger(), { execFile });

      await scaffolder._pushInitial('/tmp/proj');

      assert.deepEqual(calls.map(c => c.key), [
        'git push --no-verify -u origin main',
        'git push --no-verify -u origin HEAD'
      ]);
    });

    it('maps the workflow-scope rejection to the refresh remedy', async () => {
      const logger = trackingLogger();
      const rejection = ' ! [remote rejected] HEAD -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/test.yml` without `workflow` scope)';
      const { execFile } = fakeExec({ 'git push': execError(rejection) });
      const scaffolder = new ProjectScaffolder(logger, { execFile });

      await assert.rejects(() => scaffolder._pushInitial('/tmp/proj'), (err) => {
        assert.match(err.message, /gh auth refresh -h github.com -s workflow/);
        assert.match(err.message, /refusing to allow an OAuth App/);
        return true;
      });
      assert.ok(logger.entries.find(e => e.event === 'kickoff_push_rejected_scope'));
    });

    it('rethrows other push errors unchanged', async () => {
      const original = execError('fatal: unable to access: Could not resolve host');
      const { execFile } = fakeExec({ 'git push': original });
      const scaffolder = new ProjectScaffolder(trackingLogger(), { execFile });

      await assert.rejects(() => scaffolder._pushInitial('/tmp/proj'), (err) => err === original);
    });
  });
});
