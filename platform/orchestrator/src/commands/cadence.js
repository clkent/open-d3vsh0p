const path = require('path');
const fs = require('fs/promises');
const { SessionAggregator } = require('../api/session-aggregator');
const { GitHubNotifier } = require('../runners/github-notifier');
const { resolveScheduleConfig } = require('../scheduler/window-config');
const { RoadmapReader } = require('../roadmap/roadmap-reader');
const { execFile: exec } = require('../infra/exec-utils');
const { getOrchestratorPaths } = require('../session/path-utils');

async function cadenceCommand(project, config, subcommand, options = {}) {
  switch (subcommand) {
    case 'run':
      return await handleRun(project, config, options);

    case 'status':
      return await handleStatus(project, config);

    default:
      console.error(`Unknown cadence subcommand: ${subcommand}`);
      console.error('Available: run, status');
      return 1;
  }
}

async function handleRun(project, config, options) {
  const cadenceType = options.type;

  if (!cadenceType || !['weekly', 'monthly'].includes(cadenceType)) {
    console.error('Error: --type must be "weekly" or "monthly"');
    return 1;
  }

  console.log('');
  console.log(`=== Cadence: ${cadenceType} ===`);
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('========================');
  console.log('');

  const schedule = await resolveScheduleConfig(project);
  const notifier = new GitHubNotifier(project.projectDir, project.name);
  const { logsDir: logDir } = getOrchestratorPaths(config);

  if (cadenceType === 'weekly') {
    return await runWeekly(project, config, logDir, notifier, options.dryRun);
  } else {
    return await runMonthly(project, config, logDir, notifier);
  }
}

async function runWeekly(project, config, logDir, notifier, dryRun) {
  const report = { branches: { merged: 0, abandoned: 0, details: [] }, worktrees: { pruned: 0 } };

  // Task 1: Stale branch cleanup
  console.log('  Task: Stale branch cleanup');
  try {
    const branchResult = await cleanStaleBranches(project, dryRun);
    report.branches = branchResult;
    console.log(`    Merged removed: ${branchResult.merged}`);
    console.log(`    Abandoned removed: ${branchResult.abandoned}`);
  } catch (err) {
    console.log(`    Error: ${err.message}`);
  }

  // Task 2: Dead worktree removal
  console.log('  Task: Dead worktree removal');
  try {
    const worktreeResult = await cleanDeadWorktrees(project, dryRun);
    report.worktrees = worktreeResult;
    console.log(`    Pruned: ${worktreeResult.pruned}`);
  } catch (err) {
    console.log(`    Error: ${err.message}`);
  }

  // Report via GitHub Issue
  if (!dryRun) {
    await notifier.postWeeklyReport(report);
  }

  // Save cadence status
  await saveCadenceStatus(logDir, 'weekly', report);

  console.log('');
  console.log('  Weekly cadence complete.');
  console.log('');
  return 0;
}

async function runMonthly(project, config, logDir, notifier) {
  const report = { cost: null, archived: { count: 0, items: [] } };

  // Task 1: Archive stale parked items
  console.log('  Task: Archive parked items (inactive >30d)');
  try {
    const aggregator = new SessionAggregator(logDir);
    const staleItems = await aggregator.findStaleParkedItems(30);

    if (staleItems.length > 0) {
      const roadmapReader = new RoadmapReader(project.projectDir);
      const hasRoadmap = await roadmapReader.exists();

      if (hasRoadmap) {
        for (const itemId of staleItems) {
          await roadmapReader._updateItemStatus(itemId, '-');
          console.log(`    Archived: ${itemId}`);
        }
      }

      report.archived = { count: staleItems.length, items: staleItems };
    } else {
      console.log('    No stale parked items found.');
    }
  } catch (err) {
    console.log(`    Error: ${err.message}`);
  }

  // Task 2: Cost review
  console.log('  Task: Monthly cost review');
  try {
    const aggregator = new SessionAggregator(logDir);
    const costReport = await aggregator.generateMonthlyCostReport();
    report.cost = costReport.cost;

    console.log(`    Total cost: $${costReport.cost.totalCost.toFixed(2)}`);
    console.log(`    Sessions: ${costReport.cost.sessionCount}`);
    console.log(`    Avg cost/session: $${costReport.cost.avgCostPerSession.toFixed(2)}`);

    if (costReport.cost.monthOverMonthChange !== null) {
      const change = costReport.cost.monthOverMonthChange;
      console.log(`    Month-over-month: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`);

      if (change > 50) {
        console.log('    !! Cost increase >50% — review recommended');
      }
    }
  } catch (err) {
    console.log(`    Error: ${err.message}`);
  }

  // Report via GitHub Issue
  await notifier.postMonthlyReport(report);

  // Save cadence status
  await saveCadenceStatus(logDir, 'monthly', report);

  console.log('');
  console.log('  Monthly cadence complete.');
  console.log('');
  return 0;
}

async function cleanStaleBranches(project, dryRun) {
  const projectDir = project.projectDir;
  const result = { merged: 0, abandoned: 0, details: [] };
  const PROTECTED = ['main', 'master'];

  try {
    // Get current branch
    const { stdout: currentBranch } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectDir });
    PROTECTED.push(currentBranch.trim());

    // Get all local devshop branches
    const { stdout: branchList } = await exec('git', [
      'for-each-ref', '--format=%(refname:short) %(committerdate:unix)',
      'refs/heads/devshop/'
    ], { cwd: projectDir });

    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
    const FOURTEEN_DAYS = 14 * 24 * 3600 * 1000;

    const lines = branchList.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const [branch, timestampStr] = line.split(' ');
      if (!branch) continue;
      if (PROTECTED.includes(branch)) continue;

      // Don't prune the lastSessionId branch
      if (project.lastSessionId && branch.includes(project.lastSessionId)) continue;

      const lastCommitMs = parseInt(timestampStr, 10) * 1000;
      const age = now - lastCommitMs;

      // Check if merged to main
      let isMerged = false;
      try {
        const { stdout: mergedBranches } = await exec('git', [
          'branch', '--merged', 'main'
        ], { cwd: projectDir });
        isMerged = mergedBranches.split('\n').some(b => b.trim() === branch);
      } catch {
        // Can't determine merge status
      }

      if (isMerged && age > SEVEN_DAYS) {
        if (!dryRun) {
          try {
            await exec('git', ['branch', '-d', branch], { cwd: projectDir });
            // Also try to delete remote
            try {
              await exec('git', ['push', 'origin', '--delete', branch], { cwd: projectDir });
            } catch {
              // Remote delete may fail, that's ok
            }
          } catch {
            continue;
          }
        }
        result.merged++;
        result.details.push({ name: branch, reason: `merged, ${Math.floor(age / 86400000)}d old` });
      } else if (!isMerged && age > FOURTEEN_DAYS) {
        if (!dryRun) {
          try {
            await exec('git', ['branch', '-D', branch], { cwd: projectDir });
            try {
              await exec('git', ['push', 'origin', '--delete', branch], { cwd: projectDir });
            } catch {
              // Remote delete may fail
            }
          } catch {
            continue;
          }
        }
        result.abandoned++;
        result.details.push({ name: branch, reason: `abandoned, ${Math.floor(age / 86400000)}d no commits` });
      }
    }
  } catch (err) {
    // Project may not be a git repo or branches may not exist
    console.log(`    Note: ${err.message}`);
  }

  return result;
}

async function cleanDeadWorktrees(project, dryRun) {
  const result = { pruned: 0 };

  try {
    if (!dryRun) {
      const { stdout } = await exec('git', ['worktree', 'prune', '--verbose'], { cwd: project.projectDir });
      const lines = stdout.trim().split('\n').filter(Boolean);
      result.pruned = lines.length;
    } else {
      const { stdout } = await exec('git', ['worktree', 'list'], { cwd: project.projectDir });
      // Just report what exists
      const lines = stdout.trim().split('\n').filter(Boolean);
      result.pruned = Math.max(0, lines.length - 1); // Subtract main worktree
    }
  } catch (err) {
    console.log(`    Note: ${err.message}`);
  }

  return result;
}

async function saveCadenceStatus(logDir, type, report) {
  const statusPath = path.join(logDir, `cadence-${type}-status.json`);
  const status = {
    type,
    lastRunAt: new Date().toISOString(),
    report
  };

  try {
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(statusPath, JSON.stringify(status, null, 2));
  } catch {
    // Non-fatal
  }
}

async function handleStatus(project, config) {
  const { logsDir: logDir } = getOrchestratorPaths(config);

  console.log('');
  console.log(`Cadence status for ${project.name} (${project.id})`);
  console.log('');

  for (const type of ['weekly', 'monthly']) {
    const statusPath = path.join(logDir, `cadence-${type}-status.json`);
    try {
      const raw = await fs.readFile(statusPath, 'utf-8');
      const status = JSON.parse(raw);
      console.log(`  ${type}:`);
      console.log(`    Last run: ${status.lastRunAt}`);

      if (type === 'weekly' && status.report?.branches) {
        console.log(`    Branches cleaned: ${(status.report.branches.merged || 0) + (status.report.branches.abandoned || 0)}`);
        console.log(`    Worktrees pruned: ${status.report.worktrees?.pruned || 0}`);
      }

      if (type === 'monthly' && status.report?.cost) {
        console.log(`    Cost: $${(status.report.cost.totalCost || 0).toFixed(2)}`);
        console.log(`    Archived items: ${status.report.archived?.count || 0}`);
      }
    } catch {
      console.log(`  ${type}: never run`);
    }
  }

  console.log('');
  return 0;
}

module.exports = { cadenceCommand };
