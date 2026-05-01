const path = require('path');
const fs = require('fs/promises');
const { RoadmapReader } = require('../roadmap/roadmap-reader');
const { ParallelOrchestrator } = require('../parallel-orchestrator');
const { GitOps } = require('../git/git-ops');
const { resolveScheduleConfig, getWindowConfig, computeWindowEndTimeMs, VALID_WINDOWS } = require('../scheduler/window-config');
const { CostEstimator } = require('../session/cost-estimator');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');

const LOCK_FILE_NAME = 'run.lock';

async function runCommand(project, config, registry, saveRegistry) {
  const windowName = config.window;

  // If --window is specified, apply window-aware overrides
  if (windowName) {
    if (!VALID_WINDOWS.includes(windowName)) {
      console.error(`Unknown window: ${windowName}`);
      console.error(`Available windows: ${VALID_WINDOWS.join(', ')}`);
      return 1;
    }

    const schedule = await resolveScheduleConfig(project);
    const winConfig = getWindowConfig(schedule, windowName);

    if (!winConfig || !winConfig.enabled) {
      console.error(`Window "${windowName}" is not enabled for project ${project.id}`);
      return 1;
    }

    // Morning window triggers digest, not a run
    if (windowName === 'morning' || winConfig.action === 'digest') {
      return await handleMorningDigest(project, config);
    }

    // Tech debt window runs security + PE instead of normal run
    if (windowName === 'techdebt') {
      return await handleTechDebt(project, config);
    }

    // Apply window budget/time unless CLI explicitly overrode
    const cliUsedDefaultBudget = config.budgetLimitUsd === 30;
    const cliUsedDefaultTime = config.timeLimitMs === 7 * 3600000;

    if (cliUsedDefaultBudget && winConfig.budgetUsd) {
      config.budgetLimitUsd = winConfig.budgetUsd;
    }

    if (cliUsedDefaultTime && winConfig.timeLimitHours) {
      config.timeLimitMs = winConfig.timeLimitHours * 3600000;
    }

    // Set window end time for consumption monitoring
    config.windowEndTimeMs = computeWindowEndTimeMs(winConfig.endHour);
  }

  // Acquire run lock
  const lockPath = path.join(config.activeAgentsDir, 'orchestrator', LOCK_FILE_NAME);
  const lockAcquired = await acquireRunLock(lockPath);
  if (!lockAcquired) {
    console.error('Another scheduled run is already in progress for this project.');
    console.error(`Lock file: ${lockPath}`);
    return 1;
  }

  try {
    return await executeRun(project, config, registry, saveRegistry, windowName);
  } finally {
    await releaseRunLock(lockPath);
  }
}

async function executeRun(project, config, registry, saveRegistry, windowName) {
  const roadmapReader = new RoadmapReader(config.projectDir);
  const hasRoadmap = await roadmapReader.exists();

  if (!hasRoadmap) {
    console.error('  No roadmap.md found. Create one with `devshop kickoff` first.');
    return 1;
  }

  const mode = 'parallel';

  // Print session header
  console.log('');
  console.log('=== DevShop Orchestrator ===');
  console.log(`  Project:    ${project.name} (${project.id})`);
  console.log(`  Directory:  ${project.projectDir}`);
  console.log(`  Mode:       ${mode}`);
  console.log(`  Budget:     $${config.budgetLimitUsd.toFixed(2)}`);
  console.log(`  Time limit: ${(config.timeLimitMs / 3600000).toFixed(1)}h`);
  if (windowName) {
    console.log(`  Window:     ${windowName}`);
    if (config.windowEndTimeMs) {
      const endTime = new Date(config.windowEndTimeMs);
      console.log(`  Window end: ${endTime.toLocaleTimeString()}`);
    }
  }
  if (config.requirements) {
    console.log(`  Targets:    ${config.requirements.join(', ')}`);
  }
  if (config.resume) {
    console.log(`  Resume:     yes`);
  }

  // Show estimated cost from historical data
  try {
    const { logsDir } = getOrchestratorPaths(config);
    const costEstimator = new CostEstimator(logsDir);
    await costEstimator.init();

    if (costEstimator.sessionCount >= 1) {
      const roadmapReader = new RoadmapReader(config.projectDir);
      const roadmap = await roadmapReader.parse();
      const pendingCount = roadmapReader.getAllItems(roadmap)
        .filter(i => i.status === 'pending').length;

      if (pendingCount > 0) {
        const prediction = costEstimator.predictSufficiency(
          config.budgetLimitUsd,
          pendingCount
        );
        console.log(`  Estimate:   $${prediction.estimatedCost.toFixed(2)} (${pendingCount} pending, confidence: ${prediction.confidence})`);
      }
    }
  } catch {
    // Non-fatal — skip estimate display
  }

  console.log('============================');
  console.log('');

  let orchestrator = new ParallelOrchestrator(config);

  let result = await orchestrator.run();

  // Handle auto-restart after successful blocking fix
  while (result && result.restart) {
    console.log('');
    console.log('  === Auto-restarting after blocking fix ===');
    console.log('');
    config.fresh = true;
    const freshOrchestrator = new ParallelOrchestrator(config);
    result = await freshOrchestrator.run();
  }

  // Early exit — no session was created
  if (!result || result.stopReason === 'no_pending_work') {
    return 0;
  }

  // Print session summary
  console.log('');
  console.log('=== Session Complete ===');
  console.log(`  Stop reason: ${result.stopReason}`);
  console.log(`  Completed:   ${result.completed.length} requirements`);
  console.log(`  Parked:      ${result.parked.length} requirements`);
  console.log(`  Remaining:   ${result.remaining.length} requirements`);
  console.log(`  Total cost:  $${result.totalCostUsd.toFixed(2)}`);
  console.log(`  Branch:      ${result.sessionBranch}`);
  console.log(`  Log:         ${result.logFile}`);
  console.log('========================');
  console.log('');

  // Surface incomplete HUMAN-tagged roadmap items and runtime-discovered interventions
  if (hasRoadmap) {
    const roadmap = await roadmapReader.parse();
    const humanItems = roadmapReader.getAllItems(roadmap)
      .filter(i => i.isHuman && i.status !== 'complete');

    // Separate pre-planned vs runtime-discovered interventions
    const parkedEntries = result.parked || [];
    const runtimeInterventions = parkedEntries.filter(p => p.intervention);

    if (humanItems.length > 0 || runtimeInterventions.length > 0) {
      console.log('=== Action Required ===');

      // Pre-planned [HUMAN] items (excluding runtime-discovered ones to avoid duplication)
      const runtimeIds = new Set(runtimeInterventions.map(r => r.id));
      const prePlanned = humanItems.filter(i => !runtimeIds.has(i.id));
      for (const item of prePlanned) {
        const cleanDesc = item.description.replace(/\s*\[HUMAN\]\s*/g, '').trim();
        console.log(`  Phase ${item.phaseNumber}: \`${item.id}\` — ${cleanDesc}`);
      }

      // Runtime-discovered interventions with structured instructions
      if (runtimeInterventions.length > 0) {
        if (prePlanned.length > 0) console.log('');
        console.log('--- Discovered During This Session ---');
        for (const entry of runtimeInterventions) {
          const instr = entry.intervention;
          console.log(`  \`${entry.id}\` — ${instr.title} [${instr.category}]`);
          for (let i = 0; i < instr.steps.length; i++) {
            console.log(`    ${i + 1}. ${instr.steps[i]}`);
          }
          if (instr.verifyCommand) {
            console.log(`    Verify: ${instr.verifyCommand}`);
          }
          console.log('');
        }
      }

      console.log(`  Run: ./devshop action ${config.projectId}`);
      console.log('=======================');
      console.log('');
    }
  }

  // Update registry with last session
  project.lastSessionId = path.basename(result.logFile, '-summary.json');
  await saveRegistry(registry);

  // Post-run digest if running in a window
  if (windowName) {
    await postRunDigest(project, config, result, windowName);
  }

  // Auto-consolidate session branch to main
  if (result.completed.length > 0 && !config.noConsolidate) {
    try {
      const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
      const gitOps = new GitOps(logger);
      const sessionId = path.basename(result.logFile, '-summary.json');
      await gitOps.consolidateToMain(config.projectDir, result.sessionBranch, {
        sessionId,
        projectId: config.projectId,
        completed: result.completed,
        parked: result.parked,
        totalCostUsd: result.totalCostUsd
      });
      console.log('  Session branch consolidated to main.');

      // Post-consolidation roadmap audit
      try {
        const auditResult = await auditRoadmapCompletions(config.projectDir);
        if (auditResult.reconciled > 0) {
          console.log(`  Roadmap audit: marked ${auditResult.reconciled} items complete (${auditResult.items.join(', ')})`);
        }
      } catch (auditErr) {
        console.log(`  ~ [audit] Roadmap audit failed: ${auditErr.message}`);
      }
    } catch (err) {
      console.log(`  Auto-consolidation failed: ${err.message}`);
      console.log(`  Branch ${result.sessionBranch} was pushed — merge manually.`);
    }
  }

  return result.parked.length > 0 ? 1 : 0;
}

async function handleMorningDigest(project, config) {
  console.log('');
  console.log('=== Morning Digest ===');
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('======================');
  console.log('');

  const { SessionAggregator } = require('../api/session-aggregator');
  const { GitHubNotifier } = require('../runners/github-notifier');

  const { logsDir: logDir } = getOrchestratorPaths(config);
  const aggregator = new SessionAggregator(logDir);
  const summary = await aggregator.getMostRecentSummary();

  if (!summary) {
    console.log('  No recent session found for digest.');
    return 0;
  }

  summary.window = 'morning-digest';

  const notifier = new GitHubNotifier(project.projectDir, project.name);
  const issueNumber = await notifier.postDailyDigest(summary);

  if (issueNumber) {
    console.log(`  Daily digest posted as Issue #${issueNumber}`);
  }

  return 0;
}

async function handleTechDebt(project, config) {
  const lockPath = path.join(config.activeAgentsDir, 'orchestrator', LOCK_FILE_NAME);
  const lockAcquired = await acquireRunLock(lockPath);
  if (!lockAcquired) {
    console.error('Another run is already in progress for this project.');
    return 1;
  }

  try {
    const { TechDebtRunner } = require('../runners/tech-debt-runner');
    const { loadConfig } = require('../infra/config');
    const fullConfig = await loadConfig(config);
    const runner = new TechDebtRunner({ ...fullConfig, ...config });
    const result = await runner.run();

    // Post tech debt results to daily digest
    const { GitHubNotifier } = require('../runners/github-notifier');
    const notifier = new GitHubNotifier(project.projectDir, project.name);

    const digestSummary = {
      sessionId: generateSessionId('techdebt'),
      window: 'techdebt',
      totalCostUsd: result.totalCost,
      agentInvocations: 2,
      results: {
        completed: [],
        parked: [],
        remaining: []
      },
      stopReason: 'tech_debt_complete'
    };

    // Add security findings summary
    if (result.securityResult?.output) {
      digestSummary.securityFindings = result.securityResult.output.substring(0, 2000);
    }

    await notifier.postDailyDigest(digestSummary);

    return 0;
  } finally {
    await releaseRunLock(lockPath);
  }
}

async function postRunDigest(project, config, result, windowName) {
  try {
    const { GitHubNotifier } = require('../runners/github-notifier');
    const notifier = new GitHubNotifier(project.projectDir, project.name);

    const summary = {
      sessionId: path.basename(result.logFile, '-summary.json'),
      window: windowName,
      totalCostUsd: result.totalCostUsd,
      agentInvocations: result.agentInvocations || 0,
      sessionBranch: result.sessionBranch,
      results: {
        completed: result.completed,
        parked: result.parked,
        remaining: result.remaining
      },
      stopReason: result.stopReason,
      preview: result.preview || undefined
    };

    await notifier.postDailyDigest(summary);
  } catch (err) {
    console.log(`  ~ [digest] Failed to post digest: ${err.message}`);
  }
}

async function acquireRunLock(lockPath) {
  const lockDir = path.dirname(lockPath);
  await fs.mkdir(lockDir, { recursive: true });

  try {
    // Check if lock file exists and if process is still running
    const content = await fs.readFile(lockPath, 'utf-8');
    const pid = parseInt(content.trim(), 10);

    if (pid && isProcessRunning(pid)) {
      return false;
    }

    // Stale lock, remove it
  } catch {
    // No lock file exists
  }

  // Write our PID
  await fs.writeFile(lockPath, String(process.pid));
  return true;
}

async function releaseRunLock(lockPath) {
  try {
    await fs.unlink(lockPath);
  } catch {
    // Lock already removed
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Post-consolidation roadmap audit: detect merged items not marked [x].
 * Scans git log on main for merge commit patterns, compares against roadmap,
 * and marks any unmarked items complete.
 */
async function auditRoadmapCompletions(projectDir) {
  const reader = new RoadmapReader(projectDir);
  if (!await reader.exists()) return { reconciled: 0, items: [] };

  const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
  const gitOps = new GitOps(logger);

  // Get all merge commits on main
  const { stdout } = await gitOps._git(projectDir, ['log', '--oneline', 'main']);
  const mergePattern = /^[a-f0-9]+ merge: (\S+)/;
  const mergedIds = new Set();
  for (const line of stdout.split('\n')) {
    const match = line.match(mergePattern);
    if (match) mergedIds.add(match[1]);
  }

  if (mergedIds.size === 0) return { reconciled: 0, items: [] };

  // Find pending items that have merge commits
  const roadmap = await reader.parse();
  const allItems = reader.getAllItems(roadmap);
  const needsFix = allItems.filter(item => item.status === 'pending' && mergedIds.has(item.id));

  if (needsFix.length === 0) return { reconciled: 0, items: [] };

  // Mark each as complete
  for (const item of needsFix) {
    await reader.markItemComplete(item.id);
  }

  // Commit the fix
  const fixedIds = needsFix.map(i => i.id);
  await gitOps.commitAll(projectDir, `fix: mark ${fixedIds.length} items complete in roadmap (post-consolidation audit)`);

  return { reconciled: fixedIds.length, items: fixedIds };
}

module.exports = { runCommand, auditRoadmapCompletions };
