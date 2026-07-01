const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const { RoadmapReader } = require('../roadmap/roadmap-reader');
const { GitOps } = require('../git/git-ops');
const { TemplateEngine } = require('../agents/template-engine');
const { resolveScheduleConfig, getWindowConfig, computeWindowEndTimeMs, VALID_WINDOWS } = require('../scheduler/window-config');
const { CostEstimator } = require('../session/cost-estimator');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');
const { spawnClaudeTerminal, saveCliSession, loadCliSession } = require('./cli-spawn');
const { loadConfig } = require('../infra/config');

const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEMPLATES_DIR = path.join(DEVSHOP_ROOT, 'templates', 'agents');
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

  const fullConfig = await loadConfig(config);
  const morganConfig = fullConfig.agents?.['principal-engineer'] || fullConfig.agents?.['pair'] || {};

  // Snapshot roadmap state before the session (for post-session diff)
  const preRoadmap = await roadmapReader.parse();
  const preCompleteCount = roadmapReader.getAllItems(preRoadmap)
    .filter(i => i.status === 'complete').length;

  // Print session header
  const budgetUsd = config.budgetLimitUsd;
  const timeLimitHours = (config.timeLimitMs / 3600000).toFixed(1);

  console.log('');
  console.log('=== DevShop — Morgan Orchestrator ===');
  console.log(`  Project:    ${project.name} (${project.id})`);
  console.log(`  Directory:  ${project.projectDir}`);
  console.log(`  Budget:     $${budgetUsd.toFixed(2)}`);
  console.log(`  Time limit: ${timeLimitHours}h`);
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
      const roadmap = await roadmapReader.parse();
      const pendingCount = roadmapReader.getAllItems(roadmap)
        .filter(i => i.status === 'pending').length;

      if (pendingCount > 0) {
        const prediction = costEstimator.predictSufficiency(budgetUsd, pendingCount);
        console.log(`  Estimate:   $${prediction.estimatedCost.toFixed(2)} (${pendingCount} pending, confidence: ${prediction.confidence})`);
      }
    }
  } catch {
    // Non-fatal — skip estimate display
  }

  console.log('=====================================');
  console.log('');

  // Build Morgan's orchestration prompt
  const templateEngine = new TemplateEngine(TEMPLATES_DIR);

  let roadmapContent = '';
  try {
    roadmapContent = await fs.readFile(path.join(config.projectDir, 'openspec', 'roadmap.md'), 'utf-8');
  } catch { /* no roadmap content */ }

  let conventions = '';
  try {
    conventions = await fs.readFile(path.join(config.projectDir, 'openspec', 'conventions.md'), 'utf-8');
  } catch { /* no conventions */ }

  let techStack = 'Not specified';
  try {
    const { OpenSpecReader } = require('../roadmap/openspec-reader');
    const openspec = new OpenSpecReader(config.projectDir);
    techStack = await openspec.parseTechStack();
  } catch {}

  const isAutonomous = !!windowName;
  const autonomousMode = isAutonomous
    ? `## Autonomous Mode\n\nYou are running autonomously via the scheduler (window: ${windowName}). Do NOT wait for user input — make decisions independently. Work through items until you run out of budget/time or complete everything. If you encounter a blocker, park the item and move on.`
    : '';

  const templateVars = {
    PROJECT_ID: config.projectId,
    PROJECT_DIR: config.projectDir,
    GITHUB_REPO: config.githubRepo || '',
    TECH_STACK: techStack,
    ROADMAP_CONTENT: roadmapContent,
    CONVENTIONS: conventions,
    BUDGET_USD: budgetUsd.toFixed(2),
    TIME_LIMIT_HOURS: timeLimitHours,
    AUTONOMOUS_MODE: autonomousMode
  };

  const promptPath = path.join(TEMPLATES_DIR, 'principal-engineer', 'run-prompt.md');
  const promptTemplate = await fs.readFile(promptPath, 'utf-8');
  const resolvedTemplate = await templateEngine._resolvePartials(promptTemplate);
  const renderedPrompt = templateEngine.renderString(resolvedTemplate, templateVars);

  // Session management
  const stateDir = path.join(config.activeAgentsDir, 'orchestrator');
  let claudeSessionId = null;
  let resumeSessionId = null;

  if (config.resume) {
    resumeSessionId = await loadCliSession(stateDir, 'run');
    if (resumeSessionId) {
      console.log('  Resuming previous run session...');
      console.log('');
    }
  }

  if (!resumeSessionId) {
    claudeSessionId = randomUUID();
  }

  // Build initial prompt
  const initialPrompt = isAutonomous
    ? 'Read the roadmap and start working through the pending items autonomously. Do not wait for input.'
    : 'Read the roadmap and start working through the pending items. I can interact with you as you work.';

  console.log('  Spawning Morgan as orchestrator...');
  console.log('  Use Ctrl+C or /exit to end the session.');
  console.log('');

  // Spawn Morgan with optional time limit
  const { promise: morganPromise, proc: morganProc } = spawnClaudeTerminal({
    projectDir: config.projectDir,
    appendSystemPrompt: resumeSessionId ? undefined : renderedPrompt,
    model: morganConfig.model,
    sessionId: claudeSessionId,
    resume: resumeSessionId,
    name: `Morgan — ${config.projectId}`,
    initialPrompt: resumeSessionId
      ? 'Continue working through the roadmap from where you left off. Check roadmap.md for pending items.'
      : initialPrompt
  });

  // Time limit enforcement
  let timedOut = false;
  const timer = config.timeLimitMs ? setTimeout(() => {
    timedOut = true;
    console.log('');
    console.log('  === Time limit reached — stopping Morgan ===');
    console.log('');
    morganProc.kill('SIGTERM');
  }, config.timeLimitMs) : null;

  await morganPromise;

  if (timer) clearTimeout(timer);

  // Save session for resume
  await saveCliSession(stateDir, claudeSessionId || resumeSessionId, 'run');

  // Post-session: detect completed work
  const postRoadmap = await roadmapReader.parse();
  const postCompleteCount = roadmapReader.getAllItems(postRoadmap)
    .filter(i => i.status === 'complete').length;
  const itemsCompleted = postCompleteCount - preCompleteCount;

  const parkedItems = roadmapReader.getAllItems(postRoadmap)
    .filter(i => i.status === 'parked');
  const pendingItems = roadmapReader.getAllItems(postRoadmap)
    .filter(i => i.status === 'pending');

  // Print session summary
  console.log('');
  console.log('=== Session Complete ===');
  console.log(`  Completed:   ${itemsCompleted} items this session (${postCompleteCount} total)`);
  console.log(`  Parked:      ${parkedItems.length} items`);
  console.log(`  Remaining:   ${pendingItems.length} items`);
  if (timedOut) {
    console.log(`  Stop reason: time_limit`);
  }
  console.log('========================');
  console.log('');

  // Surface HUMAN-tagged items
  const humanItems = roadmapReader.getAllItems(postRoadmap)
    .filter(i => i.isHuman && i.status !== 'complete');
  if (humanItems.length > 0) {
    console.log('=== Action Required ===');
    for (const item of humanItems) {
      const cleanDesc = item.description.replace(/\s*\[HUMAN\]\s*/g, '').trim();
      console.log(`  Phase ${item.phaseNumber}: \`${item.id}\` — ${cleanDesc}`);
    }
    console.log(`  Run: ./devshop action ${config.projectId}`);
    console.log('=======================');
    console.log('');
  }

  // Update registry
  const sessionId = generateSessionId();
  project.lastSessionId = sessionId;
  await saveRegistry(registry);

  // Post-run digest if running in a window
  if (windowName) {
    await postRunDigest(project, config, {
      completed: itemsCompleted,
      parked: parkedItems.length,
      remaining: pendingItems.length,
      stopReason: timedOut ? 'time_limit' : 'session_ended'
    }, windowName);
  }

  // Auto-consolidate session branch to main
  if (itemsCompleted > 0 && !config.noConsolidate) {
    try {
      // Commit any uncommitted changes Morgan left
      const { execFile: execFileAsync } = require('../infra/exec-utils');
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: config.projectDir });
      if (status.trim()) {
        await execFileAsync('git', ['add', '-A'], { cwd: config.projectDir });
        await execFileAsync('git', ['commit', '-m', 'chore: uncommitted changes from Morgan session'], { cwd: config.projectDir });
      }

      // Get current branch name for consolidation
      const { stdout: branchName } = await execFileAsync('git', ['branch', '--show-current'], { cwd: config.projectDir });
      const currentBranch = branchName.trim();

      if (currentBranch && currentBranch !== 'main') {
        const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
        const gitOps = new GitOps(logger);
        await gitOps.consolidateToMain(config.projectDir, currentBranch, {
          sessionId,
          projectId: config.projectId,
          completed: Array(itemsCompleted).fill('item'),
          parked: parkedItems.map(i => i.id),
          totalCostUsd: 0
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
      }
    } catch (err) {
      console.log(`  Auto-consolidation failed: ${err.message}`);
    }
  }

  return parkedItems.length > 0 ? 1 : 0;
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
    const fullConfig = await loadConfig(config);
    const runner = new TechDebtRunner({ ...fullConfig, ...config });
    const result = await runner.run();

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
      sessionId: generateSessionId(),
      window: windowName,
      totalCostUsd: 0,
      agentInvocations: 1,
      results: {
        completed: Array(result.completed).fill('item'),
        parked: Array(result.parked).fill('item'),
        remaining: Array(result.remaining).fill('item')
      },
      stopReason: result.stopReason
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
    const content = await fs.readFile(lockPath, 'utf-8');
    const pid = parseInt(content.trim(), 10);

    if (pid && isProcessRunning(pid)) {
      return false;
    }
  } catch {
    // No lock file exists
  }

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
 */
async function auditRoadmapCompletions(projectDir) {
  const reader = new RoadmapReader(projectDir);
  if (!await reader.exists()) return { reconciled: 0, items: [] };

  const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
  const gitOps = new GitOps(logger);

  const { stdout } = await gitOps._git(projectDir, ['log', '--oneline', 'main']);
  const mergePattern = /^[a-f0-9]+ merge: (\S+)/;
  const mergedIds = new Set();
  for (const line of stdout.split('\n')) {
    const match = line.match(mergePattern);
    if (match) mergedIds.add(match[1]);
  }

  if (mergedIds.size === 0) return { reconciled: 0, items: [] };

  const roadmap = await reader.parse();
  const allItems = reader.getAllItems(roadmap);
  const needsFix = allItems.filter(item => item.status === 'pending' && mergedIds.has(item.id));

  if (needsFix.length === 0) return { reconciled: 0, items: [] };

  for (const item of needsFix) {
    await reader.markItemComplete(item.id);
  }

  const fixedIds = needsFix.map(i => i.id);
  await gitOps.commitAll(projectDir, `fix: mark ${fixedIds.length} items complete in roadmap (post-consolidation audit)`);

  return { reconciled: fixedIds.length, items: fixedIds };
}

module.exports = { runCommand, auditRoadmapCompletions };
