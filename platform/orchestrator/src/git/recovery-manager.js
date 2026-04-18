const path = require('path');
const fs = require('fs/promises');

class RecoveryManager {
  constructor({ gitOps, logger, projectDir, stateFilePath }) {
    this.gitOps = gitOps;
    this.logger = logger;
    this.projectDir = projectDir;
    this.stateFilePath = stateFilePath;
  }

  /**
   * Analyze the project for orphaned resources and inconsistent state.
   * Returns a recovery plan without performing any cleanup.
   */
  async analyze(currentSessionId = null) {
    const orphanedWorktrees = await this._findOrphanedWorktrees();
    const staleBranches = await this._findStaleBranches(currentSessionId);
    const stateChanges = await this._findStateChanges();

    return { orphanedWorktrees, staleBranches, stateChanges };
  }

  /**
   * Execute a recovery plan, cleaning up orphaned resources.
   */
  async execute(plan) {
    for (const wtPath of plan.orphanedWorktrees) {
      try {
        await this.gitOps.removeWorktree(this.projectDir, wtPath);
        await this.logger.log('info', 'recovery_cleanup', {
          type: 'worktree',
          path: wtPath
        });
      } catch {
        // git worktree remove failed — directory may exist without git tracking it
        try {
          await fs.rm(wtPath, { recursive: true, force: true });
          await this.gitOps._git(this.projectDir, ['worktree', 'prune']);
          await this.logger.log('info', 'recovery_cleanup', {
            type: 'worktree_dir',
            path: wtPath
          });
        } catch (rmErr) {
          await this.logger.log('warn', 'recovery_cleanup_failed', {
            type: 'worktree',
            path: wtPath,
            error: rmErr.message
          });
        }
      }
    }

    for (const branch of plan.staleBranches) {
      try {
        await this.gitOps._git(this.projectDir, ['branch', '-D', branch]);
        await this.logger.log('info', 'recovery_cleanup', {
          type: 'branch',
          branch
        });
      } catch (err) {
        await this.logger.log('warn', 'recovery_cleanup_failed', {
          type: 'branch',
          branch,
          error: err.message
        });
      }
    }

    if (plan.stateChanges) {
      try {
        const raw = await fs.readFile(this.stateFilePath, 'utf-8');
        const state = JSON.parse(raw);

        // Move active agent requirement IDs back to pending
        const completed = new Set(state.requirements.completed || []);
        const parkedIds = new Set((state.requirements.parked || []).map(p => typeof p === 'string' ? p : p.id));

        for (const agent of (state.activeAgents || [])) {
          const reqId = agent.requirementId;
          if (reqId && !completed.has(reqId) && !parkedIds.has(reqId)) {
            if (!state.requirements.pending.includes(reqId)) {
              state.requirements.pending.push(reqId);
            }
          }
        }

        state.activeAgents = [];
        state.updatedAt = new Date().toISOString();

        await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2));
        await this.logger.log('info', 'recovery_cleanup', {
          type: 'state',
          changes: plan.stateChanges
        });
      } catch (err) {
        await this.logger.log('warn', 'recovery_cleanup_failed', {
          type: 'state',
          error: err.message
        });
      }
    }
  }

  /**
   * Check if the plan has any actions to perform.
   */
  isEmpty(plan) {
    return (
      plan.orphanedWorktrees.length === 0 &&
      plan.staleBranches.length === 0 &&
      !plan.stateChanges
    );
  }

  async _findOrphanedWorktrees() {
    const worktrees = await this.gitOps.listWorktreesParsed(this.projectDir);
    const worktreesDir = path.join(this.projectDir, '.worktrees');

    // Find worktrees git knows about (use Set to prevent duplicates)
    const orphaned = new Set(
      worktrees
        .filter(wt => wt.path.startsWith(worktreesDir))
        .map(wt => wt.path)
    );

    // Also find stale directories git doesn't know about
    // (left behind when git worktree add fails or remove fails)
    try {
      const entries = await fs.readdir(worktreesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          orphaned.add(path.join(worktreesDir, entry.name));
        }
      }
    } catch {
      // .worktrees dir doesn't exist — no orphans
    }

    return Array.from(orphaned);
  }

  async _findStaleBranches(currentSessionId) {
    let stdout;
    try {
      const result = await this.gitOps._git(this.projectDir, ['branch', '--list', 'devshop/*']);
      stdout = result.stdout;
    } catch {
      return [];
    }

    if (!stdout.trim()) return [];

    const branches = stdout.split('\n')
      .map(line => line.replace(/^\*?\s+/, '').trim())
      .filter(b => b.length > 0);

    // Keep branches belonging to the current session
    const currentPrefix = currentSessionId
      ? `devshop/session-${currentSessionId}`
      : null;
    const currentWorkPrefix = currentSessionId
      ? `devshop/work-${currentSessionId}`
      : null;
    const currentWorktreePrefix = currentSessionId
      ? `devshop/worktree-${currentSessionId}`
      : null;

    return branches.filter(branch => {
      if (!branch.startsWith('devshop/')) return false;
      if (currentPrefix && branch === currentPrefix) return false;
      if (currentWorkPrefix && branch.startsWith(currentWorkPrefix + '/')) return false;
      if (currentWorktreePrefix && branch.startsWith(currentWorktreePrefix + '/')) return false;
      return true;
    });
  }

  async _findStateChanges() {
    try {
      const raw = await fs.readFile(this.stateFilePath, 'utf-8');
      const state = JSON.parse(raw);

      if (state.activeAgents && state.activeAgents.length > 0) {
        return {
          clearActiveAgents: true,
          agentCount: state.activeAgents.length,
          requirementIds: state.activeAgents
            .map(a => a.requirementId)
            .filter(Boolean)
        };
      }
    } catch {
      // No state file or can't parse — nothing to reconcile
    }
    return null;
  }
}

module.exports = { RecoveryManager };
