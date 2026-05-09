const readline = require('readline');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { Logger } = require('../infra/logger');
const { TemplateEngine } = require('../agents/template-engine');
const { OpenSpecReader } = require('../roadmap/openspec-reader');
const { RoadmapReader } = require('../roadmap/roadmap-reader');
const { loadConfig } = require('../infra/config');
const { execFile: execFileAsync } = require('../infra/exec-utils');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');

/**
 * Build project context string for Riley's talk session.
 */
async function buildTalkContext({ stateDir, logsDir, roadmapReader }) {
  let context = '';

  // Read orchestrator state
  const stateFilePath = path.join(stateDir, 'state.json');
  try {
    const raw = await fs.readFile(stateFilePath, 'utf-8');
    const state = JSON.parse(raw);
    context += `\n## Current Session State\n`;
    context += `- Session: ${state.sessionId}\n`;
    context += `- State: ${state.state}\n`;
    context += `- Completed: ${state.requirements.completed.length} requirements\n`;
    context += `- Pending: ${state.requirements.pending.length} requirements\n`;
    context += `- Parked: ${state.requirements.parked.length} requirements\n`;
    if (state.requirements.completed.length > 0) {
      context += `- Completed items: ${state.requirements.completed.join(', ')}\n`;
    }
    if (state.requirements.parked.length > 0) {
      const parkedIds = state.requirements.parked.map(p => typeof p === 'string' ? p : p.id);
      context += `- Parked items: ${parkedIds.join(', ')}\n`;
    }
  } catch {
    context += '\nNo active session found.\n';
  }

  // Read roadmap status
  try {
    const hasRoadmap = await roadmapReader.exists();
    if (hasRoadmap) {
      const roadmap = await roadmapReader.parse();
      context += `\n## Roadmap: ${roadmap.title}\n`;
      for (const phase of roadmap.phases) {
        const items = phase.groups.flatMap(g => g.items);
        const done = items.filter(i => i.status === 'complete').length;
        const total = items.length;
        context += `- Phase ${phase.number} (${phase.label}): ${done}/${total} complete\n`;
      }
    }
  } catch {}

  // Read parked items with failure reasons from latest session summary
  try {
    const files = await fs.readdir(logsDir);
    const summaryFiles = files.filter(f => f.endsWith('-summary.json')).sort();
    if (summaryFiles.length > 0) {
      const latestSummary = summaryFiles[summaryFiles.length - 1];
      const raw = await fs.readFile(path.join(logsDir, latestSummary), 'utf-8');
      const summary = JSON.parse(raw);
      if (summary.parked && summary.parked.length > 0) {
        context += `\n## Parked Items (from last session)\n`;
        for (const item of summary.parked) {
          const id = typeof item === 'string' ? item : item.id;
          const error = typeof item === 'object' ? item.error : null;
          context += `- **${id}**`;
          if (error) {
            context += `: ${error}`;
          }
          context += '\n';
        }
      }
    }
  } catch {}

  return context;
}

/**
 * Build CLI args array for the claude command.
 */
function buildClaudeArgs({ appendSystemPrompt, model, sessionId, resume, name }) {
  const args = ['--dangerously-skip-permissions'];

  if (resume) {
    args.push('--resume', resume);
  } else {
    if (appendSystemPrompt) {
      args.push('--append-system-prompt', appendSystemPrompt);
    }
    if (sessionId) {
      args.push('--session-id', sessionId);
    }
  }

  if (model) {
    args.push('--model', model);
  }

  if (name) {
    args.push('--name', name);
  }

  return args;
}

/**
 * Spawn a real Claude Code terminal session with stdio: 'inherit'.
 * Returns a promise that resolves with the exit code when the user exits.
 */
function spawnClaudeTerminal({ projectDir, appendSystemPrompt, model, sessionId, resume, name }) {
  const args = buildClaudeArgs({ appendSystemPrompt, model, sessionId, resume, name });

  const proc = spawn('claude', args, {
    stdio: 'inherit',
    cwd: projectDir,
    env: { ...process.env }
  });

  return new Promise((resolve, reject) => {
    proc.on('exit', (code) => resolve(code ?? 0));
    proc.on('error', reject);
  });
}

async function talkCommand(project, cliConfig) {
  console.log('');
  console.log('=== Talk to Riley ===');
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('');

  // Initialize modules
  const config = await loadConfig(cliConfig);
  const sessionId = generateSessionId('talk');
  const { logsDir } = getOrchestratorPaths(cliConfig);
  const logger = new Logger(`talk-${sessionId}`, logsDir);
  await logger.init();

  const templateEngine = new TemplateEngine(cliConfig.templatesDir);
  const openspec = new OpenSpecReader(cliConfig.projectDir);
  const roadmapReader = new RoadmapReader(cliConfig.projectDir);

  // Gather project context for Riley
  let techStack = 'Not specified';
  try { techStack = await openspec.parseTechStack(); } catch {}

  const stateDir = path.join(cliConfig.activeAgentsDir, 'orchestrator');
  const progressContext = await buildTalkContext({ stateDir, logsDir, roadmapReader });

  const talkAgentConfig = config.agents?.['talk'] || config.agents?.['pm'];

  // Render the talk prompt template
  const templateVars = {
    PROJECT_ID: cliConfig.projectId,
    PROJECT_DIR: cliConfig.projectDir,
    TECH_STACK: techStack,
    GITHUB_REPO: cliConfig.githubRepo || '',
    REQUIREMENTS: progressContext
      ? `Here is the current project state for context:\n${progressContext}`
      : ''
  };

  const promptPath = path.join(cliConfig.templatesDir, 'pm-agent', 'talk-prompt.md');
  let promptTemplate = await fs.readFile(promptPath, 'utf-8');
  // Resolve partials ({{>roadmap-rules}}, etc.)
  promptTemplate = await templateEngine._resolvePartials(promptTemplate);
  const renderedPrompt = templateEngine.renderString(promptTemplate, templateVars);

  // Determine Claude session ID for tracking / resume
  let claudeSessionId = null;
  let resumeSessionId = null;

  if (cliConfig.resume) {
    try {
      const raw = await fs.readFile(path.join(stateDir, 'talk-session.json'), 'utf-8');
      const state = JSON.parse(raw);
      if (state.sessionId) {
        resumeSessionId = state.sessionId;
        console.log('  Resuming previous talk session...');
        console.log('');
      }
    } catch {
      // No previous session — start fresh
    }
  }

  if (!resumeSessionId) {
    claudeSessionId = randomUUID();
  }

  // Display banner
  console.log('  Riley has context about your project\'s current state.');
  console.log('  Opening Claude Code terminal with project context...');
  console.log('  Use Ctrl+C or /exit to end the session.');
  console.log('=====================');
  console.log('');

  // Main session loop (supports re-entry)
  let reenter = true;
  while (reenter) {
    reenter = false;

    await spawnClaudeTerminal({
      projectDir: cliConfig.projectDir,
      appendSystemPrompt: renderedPrompt,
      model: talkAgentConfig?.model,
      sessionId: claudeSessionId,
      resume: resumeSessionId,
      name: `Riley — ${cliConfig.projectId}`
    });

    // After first run, any re-entry is a resume
    const activeSessionId = claudeSessionId || resumeSessionId;
    if (claudeSessionId) {
      resumeSessionId = claudeSessionId;
      claudeSessionId = null;
    }

    // Save session for future resume
    await saveTalkSession(stateDir, activeSessionId);

    // Post-session: check for changes
    try {
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: cliConfig.projectDir });
      const hasChanges = status.trim().length > 0;

      if (hasChanges) {
        // Run format checks (requirements + roadmap)
        let formatPassed = true;
        try {
          const { validateRequirementsFormat } = require('../roadmap/requirements-format-checker');
          const { validateRoadmapFormat } = require('../roadmap/roadmap-format-checker');

          const [reqResult, roadmapResult] = await Promise.all([
            validateRequirementsFormat(cliConfig.projectDir).catch(() => null),
            validateRoadmapFormat(cliConfig.projectDir).catch(() => null)
          ]);

          const issues = [];
          if (reqResult && !reqResult.valid) {
            issues.push(...reqResult.errors.map(e => `  requirements: ${e}`));
          }
          if (roadmapResult && !roadmapResult.valid) {
            const roadmapIssues = [...(roadmapResult.nearMisses || []), ...(roadmapResult.errors || [])];
            issues.push(...roadmapIssues.map(e => `  roadmap: ${e}`));
          }

          if (issues.length > 0) {
            formatPassed = false;
            console.log('');
            console.log('  Format checks FAILED:');
            for (const issue of issues) {
              console.log(`    ${issue}`);
            }

            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const choice = await new Promise(resolve =>
              rl.question('\n  [r]e-enter Riley to fix / [p]ush anyway / [q]uit? ', resolve)
            );
            rl.close();

            const c = choice.trim().toLowerCase();
            if (c === 'r') {
              reenter = true;
              continue;
            } else if (c !== 'p') {
              // quit
              console.log('');
              console.log('  Session complete. Changes left uncommitted.');
              await logger.log('info', 'talk_session_ended', { sessionId });
              return 0;
            }
            // 'p': fall through to push prompt
          } else {
            console.log('  Format checks passed.');
          }
        } catch { /* format checker not available — treat as passed */ }

        // Offer to push
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const pushChoice = await new Promise(resolve =>
          rl.question('\n  Push changes to GitHub? [y/n] ', resolve)
        );
        rl.close();

        if (pushChoice.trim().toLowerCase() === 'y') {
          await commitAndPush(cliConfig.projectDir, cliConfig.projectId);
        }
      }
    } catch { /* git check failed, continue with exit */ }
  }

  console.log('');
  console.log('  Session complete.');
  await logger.log('info', 'talk_session_ended', { sessionId });
  return 0;
}

async function saveTalkSession(stateDir, sessionId) {
  if (!sessionId) return;
  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, 'talk-session.json'),
      JSON.stringify({ sessionId, savedAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // Best effort
  }
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

module.exports = { talkCommand, buildTalkContext, buildClaudeArgs, spawnClaudeTerminal };
