const { execFile: exec } = require('../infra/exec-utils');

class GitOps {
  constructor(logger) {
    this.logger = logger;
  }

  async getCurrentBranch(projectDir) {
    const { stdout } = await this._git(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
  }

  async createSessionBranch(projectDir, branchName) {
    // Recover from a previous crashed session that left the repo mid-merge
    try {
      await this._git(projectDir, ['merge', '--abort']);
      await this.logger.log('warn', 'aborted_stale_merge', { projectDir });
    } catch {
      // No merge in progress — expected
    }

    // Discard any uncommitted changes from a crashed session
    try {
      await this._git(projectDir, ['checkout', '.']);
      await this._git(projectDir, ['clean', '-fd']);
    } catch {
      // Best effort cleanup
    }

    // Ensure we're on main first and pull latest
    await this._git(projectDir, ['checkout', 'main']);
    await this._git(projectDir, ['pull', 'origin', 'main'], { timeout: 120000 });
    await this._git(projectDir, ['checkout', '-b', branchName]);
    await this.logger.log('info', 'branch_created', { branch: branchName, from: 'main' });
    return branchName;
  }

  async createWorkBranch(projectDir, sessionBranch, requirementId) {
    // Use a parallel path instead of nesting under session branch
    // (git can't create foo/bar/baz if foo/bar already exists as a branch)
    const sessionSuffix = sessionBranch.replace('devshop/session-', '');
    const workBranch = `devshop/work-${sessionSuffix}/${requirementId}`;
    await this._git(projectDir, ['checkout', sessionBranch]);

    // Delete stale work branch from a previous failed attempt
    if (await this.branchExists(projectDir, workBranch)) {
      await this._git(projectDir, ['branch', '-D', workBranch]);
      await this.logger.log('info', 'stale_branch_deleted', { branch: workBranch });
    }

    await this._git(projectDir, ['checkout', '-b', workBranch]);
    await this.logger.log('info', 'branch_created', { branch: workBranch, from: sessionBranch });
    return workBranch;
  }

  async checkoutBranch(projectDir, branchName) {
    await this._git(projectDir, ['checkout', branchName]);
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

  async mergeWorkToSession(projectDir, sessionBranch, workBranch, requirementId) {
    await this._git(projectDir, ['checkout', sessionBranch]);
    await this._git(projectDir, ['merge', '--no-ff', workBranch, '-m', `merge: ${requirementId}`]);
    await this.logger.logMerge(requirementId, sessionBranch);
  }

  async getDiff(projectDir, baseBranch) {
    try {
      const { stdout } = await this._git(projectDir, ['diff', `${baseBranch}...HEAD`]);
      return stdout;
    } catch {
      // If diff fails (e.g., no common ancestor), fall back to simple diff
      const { stdout } = await this._git(projectDir, ['diff', baseBranch]);
      return stdout;
    }
  }

  async getDiffStat(projectDir, baseBranch) {
    try {
      const { stdout } = await this._git(projectDir, ['diff', '--stat', `${baseBranch}...HEAD`]);
      return stdout;
    } catch {
      return '';
    }
  }

  async getBranchDiff(projectDir, branchName, maxBytes = 8192) {
    let diffStat = '';
    let diff = '';

    try {
      const statResult = await this._git(projectDir, ['diff', '--stat', `main...${branchName}`]);
      diffStat = statResult.stdout.trim();
    } catch {
      // Branch may not exist or have no common ancestor
    }

    try {
      const diffResult = await this._git(projectDir, ['diff', `main...${branchName}`]);
      diff = diffResult.stdout;
      if (diff.length > maxBytes) {
        diff = diff.slice(0, maxBytes) + '\n... [truncated at ' + maxBytes + ' bytes]';
      }
    } catch {
      // Branch may not exist or have no common ancestor
    }

    return { diffStat, diff };
  }

  async getLog(projectDir, baseBranch) {
    try {
      const { stdout } = await this._git(projectDir, [
        'log', '--oneline', `${baseBranch}..HEAD`
      ]);
      return stdout;
    } catch {
      return '';
    }
  }

  async branchExists(projectDir, branchName) {
    try {
      await this._git(projectDir, ['rev-parse', '--verify', branchName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a git worktree for parallel development.
   * @param {string} projectDir - Main project directory
   * @param {string} worktreePath - Path for the new worktree
   * @param {string} branchName - Branch to checkout in the worktree
   * @returns {string} The worktree path
   */
  async createWorktree(projectDir, worktreePath, branchName) {
    // Create the worktree from the specified branch
    await this._git(projectDir, ['worktree', 'add', worktreePath, branchName]);
    await this.logger.log('info', 'worktree_created', { path: worktreePath, branch: branchName });
    return worktreePath;
  }

  /**
   * Create a worktree with a new branch based on a source branch.
   * @param {string} projectDir - Main project directory
   * @param {string} worktreePath - Path for the new worktree
   * @param {string} newBranch - New branch name to create
   * @param {string} sourceBranch - Branch to base the new branch on
   * @returns {string} The worktree path
   */
  async createWorktreeWithNewBranch(projectDir, worktreePath, newBranch, sourceBranch) {
    await this._git(projectDir, ['worktree', 'add', '-b', newBranch, worktreePath, sourceBranch]);
    await this.logger.log('info', 'worktree_created', {
      path: worktreePath,
      branch: newBranch,
      from: sourceBranch
    });
    return worktreePath;
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
   * List all worktrees.
   * @param {string} projectDir - Main project directory
   * @returns {string} Worktree list output
   */
  async listWorktrees(projectDir) {
    const { stdout } = await this._git(projectDir, ['worktree', 'list']);
    return stdout;
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
   * Merge a branch into the session branch from the main project dir.
   * Used after worktree work is complete and worktree is removed.
   */
  async mergeToSession(projectDir, sessionBranch, sourceBranch, commitMessage) {
    await this._git(projectDir, ['checkout', sessionBranch]);
    await this._git(projectDir, ['merge', '--no-ff', sourceBranch, '-m', commitMessage]);
    await this.logger.log('info', 'merged', { branch: sourceBranch, target: sessionBranch });
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

  async ensureWorktreeIgnored(projectDir) {
    const fs = require('fs/promises');
    const gitignorePath = require('path').join(projectDir, '.gitignore');

    let content;
    try {
      content = await fs.readFile(gitignorePath, 'utf-8');
    } catch {
      // No .gitignore — create one
      await fs.writeFile(gitignorePath, '.worktrees\n');
      return;
    }

    const lines = content.split('\n');
    if (lines.some(line => line.trim() === '.worktrees')) return;

    const suffix = content.endsWith('\n') ? '' : '\n';
    await fs.writeFile(gitignorePath, content + suffix + '.worktrees\n');
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
