const readline = require('readline');
const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const { Logger } = require('../infra/logger');
const { TemplateEngine } = require('../agents/template-engine');
const { OpenSpecReader } = require('../roadmap/openspec-reader');
const { RoadmapReader } = require('../roadmap/roadmap-reader');
const { loadConfig } = require('../infra/config');
const { execFile: execFileAsync } = require('../infra/exec-utils');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');
const { spawnClaudeTerminal, saveCliSession, loadCliSession } = require('./cli-spawn');

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

  const templateEngine = new TemplateEngine(cliConfig.templatesDir);
  const openspec = new OpenSpecReader(cliConfig.projectDir);
  const roadmapReader = new RoadmapReader(cliConfig.projectDir);

  // Gather context for Riley
  let techStack = 'Not specified';
  try { techStack = await openspec.parseTechStack(); } catch {}

  let progressContext = '';

  // Read orchestrator state
  const stateDir = path.join(cliConfig.activeAgentsDir, 'orchestrator');
  const stateFilePath = path.join(stateDir, 'state.json');
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

  // Render system prompt
  const talkAgentConfig = config.agents?.pm || {};
  const templateVars = {
    PROJECT_ID: cliConfig.projectId,
    PROJECT_DIR: cliConfig.projectDir,
    TECH_STACK: techStack,
    GITHUB_REPO: cliConfig.githubRepo || '',
    REQUIREMENTS: `You are in a mid-project conversation. Here is the current project progress:\n${progressContext}\n\nThe developer wants to discuss the project. Listen carefully, and if they want to update specs or roadmap, make the changes directly.`
  };

  const renderedPrompt = await templateEngine.renderAgentPrompt('pm-agent', templateVars);

  // Determine session: resume or new
  let claudeSessionId = null;
  let resumeSessionId = null;

  if (cliConfig.resume) {
    resumeSessionId = await loadCliSession(stateDir, 'talk');
    if (resumeSessionId) {
      console.log('  Resuming previous talk session...');
      console.log('');
    }
  }

  if (!resumeSessionId) {
    claudeSessionId = randomUUID();
  }

  // Display banner
  console.log('  Riley has context about your project\'s current progress.');
  console.log('  Opening Claude Code terminal with project context...');
  console.log('  Use Ctrl+C or /exit to end the session.');
  console.log('=====================');
  console.log('');

  // Main session loop (supports re-entry for format fix)
  let reenter = true;
  while (reenter) {
    reenter = false;

    await spawnClaudeTerminal({
      projectDir: cliConfig.projectDir,
      appendSystemPrompt: renderedPrompt,
      model: talkAgentConfig.model,
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
    await saveCliSession(stateDir, activeSessionId, 'talk');

    // Post-session: validate format and handle changes
    try {
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: cliConfig.projectDir });
      const hasChanges = status.trim().length > 0;

      if (hasChanges) {
        // Run format validators
        let formatPassed = true;
        const formatIssues = [];

        try {
          const { validateRoadmapFormat } = require('../roadmap/roadmap-format-checker');
          const fmtResult = await validateRoadmapFormat(cliConfig.projectDir);
          if (!fmtResult.valid) {
            formatPassed = false;
            const issues = [...fmtResult.nearMisses, ...fmtResult.errors,
              ...(fmtResult.missingGroups || []),
              ...(fmtResult.timelineEstimates || []).map(e => `Line ${e.line}: "${e.match}"`)];
            formatIssues.push(`Roadmap: ${issues.join('; ')}`);
          }
        } catch { /* no roadmap */ }

        try {
          const { validateRequirementsFormat } = require('../roadmap/requirements-format-checker');
          const reqResult = await validateRequirementsFormat(cliConfig.projectDir);
          if (!reqResult.valid) {
            formatPassed = false;
            formatIssues.push(`Requirements: ${reqResult.errors.join('; ')}`);
          }
        } catch { /* no project.md */ }

        if (!formatPassed) {
          console.log('');
          console.log('  Format validation FAILED:');
          for (const issue of formatIssues) {
            console.log(`    ${issue}`);
          }

          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const choice = await new Promise(resolve =>
            rl.question('\n  [r]e-enter Claude to fix / [p]ush anyway / [q]uit? ', resolve)
          );
          rl.close();

          const c = choice.trim().toLowerCase();
          if (c === 'r') {
            reenter = true;
            continue;
          } else if (c !== 'p') {
            console.log('');
            console.log('  Session complete. Changes left uncommitted.');
            await logger.log('info', 'talk_session_ended', { sessionId });
            return 0;
          }
        }

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
