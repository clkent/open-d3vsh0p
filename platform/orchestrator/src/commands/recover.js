const path = require('path');
const { GitOps } = require('../git/git-ops');
const { RecoveryManager } = require('../git/recovery-manager');

async function recoverCommand(project, config) {
  console.log('');
  console.log('=== Recovery ===');
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('');

  const logger = {
    log: async (level, event, data) => {
      if (event === 'recovery_cleanup') {
        const label = data.type === 'worktree' ? `worktree: ${data.path}`
          : data.type === 'branch' ? `branch: ${data.branch}`
          : `state: ${JSON.stringify(data.changes)}`;
        console.log(`  Cleaned up ${label}`);
      } else if (event === 'worktree_removed') {
        // suppress — already logged via recovery_cleanup
      } else if (level === 'warn') {
        console.log(`  Warning: ${event} — ${data?.error || ''}`);
      }
    },
    logCommit: async () => {},
    logMerge: async () => {}
  };

  const gitOps = new GitOps(logger);
  const orchestratorDir = path.join(config.activeAgentsDir, 'orchestrator');
  const stateFilePath = path.join(orchestratorDir, 'state.json');

  const recovery = new RecoveryManager({
    gitOps,
    logger,
    projectDir: config.projectDir,
    stateFilePath
  });

  const plan = await recovery.analyze();

  if (recovery.isEmpty(plan)) {
    console.log('  No orphaned resources found. Everything is clean.');
    console.log('');
    return 0;
  }

  // Display recovery plan
  if (plan.orphanedWorktrees.length > 0) {
    console.log(`  Orphaned worktrees (${plan.orphanedWorktrees.length}):`);
    for (const wt of plan.orphanedWorktrees) {
      console.log(`    - ${wt}`);
    }
    console.log('');
  }

  if (plan.staleBranches.length > 0) {
    console.log(`  Stale branches (${plan.staleBranches.length}):`);
    for (const branch of plan.staleBranches) {
      console.log(`    - ${branch}`);
    }
    console.log('');
  }

  if (plan.stateChanges) {
    console.log(`  State reconciliation:`);
    console.log(`    - Clear ${plan.stateChanges.agentCount} phantom active agent(s)`);
    if (plan.stateChanges.requirementIds.length > 0) {
      console.log(`    - Restore to pending: ${plan.stateChanges.requirementIds.join(', ')}`);
    }
    console.log('');
  }

  // Execute
  console.log('  Executing recovery...');
  await recovery.execute(plan);
  console.log('');
  console.log('  Recovery complete.');
  console.log('');
  return 0;
}

module.exports = { recoverCommand };
