const readline = require('readline');
const path = require('path');
const { Logger } = require('../infra/logger');
const { AgentRunner } = require('../agents/agent-runner');
const { TemplateEngine } = require('../agents/template-engine');
const { AgentSession } = require('../agents/agent-session');
const { OpenSpecReader } = require('../roadmap/openspec-reader');
const { loadConfig } = require('../infra/config');
const { BroadcastServer } = require('../infra/broadcast-server');
const { execFile: execFileAsync } = require('../infra/exec-utils');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');
const { loadProjectContext } = require('./context-loader');
const { readMultiLineInput } = require('../infra/prompt-input');

async function planCommand(project, cliConfig) {
  console.log('');
  console.log('=== Brain Dump with Riley ===');
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('');
  console.log('  Share your idea with Riley. She\'ll ask questions,');
  console.log('  refine it into specs, and create a roadmap.');
  console.log('');
  console.log('  Type your message and press Enter. For multi-line, keep typing — blank line sends.');
  console.log('  Type "push" to commit and push changes to GitHub.');
  console.log('  Type "done" or Ctrl+C to end the session.');
  console.log('==============================');
  console.log('');

  // Initialize modules
  const config = await loadConfig(cliConfig);
  const sessionId = generateSessionId();
  const { logsDir } = getOrchestratorPaths(cliConfig);
  const logger = new Logger(`plan-${sessionId}`, logsDir);
  await logger.init();

  const agentRunner = new AgentRunner(logger);
  const templateEngine = new TemplateEngine(cliConfig.templatesDir);
  const openspec = new OpenSpecReader(cliConfig.projectDir);

  // Get tech stack for template vars
  let techStack = 'Not specified';
  try {
    techStack = await openspec.parseTechStack();
  } catch {
    // No project.md yet, that's fine for brain dump
  }

  // Load conventions for context refresh
  let conventions = null;
  try {
    const fsAsync = require('fs/promises');
    conventions = await fsAsync.readFile(path.join(cliConfig.projectDir, 'openspec', 'conventions.md'), 'utf-8');
  } catch { /* no conventions file */ }

  const agentSession = new AgentSession(agentRunner, templateEngine, {
    ...cliConfig,
    pmModel: config.agents?.pm?.model || 'claude-sonnet-4-20250514',
    pmBudgetUsd: config.agents?.pm?.maxBudgetUsd || 2.00,
    pmTimeoutMs: config.agents?.pm?.timeoutMs || 300000,
    contextRefresh: {
      interval: 5,
      persona: 'Riley, the PM',
      projectId: cliConfig.projectId,
      projectDir: cliConfig.projectDir,
      conventions
    }
  });

  // Start broadcast server for watch command
  const broadcastPort = cliConfig.broadcastPort || 3100;
  const broadcastServer = new BroadcastServer();
  try {
    await broadcastServer.start(broadcastPort);
    if (broadcastServer.isRunning) {
      console.log(`  Broadcasting on port ${broadcastPort} (use "watch" to monitor)`);
    }
  } catch {
    // Non-fatal — plan session continues without broadcast
  }

  const onEvent = broadcastServer.isRunning
    ? (event) => {
        broadcastServer.broadcast({
          source: 'riley',
          sessionId,
          timestamp: new Date().toISOString(),
          persona: 'Riley',
          event
        });
      }
    : undefined;

  // Try to resume existing PM session (unless --fresh)
  const stateDir = path.join(cliConfig.activeAgentsDir, 'orchestrator');
  let existingSession = null;
  if (cliConfig.fresh) {
    // Delete saved session to force fresh start with new system prompt
    const fs = require('fs/promises');
    try {
      await fs.unlink(path.join(stateDir, 'agent-session.json'));
    } catch { /* no saved session */ }
    console.log('  Starting fresh session (--fresh).');
    console.log('');
  } else {
    existingSession = await agentSession.loadSessionState(stateDir);
    if (existingSession) {
      console.log(`  Resuming previous session: ${existingSession.sessionId}`);
      console.log('  (Use --fresh to start a new session instead.)');
      console.log('');
    }
  }

  // Load project context files (if any) for first-turn injection
  const projectContext = await loadProjectContext(cliConfig.projectDir);

  const templateVars = {
    PROJECT_ID: cliConfig.projectId,
    PROJECT_DIR: cliConfig.projectDir,
    TECH_STACK: techStack,
    GITHUB_REPO: cliConfig.githubRepo || '',
    PROJECT_CONTEXT: projectContext
  };

  // Interactive readline loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let totalCost = 0;
  let turnCount = 0;

  const promptLoop = async () => {
    while (true) {
      const input = await readMultiLineInput(rl);
      const trimmed = input.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.toLowerCase() === 'push') {
        const fixed = await autoFixBeforeCommit(cliConfig.projectDir, agentSession, onEvent);
        totalCost += fixed.cost;
        console.log('');
        console.log('  Pushing changes to GitHub...');
        await commitAndPush(cliConfig.projectDir, cliConfig.projectId);
        continue;
      }

      if (trimmed.toLowerCase() === 'done' || trimmed.toLowerCase() === 'exit') {
        // Auto-fix roadmap/requirements format issues before exiting
        const fixResult = await autoFixBeforeCommit(cliConfig.projectDir, agentSession, onEvent);
        totalCost += fixResult.cost;

        // Check for unpushed changes before exiting
        try {
          const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: cliConfig.projectDir });
          if (status.trim()) {
            console.log('');
            console.log('  You have unpushed changes. Pushing to GitHub...');
            await commitAndPush(cliConfig.projectDir, cliConfig.projectId);
          }
        } catch { /* git check failed, continue with exit */ }

        await agentSession.saveSessionState(stateDir);
        if (broadcastServer.isRunning) {
          try { await broadcastServer.stop(); } catch {}
        }
        console.log('');
        console.log(`  Session saved. Total cost: $${totalCost.toFixed(2)}, Turns: ${turnCount}`);
        console.log(`  Resume later with: ./devshop plan ${cliConfig.projectId}`);
        console.log('');
        rl.close();
        return;
      }

      turnCount++;
      console.log('');
      console.log('  Riley is thinking...');

      try {
        const options = {
          systemPromptTemplate: 'pm-agent',
          promptFile: turnCount === 1 && !existingSession ? 'brain-dump-prompt.md' : null,
          templateVars,
          onEvent
        };

        const result = await agentSession.chat(trimmed, options);
        totalCost += result.cost || 0;

        console.log('');
        console.log(`  Riley: ${result.response}`);
        console.log('');
        console.log(`  [cost: $${(result.cost || 0).toFixed(3)} | total: $${totalCost.toFixed(3)}]`);
      } catch (err) {
        console.error(`  Error: ${err.message}`);
      }
    }
  };

  // Handle Ctrl+C gracefully
  rl.on('close', async () => {
    await agentSession.saveSessionState(stateDir);
    if (broadcastServer.isRunning) {
      try { await broadcastServer.stop(); } catch {}
    }
    await logger.log('info', 'plan_session_ended', { totalCost, turnCount });
  });

  return new Promise((resolve) => {
    rl.on('close', () => resolve(0));
    promptLoop();
  });
}

/**
 * Commit and push any changes Riley made during the plan session.
 * Creates a feature branch and pushes (projects have pre-push hooks blocking main).
 */
async function commitAndPush(projectDir, projectId) {
  try {
    // Check if there are any changes to commit
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
    if (!status.trim()) {
      console.log('');
      console.log('  No changes to commit.');
      return;
    }

    // Create a feature branch, commit, and push
    const branchName = `chore/plan-${Date.now()}`;
    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: projectDir });
    await execFileAsync('git', ['add', '-A'], { cwd: projectDir });
    await execFileAsync('git', [
      'commit', '-m', 'feat: update OpenSpec specs and roadmap via plan session'
    ], { cwd: projectDir });
    await execFileAsync('git', ['push', '-u', 'origin', branchName], { cwd: projectDir });

    // Create PR
    const { stdout: prUrl } = await execFileAsync('gh', [
      'pr', 'create',
      '--title', `feat(${projectId}): update specs and roadmap`,
      '--body', 'Specs and roadmap created/updated via `./devshop plan` session.\n\n🤖 Generated with DevShop'
    ], { cwd: projectDir });

    console.log('');
    console.log(`  Changes committed and pushed.`);
    console.log(`  PR: ${prUrl.trim()}`);

    // Merge the PR and return to main
    await execFileAsync('gh', ['pr', 'merge', '--merge'], { cwd: projectDir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: projectDir });
    await execFileAsync('git', ['pull'], { cwd: projectDir });
    console.log('  PR merged.');
  } catch (err) {
    console.error(`  Warning: Git commit/push failed: ${err.message}`);
  }
}

/**
 * Validate roadmap and requirements format, auto-fix via Riley up to 3 times.
 * Returns { cost } with total cost of fix attempts.
 */
async function autoFixBeforeCommit(projectDir, agentSession, onEvent) {
  let cost = 0;
  const maxRetries = 3;

  // Auto-fix requirements format
  const { validateRequirementsFormat, buildRequirementsFixPrompt } = require('../roadmap/requirements-format-checker');
  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const reqResult = await validateRequirementsFormat(projectDir);
      if (reqResult.valid) {
        if (attempt > 0) console.log('  Requirements format is now valid!');
        break;
      }
      if (attempt === maxRetries - 1) {
        console.error(`  Warning: Requirements format still invalid after ${maxRetries} attempts.`);
        console.error(`  Issues: ${reqResult.errors.join('; ')}`);
        break;
      }
      console.log(`  Requirements format has ${reqResult.errors.length} issue(s). Asking Riley to fix...`);
      const fixPrompt = buildRequirementsFixPrompt(reqResult, projectDir);
      const fixResult = await agentSession.chat(fixPrompt, { onEvent });
      cost += fixResult.cost || 0;
    }
  } catch {
    // No project.md — nothing to validate
  }

  // Auto-fix roadmap format
  const { validateRoadmapFormat, buildRoadmapFixPrompt } = require('../roadmap/roadmap-format-checker');
  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const fmtResult = await validateRoadmapFormat(projectDir);
      if (fmtResult.valid) {
        if (attempt > 0) console.log('  Roadmap format is now valid!');
        break;
      }
      if (attempt === maxRetries - 1) {
        const issues = [...fmtResult.nearMisses, ...fmtResult.errors];
        console.error(`  Warning: Roadmap format still invalid after ${maxRetries} attempts.`);
        console.error(`  Issues: ${issues.join('; ')}`);
        break;
      }
      const issueCount = fmtResult.nearMisses.length + fmtResult.errors.length;
      console.log(`  Roadmap has ${issueCount} format issue(s). Asking Riley to fix...`);
      const fixPrompt = buildRoadmapFixPrompt(fmtResult, projectDir);
      const fixResult = await agentSession.chat(fixPrompt, { onEvent });
      cost += fixResult.cost || 0;
    }
  } catch {
    // No roadmap — nothing to validate
  }

  return { cost };
}

module.exports = { planCommand, autoFixBeforeCommit };
