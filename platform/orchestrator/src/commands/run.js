const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const { RoadmapReader } = require('../roadmap/roadmap-reader');
const { GitOps } = require('../git/git-ops');
const { TemplateEngine } = require('../agents/template-engine');
const { resolveScheduleConfig, getWindowConfig, computeWindowEndTimeMs, VALID_WINDOWS } = require('../scheduler/window-config');
const { generateSessionId } = require('../session/session-utils');
const { spawnClaudeTerminal, saveCliSession, loadCliSession } = require('./cli-spawn');
const { runSessionWithAutoResume, transcriptPath } = require('./limit-resume');
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

    // The window's end hour is the run's only time boundary
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

  // Snapshot HEAD before the session (to detect whether Morgan committed work)
  let preHeadSha = null;
  try {
    const { execFile: execFileAsync } = require('../infra/exec-utils');
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: config.projectDir });
    preHeadSha = stdout.trim();
  } catch { /* not a git repo or no commits yet */ }

  // Print session header
  console.log('');
  console.log('=== DevShop — Morgan Orchestrator ===');
  console.log(`  Project:    ${project.name} (${project.id})`);
  console.log(`  Directory:  ${project.projectDir}`);
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

  console.log('=====================================');
  console.log('');

  // Pre-run health check — if the baseline is broken, Morgan repairs it first
  const healthStatus = await runPreflightHealthCheck(config.projectDir, fullConfig);

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
    ? `## Autonomous Mode\n\nYou are running autonomously via the scheduler (window: ${windowName}). Do NOT wait for user input — make decisions independently. Work through items until everything is complete or blocked. If you encounter a blocker, park the item and move on.`
    : '';

  const templateVars = {
    PROJECT_ID: config.projectId,
    PROJECT_DIR: config.projectDir,
    GITHUB_REPO: config.githubRepo || '',
    TECH_STACK: techStack,
    ROADMAP_CONTENT: roadmapContent,
    CONVENTIONS: conventions,
    HEALTH_STATUS: healthStatus,
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
  const repairFirst = healthStatus
    ? 'The baseline health check FAILED — repair the build/tests described in your instructions FIRST, then '
    : '';
  const initialPrompt = isAutonomous
    ? `${repairFirst}${repairFirst ? 'read' : 'Read'} the roadmap and start working through the pending items autonomously. Do not wait for input.`
    : `${repairFirst}${repairFirst ? 'read' : 'Read'} the roadmap and start working through the pending items. I can interact with you as you work.`;

  console.log('  Spawning Morgan as orchestrator...');
  console.log('  Use Ctrl+C or /exit to end the session.');
  console.log('');

  const effectiveSessionId = claudeSessionId || resumeSessionId;
  const continuationPrompt = `Continue working through the roadmap from where you left off. Check roadmap.md for pending items.${healthStatus ? `\n\n${healthStatus}` : ''}`;

  // Spawn Morgan inside the limit-aware session loop: enforces the window-end
  // deadline (scheduled windows only — plain runs are unbounded), detects a
  // usage-limit stop (frozen session or early exit), waits out the limit
  // window, and auto-resumes — unless --no-auto-resume was passed.
  const { timedOut, autoResumeCount } = await runSessionWithAutoResume({
    spawnSession: ({ isResume }) => spawnClaudeTerminal({
      projectDir: config.projectDir,
      appendSystemPrompt: (resumeSessionId || isResume) ? undefined : renderedPrompt,
      model: morganConfig.model,
      sessionId: claudeSessionId,
      resume: (resumeSessionId || isResume) ? effectiveSessionId : undefined,
      name: `Morgan — ${config.projectId}`,
      initialPrompt: (resumeSessionId || isResume) ? continuationPrompt : initialPrompt
    }),
    saveSession: () => saveCliSession(stateDir, effectiveSessionId, 'run'),
    transcriptFile: transcriptPath(config.projectDir, effectiveSessionId),
    windowEndTimeMs: config.windowEndTimeMs || null,
    autoResume: config.autoResume !== false
  });

  // Post-session health check — catch anything broken that Morgan missed.
  // Only runs when the session actually changed the project (commits or
  // uncommitted edits). On failure, Morgan is re-entered to repair (bounded);
  // if it still fails, consolidation to main is skipped.
  let healthFailed = false;
  const sessionDidWork = await didSessionChangeProject(config.projectDir, preHeadSha);
  if (sessionDidWork) {
    healthFailed = !(await verifyPostSessionHealth({
      projectDir: config.projectDir,
      fullConfig,
      model: morganConfig.model,
      resumeSessionId: claudeSessionId || resumeSessionId,
      projectId: config.projectId
    }));
  }

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
    console.log(`  Stop reason: window_end`);
  }
  if (autoResumeCount > 0) {
    console.log(`  Auto-resumes: ${autoResumeCount} (after usage-limit waits)`);
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
      stopReason: timedOut ? 'window_end' : 'session_ended'
    }, windowName);
  }

  // Auto-consolidate session branch to main — never with a failing health check
  if (healthFailed) {
    console.log('=== Consolidation Skipped ===');
    console.log('  The post-session health check is failing — the session branch');
    console.log('  will NOT be consolidated to main.');
    console.log(`  Fix interactively with: ./devshop pair ${config.projectId}`);
    console.log(`  Then consolidate with:  ./devshop run ${config.projectId} --resume`);
    console.log('=============================');
    console.log('');
  }
  if (itemsCompleted > 0 && !config.noConsolidate && !healthFailed) {
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
        const logger = { log: async () => {}, logCommit: async () => {} };
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

  const { GitHubNotifier } = require('../runners/github-notifier');

  // Build the digest from the current roadmap state (session summaries are
  // no longer generated — Morgan's CLI sessions produce commits, not summaries)
  const roadmapReader = new RoadmapReader(config.projectDir);
  if (!(await roadmapReader.exists())) {
    console.log('  No roadmap found for digest.');
    return 0;
  }

  const roadmap = await roadmapReader.parse();
  const items = roadmapReader.getAllItems(roadmap);
  const summary = {
    sessionId: generateSessionId('digest'),
    window: 'morning-digest',
    totalCostUsd: 0,
    agentInvocations: 0,
    results: {
      completed: items.filter(i => i.status === 'complete').map(i => i.id),
      parked: items.filter(i => i.status === 'parked').map(i => i.id),
      remaining: items.filter(i => i.status === 'pending').map(i => i.id)
    },
    stopReason: 'morning_digest'
  };

  const notifier = new GitHubNotifier(project.projectDir, project.name);
  const issueNumber = await notifier.postDailyDigest(summary);

  if (issueNumber) {
    console.log(`  Daily digest posted as Issue #${issueNumber}`);
  }

  return 0;
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

  const logger = { log: async () => {}, logCommit: async () => {} };
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

/**
 * Run the project's health check and return a structured report.
 *
 * Uses the project's `healthCheck` config (or auto-detection, including
 * native builds) via health-checker. Never throws.
 *
 * @param {string} projectDir
 * @param {object} fullConfig - Loaded config (reads fullConfig.healthCheck)
 * @returns {Promise<{ ran: boolean, passed: boolean, failureDetails: string }>}
 *   ran=false when no commands resolve or the checker errored (treated as pass);
 *   failureDetails is a markdown block of failing commands (empty when passed)
 */
async function runHealthCheckReport(projectDir, fullConfig) {
  const { resolveHealthCheckConfig, runHealthCheck } = require('../quality/health-checker');
  try {
    const hcConfig = await resolveHealthCheckConfig(projectDir, fullConfig);
    if (!hcConfig.commands || hcConfig.commands.length === 0) {
      return { ran: false, passed: true, failureDetails: '' };
    }
    const result = await runHealthCheck(projectDir, hcConfig);
    if (result.passed) {
      return { ran: true, passed: true, failureDetails: '' };
    }
    const failed = result.results.filter(r => r.exitCode !== 0);
    const failureDetails = failed.map(r => {
      const output = (r.stderr || r.stdout || '(no output)').slice(-2000);
      return `### \`${r.command}\` (exit ${r.exitCode})\n\`\`\`\n${output}\n\`\`\``;
    }).join('\n\n');
    return { ran: true, passed: false, failureDetails };
  } catch (err) {
    console.log(`  ~ [health_check] Skipped: ${err.message}`);
    return { ran: false, passed: true, failureDetails: '' };
  }
}

/**
 * Run the project's health check before spawning Morgan.
 *
 * Never blocks the run: on failure it returns a markdown block for injection
 * into Morgan's prompt so repairing the baseline becomes his first task;
 * on pass or error it returns ''.
 *
 * @param {string} projectDir
 * @param {object} fullConfig
 * @returns {Promise<string>} '' when healthy/skipped, markdown failure block otherwise
 */
async function runPreflightHealthCheck(projectDir, fullConfig) {
  console.log('  Running pre-run health check...');
  const report = await runHealthCheckReport(projectDir, fullConfig);
  if (!report.ran) {
    return '';
  }
  if (report.passed) {
    console.log('  Health check passed.');
    console.log('');
    return '';
  }
  console.log('  Health check FAILED — Morgan will repair the baseline first.');
  console.log('');
  return [
    '## Pre-Run Health Check FAILED',
    '',
    'The project baseline is broken. Before touching any roadmap item, your FIRST task is to repair the build/tests below, commit the fix, then re-run the failing commands to confirm they pass. Only then start roadmap work.',
    '',
    report.failureDetails
  ].join('\n');
}

/**
 * Detect whether Morgan's session changed the project: new commits since
 * the pre-session HEAD, or uncommitted working-tree changes.
 */
async function didSessionChangeProject(projectDir, preHeadSha) {
  const { execFile: execFileAsync } = require('../infra/exec-utils');
  try {
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
    if (status.trim()) return true;
    const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
    return head.trim() !== preHeadSha;
  } catch {
    return true; // can't tell — err on the side of checking
  }
}

/** Max times Morgan is re-entered to repair a failing post-session health check. */
const MAX_REPAIR_ATTEMPTS = 2;
/** Time cap per repair session. */
const REPAIR_TIME_LIMIT_MS = 15 * 60 * 1000;

/**
 * Verify project health after Morgan's session ends — the closing gate that
 * catches anything broken that Morgan didn't notice during the session.
 *
 * On failure, resumes Morgan's session with the failure output so he can
 * repair it, up to MAX_REPAIR_ATTEMPTS times (each capped at
 * REPAIR_TIME_LIMIT_MS). Returns true when healthy (or no checks resolve),
 * false when the health check is still failing after all repair attempts.
 */
async function verifyPostSessionHealth({ projectDir, fullConfig, model, resumeSessionId, projectId }) {
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    console.log('');
    console.log('  Running post-session health check...');
    const report = await runHealthCheckReport(projectDir, fullConfig);

    if (!report.ran || report.passed) {
      if (report.ran) console.log('  Post-session health check passed.');
      return true;
    }

    if (attempt === MAX_REPAIR_ATTEMPTS) {
      console.log('  Post-session health check still FAILING after repair attempts.');
      return false;
    }

    console.log(`  Post-session health check FAILED — re-entering Morgan to repair (attempt ${attempt + 1}/${MAX_REPAIR_ATTEMPTS}).`);
    console.log('');

    const repairPrompt = [
      'The post-session health check FAILED — something in the project broke during this session.',
      'Investigate and fix the failures below, commit the fix, and re-run the failing commands to confirm they pass. Do not start new roadmap work.',
      '',
      report.failureDetails
    ].join('\n');

    const { promise, proc } = spawnClaudeTerminal({
      projectDir,
      resume: resumeSessionId,
      model,
      name: `Morgan (repair) — ${projectId}`,
      initialPrompt: repairPrompt
    });

    const timer = setTimeout(() => {
      console.log('');
      console.log('  === Repair time limit reached — stopping Morgan ===');
      proc.kill('SIGTERM');
    }, REPAIR_TIME_LIMIT_MS);

    await promise;
    clearTimeout(timer);
  }

  return false;
}

module.exports = {
  runCommand,
  auditRoadmapCompletions,
  runHealthCheckReport,
  runPreflightHealthCheck,
  verifyPostSessionHealth,
  didSessionChangeProject
};
