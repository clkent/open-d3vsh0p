const { execFile: exec } = require('../infra/exec-utils');

class GitOps {
  constructor(logger) {
    this.logger = logger;
  }

  async hasChanges(projectDir) {
    const { stdout } = await this._git(projectDir, ['status', '--porcelain']);
    return stdout.trim().length > 0;
  }

  async commitAll(projectDir, message) {
    const hasChanges = await this.hasChanges(projectDir);
    if (!hasChanges) {
      return null;
    }

    await this._git(projectDir, ['add', '-A']);
    await this._git(projectDir, ['commit', '-m', message]);
    const { stdout } = await this._git(projectDir, ['rev-parse', 'HEAD']);
    const sha = stdout.trim();
    await this.logger.logCommit(sha, message);
    return sha;
  }

  /**
   * Remove a git worktree.
   * @param {string} projectDir - Main project directory
   * @param {string} worktreePath - Path of the worktree to remove
   */
  async removeWorktree(projectDir, worktreePath) {
    try {
      await this._git(projectDir, ['worktree', 'remove', worktreePath, '--force']);
      await this.logger.log('info', 'worktree_removed', { path: worktreePath });
    } catch (err) {
      // If worktree is already gone, that's fine
      await this.logger.log('warn', 'worktree_remove_failed', {
        path: worktreePath,
        error: err.message
      });
    }
  }

  /**
   * List all worktrees with parsed structured data.
   * @param {string} projectDir - Main project directory
   * @returns {Array<{path: string, branch: string|null, commit: string|null}>}
   */
  async listWorktreesParsed(projectDir) {
    const { stdout } = await this._git(projectDir, ['worktree', 'list', '--porcelain']);
    if (!stdout.trim()) return [];

    const worktrees = [];
    let current = {};

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current);
        current = { path: line.slice('worktree '.length), branch: null, commit: null };
      } else if (line.startsWith('HEAD ')) {
        current.commit = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace('refs/heads/', '');
      } else if (line === 'detached') {
        current.branch = null;
      }
    }
    if (current.path) worktrees.push(current);

    return worktrees;
  }

  /**
   * Push a branch to the remote.
   * @param {string} projectDir - Project directory
   * @param {string} branchName - Branch to push
   */
  async pushBranch(projectDir, branchName) {
    await this._git(projectDir, ['push', '-u', 'origin', branchName], { timeout: 120000 });
    await this.logger.log('info', 'branch_pushed', { branch: branchName });
  }

  /**
   * Wait for CI checks to pass on a PR.
   * Runs `gh pr checks --watch --fail-fast` and returns the result.
   *
   * @param {string} projectDir
   * @param {string} prUrl - PR URL or number
   * @param {number} timeoutMs - Max time to wait (default: 10 minutes)
   * @returns {{ passed: boolean, failedChecks: string[] }}
   */
  async waitForChecks(projectDir, prUrl, timeoutMs = 600000) {
    try {
      await this._exec('gh', [
        'pr', 'checks', prUrl, '--watch', '--fail-fast'
      ], { cwd: projectDir, timeout: timeoutMs });
      return { passed: true, failedChecks: [] };
    } catch (err) {
      // Exit code 8 = checks still pending (timeout), exit code 1 = checks failed
      // Try to get failing check names from JSON output
      const failedChecks = [];
      try {
        const { stdout } = await this._exec('gh', [
          'pr', 'checks', prUrl, '--json', 'name,bucket', '--jq', '.[] | select(.bucket == "fail") | .name'
        ], { cwd: projectDir, timeout: 30000 });
        if (stdout.trim()) {
          failedChecks.push(...stdout.trim().split('\n'));
        }
      } catch {
        // Could not retrieve check names — continue with empty list
      }
      return { passed: false, failedChecks };
    }
  }

  /**
   * Consolidate completed work from session branch to main.
   * Pushes session branch, creates PR, waits for CI checks, then merges to main.
   *
   * @param {string} projectDir
   * @param {string} sessionBranch
   * @param {object} context - { sessionId, projectId, completed, parked, totalCostUsd, ciTimeoutMs }
   */
  async consolidateToMain(projectDir, sessionBranch, context) {
    const { sessionId, projectId, completed = [], parked = [], totalCostUsd, ciTimeoutMs } = context;

    // Check if session branch has commits ahead of main
    let logOutput;
    try {
      const { stdout } = await this._git(projectDir, ['log', '--oneline', `main..${sessionBranch}`]);
      logOutput = stdout.trim();
    } catch {
      logOutput = '';
    }

    if (!logOutput) {
      await this.logger.log('info', 'consolidate_no_new_work');
      return;
    }

    // Push session branch
    await this.pushBranch(projectDir, sessionBranch);

    // Build PR content
    const title = sessionId
      ? `chore(${projectId}): consolidate session ${sessionId}`
      : `chore(${projectId}): consolidate session work`;

    const bodyParts = ['## Session Summary'];
    if (completed.length > 0) {
      bodyParts.push(`**Completed:** ${completed.slice(0, 10).join(', ')}`);
    }
    if (parked.length > 0) {
      bodyParts.push(`**Parked:** ${parked.slice(0, 10).join(', ')}`);
    }
    if (totalCostUsd !== undefined) {
      bodyParts.push(`**Cost:** $${totalCostUsd.toFixed(2)}`);
    }
    bodyParts.push('', '\u{1F916} Generated with DevShop');
    const prBody = bodyParts.join('\n');

    const { stdout: prUrl } = await this._exec('gh', [
      'pr', 'create',
      '--base', 'main',
      '--head', sessionBranch,
      '--title', title,
      '--body', prBody
    ], { cwd: projectDir });

    const trimmedPrUrl = prUrl.trim();
    await this.logger.log('info', 'consolidate_pr_created', { pr: trimmedPrUrl });

    // Wait for CI checks to pass before merging
    const checkResult = await this.waitForChecks(projectDir, trimmedPrUrl, ciTimeoutMs);

    if (!checkResult.passed) {
      const checkNames = checkResult.failedChecks.length > 0
        ? ` Failing checks: ${checkResult.failedChecks.join(', ')}`
        : '';
      const message = `CI checks failed on ${trimmedPrUrl}. Fix in pair mode and merge manually.${checkNames}`;
      console.log(`  ${message}`);
      await this.logger.log('warn', 'consolidate_ci_failed', {
        pr: trimmedPrUrl,
        failedChecks: checkResult.failedChecks
      });
      return;
    }

    // Merge PR
    await this._exec('gh', ['pr', 'merge', '--merge', '--delete-branch'], { cwd: projectDir });

    // Update local main
    await this._git(projectDir, ['checkout', 'main']);
    await this._git(projectDir, ['pull', 'origin', 'main'], { timeout: 120000 });

    await this.logger.log('info', 'consolidate_merged');
  }

  async _exec(cmd, args, opts = {}) {
    return exec(cmd, args, { timeout: 180000, ...opts });
  }

  async _git(cwd, args, { timeout = 30000 } = {}) {
    try {
      return await exec('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout });
    } catch (err) {
      const message = err.stderr || err.message;
      throw new Error(`git ${args[0]} failed: ${message}`);
    }
  }
}

module.exports = { GitOps };
