const readline = require('readline');
const path = require('path');
const fs = require('fs/promises');
const { Logger } = require('../infra/logger');
const { AgentRunner } = require('../agents/agent-runner');
const { TemplateEngine } = require('../agents/template-engine');
const { AgentSession } = require('../agents/agent-session');
const { OpenSpecReader } = require('../roadmap/openspec-reader');
const { RoadmapReader } = require('../roadmap/roadmap-reader');
const { loadConfig } = require('../infra/config');
const { BroadcastServer } = require('../infra/broadcast-server');
const { execFile: execFileAsync } = require('../infra/exec-utils');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');
const { readMultiLineInput } = require('../infra/prompt-input');
const { autoFixBeforeCommit } = require('./plan');

async function talkCommand(project, cliConfig) {
  console.log('');
  console.log('=== Talk to Riley ===');
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('');

  // Initialize modules
  const config = await loadConfig(cliConfig);
  const sessionId = generateSessionId();
  const { logsDir } = getOrchestratorPaths(cliConfig);
  const logger = new Logger(`talk-${sessionId}`, logsDir);
  await logger.init();

  const agentRunner = new AgentRunner(logger);
  const templateEngine = new TemplateEngine(cliConfig.templatesDir);
  const openspec = new OpenSpecReader(cliConfig.projectDir);
  const roadmapReader = new RoadmapReader(cliConfig.projectDir);

  // Gather context for Riley
  let techStack = 'Not specified';
  try { techStack = await openspec.parseTechStack(); } catch {}

  let progressContext = '';

  // Read orchestrator state
  const stateFilePath = path.join(cliConfig.activeAgentsDir, 'orchestrator', 'state.json');
  try {
    const raw = await fs.readFile(stateFilePath, 'utf-8');
    const state = JSON.parse(raw);
    progressContext += `\n## Current Session State\n`;
    progressContext += `- Session: ${state.sessionId}\n`;
    progressContext += `- State: ${state.state}\n`;
    progressContext += `- Completed: ${state.requirements.completed.length} requirements\n`;
    progressContext += `- Pending: ${state.requirements.pending.length} requirements\n`;
    progressContext += `- Parked: ${state.requirements.parked.length} requirements\n`;
    if (state.requirements.completed.length > 0) {
      progressContext += `- Completed items: ${state.requirements.completed.join(', ')}\n`;
    }
    if (state.requirements.parked.length > 0) {
      const parkedIds = state.requirements.parked.map(p => typeof p === 'string' ? p : p.id);
      progressContext += `- Parked items: ${parkedIds.join(', ')}\n`;
    }
  } catch {
    progressContext += '\nNo active session found.\n';
  }

  // Read roadmap status
  try {
    const hasRoadmap = await roadmapReader.exists();
    if (hasRoadmap) {
      const roadmap = await roadmapReader.parse();
      progressContext += `\n## Roadmap: ${roadmap.title}\n`;
      for (const phase of roadmap.phases) {
        const items = phase.groups.flatMap(g => g.items);
        const done = items.filter(i => i.status === 'complete').length;
        const total = items.length;
        progressContext += `- Phase ${phase.number} (${phase.label}): ${done}/${total} complete\n`;
      }
    }
  } catch {}

  console.log('  Riley has context about your project\'s current progress.');
  console.log('  Ask questions, request spec changes, or update the roadmap.');
  console.log('');
  console.log('  Type your message and press Enter. For multi-line, keep typing — blank line sends.');
  console.log('  Type "done" or Ctrl+C to end.');
  console.log('=====================');
  console.log('');

  // Load conventions for context refresh
  let conventions = null;
  try {
    conventions = await fs.readFile(path.join(cliConfig.projectDir, 'openspec', 'conventions.md'), 'utf-8');
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
    // Non-fatal — talk session continues without broadcast
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

  // Try to resume existing PM session
  const stateDir = path.join(cliConfig.activeAgentsDir, 'orchestrator');
  await agentSession.loadSessionState(stateDir);

  const templateVars = {
    PROJECT_ID: cliConfig.projectId,
    PROJECT_DIR: cliConfig.projectDir,
    TECH_STACK: techStack,
    GITHUB_REPO: cliConfig.githubRepo || '',
    REQUIREMENTS: `You are in a mid-project conversation. Here is the current project progress:\n${progressContext}\n\nThe developer wants to discuss the project. Listen carefully, and if they want to update specs or roadmap, make the changes directly.`
  };

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
        console.log('');
        rl.close();
        return;
      }

      turnCount++;
      console.log('');
      console.log('  Riley is thinking...');

      try {
        const result = await agentSession.chat(trimmed, {
          systemPromptTemplate: 'pm-agent',
          templateVars,
          onEvent
        });
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

  rl.on('close', async () => {
    await agentSession.saveSessionState(stateDir);
    if (broadcastServer.isRunning) {
      try { await broadcastServer.stop(); } catch {}
    }
    await logger.log('info', 'talk_session_ended', { totalCost, turnCount });
  });

  return new Promise((resolve) => {
    rl.on('close', () => resolve(0));
    promptLoop();
  });
}

/**
 * Commit and push any changes Riley made during the talk session.
 * Creates a feature branch and pushes (projects have pre-push hooks blocking main).
 */
async function commitAndPush(projectDir, projectId) {
  try {
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
    if (!status.trim()) {
      console.log('');
      console.log('  No changes to commit.');
      return;
    }

    const branchName = `chore/talk-${Date.now()}`;
    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: projectDir });
    await execFileAsync('git', ['add', '-A'], { cwd: projectDir });
    await execFileAsync('git', [
      'commit', '-m', 'feat: update specs and roadmap via talk session'
    ], { cwd: projectDir });
    await execFileAsync('git', ['push', '-u', 'origin', branchName], { cwd: projectDir });

    const { stdout: prUrl } = await execFileAsync('gh', [
      'pr', 'create',
      '--title', `feat(${projectId}): update specs and roadmap`,
      '--body', 'Specs and roadmap updated via `./devshop talk` session.\n\n🤖 Generated with DevShop'
    ], { cwd: projectDir });

    console.log('');
    console.log('  Changes committed and pushed.');
    console.log(`  PR: ${prUrl.trim()}`);

    await execFileAsync('gh', ['pr', 'merge', '--merge'], { cwd: projectDir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: projectDir });
    await execFileAsync('git', ['pull'], { cwd: projectDir });
    console.log('  PR merged.');
  } catch (err) {
    console.error(`  Warning: Git commit/push failed: ${err.message}`);
  }
}

module.exports = { talkCommand };
