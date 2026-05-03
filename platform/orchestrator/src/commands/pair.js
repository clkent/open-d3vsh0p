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
 * Build project context string for Morgan's pair session.
 * Reads orchestrator state, roadmap progress, and parked items from the latest session summary.
 */
async function buildPairContext({ stateDir, logsDir, roadmapReader }) {
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
 * Pure function — easy to test without spawning a process.
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

async function pairCommand(project, cliConfig) {
  console.log('');
  console.log('=== Pair with Morgan ===');
  console.log(`  Project: ${project.name} (${project.id})`);
  console.log('');

  // Initialize modules
  const config = await loadConfig(cliConfig);
  const sessionId = generateSessionId('pair');
  const { logsDir } = getOrchestratorPaths(cliConfig);
  const logger = new Logger(sessionId, logsDir);
  await logger.init();

  const templateEngine = new TemplateEngine(cliConfig.templatesDir);
  const openspec = new OpenSpecReader(cliConfig.projectDir);
  const roadmapReader = new RoadmapReader(cliConfig.projectDir);

  // Gather project context for Morgan
  let techStack = 'Not specified';
  try { techStack = await openspec.parseTechStack(); } catch {}

  const stateDir = path.join(cliConfig.activeAgentsDir, 'orchestrator');
  const progressContext = await buildPairContext({ stateDir, logsDir, roadmapReader });

  const pairAgentConfig = config.agents?.['pair'] || config.agents?.['principal-engineer'];

  // Render the pair prompt template
  const templateVars = {
    PROJECT_ID: cliConfig.projectId,
    PROJECT_DIR: cliConfig.projectDir,
    TECH_STACK: techStack,
    GITHUB_REPO: cliConfig.githubRepo || '',
    REQUIREMENTS: progressContext
      ? `Here is the current project state for diagnostic context:\n${progressContext}`
      : ''
  };

  const promptPath = path.join(cliConfig.templatesDir, 'principal-engineer', 'pair-prompt.md');
  const promptTemplate = await fs.readFile(promptPath, 'utf-8');
  const renderedPrompt = templateEngine.renderString(promptTemplate, templateVars);

  // Determine Claude session ID for tracking / resume
  let claudeSessionId = null;
  let resumeSessionId = null;

  if (cliConfig.resume) {
    try {
      const raw = await fs.readFile(path.join(stateDir, 'pair-session.json'), 'utf-8');
      const state = JSON.parse(raw);
      if (state.sessionId) {
        resumeSessionId = state.sessionId;
        console.log('  Resuming previous pair session...');
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
  console.log('  Morgan has context about your project\'s current state.');
  console.log('  Opening Claude Code terminal with project context...');
  console.log('  Use Ctrl+C or /exit to end the session.');
  console.log('=====================');
  console.log('');

  // Main session loop (supports re-entry for health check fixes)
  let reenter = true;
  while (reenter) {
    reenter = false;

    await spawnClaudeTerminal({
      projectDir: cliConfig.projectDir,
      appendSystemPrompt: renderedPrompt,
      model: pairAgentConfig?.model,
      sessionId: claudeSessionId,
      resume: resumeSessionId,
      name: `Morgan — ${cliConfig.projectId}`
    });

    // After first run, any re-entry is a resume
    const activeSessionId = claudeSessionId || resumeSessionId;
    if (claudeSessionId) {
      resumeSessionId = claudeSessionId;
      claudeSessionId = null;
    }

    // Save session for future resume
    await savePairSession(stateDir, activeSessionId);

    // Post-session: check for changes and health
    try {
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: cliConfig.projectDir });
      const hasChanges = status.trim().length > 0;

      if (hasChanges) {
        let healthPassed = true;

        try {
          const healthChecker = require('../quality/health-checker');
          const hcConfig = await healthChecker.resolveHealthCheckConfig(cliConfig.projectDir, {});

          if (hcConfig.commands.length > 0) {
            console.log('');
            console.log('  Running health checks...');
            const hcResult = await healthChecker.runHealthCheck(cliConfig.projectDir, hcConfig);

            if (!hcResult.passed) {
              healthPassed = false;
              console.log('');
              console.log('  Health checks FAILED:');
              for (const r of hcResult.results) {
                if (r.exitCode !== 0) {
                  console.log(`    ${r.command} (exit ${r.exitCode})`);
                  if (r.stderr) {
                    console.log(`    ${r.stderr.slice(-500).replace(/\n/g, '\n    ')}`);
                  }
                }
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
                // quit
                console.log('');
                console.log('  Session complete. Changes left uncommitted.');
                await logger.log('info', 'pair_session_ended', { sessionId });
                return 0;
              }
              // 'p': fall through to push prompt
            } else {
              console.log('  Health checks passed.');
            }
          }
        } catch { /* no health checker configured — treat as passed */ }

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

  // Check for unmerged orchestrator session branches and offer to consolidate
  await consolidateStaleSessionBranches(cliConfig.projectDir, cliConfig.projectId);

  console.log('');
  console.log('  Session complete.');
  await logger.log('info', 'pair_session_ended', { sessionId });
  return 0;
}

async function savePairSession(stateDir, sessionId) {
  if (!sessionId) return;
  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, 'pair-session.json'),
      JSON.stringify({ sessionId, savedAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // Best effort
  }
}

/**
 * Commit and push any changes Morgan made during the pair session.
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

    // Run health checks before committing
    const healthChecker = require('../quality/health-checker');
    const hcConfig = await healthChecker.resolveHealthCheckConfig(projectDir, {});

    if (hcConfig.commands.length > 0) {
      console.log('');
      console.log('  Running health checks before commit...');
      const hcResult = await healthChecker.runHealthCheck(projectDir, hcConfig);

      if (!hcResult.passed) {
        console.log('');
        console.log('  Health checks FAILED — not committing.');
        for (const r of hcResult.results) {
          if (r.exitCode !== 0) {
            console.log(`    ${r.command} (exit ${r.exitCode})`);
            if (r.stderr) {
              console.log(`    ${r.stderr.slice(-500).replace(/\n/g, '\n    ')}`);
            }
          }
        }
        console.log('');
        console.log('  Fix these issues first, then try "push" again.');
        return;
      }
      console.log('  Health checks passed.');
    }

    const branchName = `fix/pair-${Date.now()}`;
    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: projectDir });
    await execFileAsync('git', ['add', '-A'], { cwd: projectDir });
    await execFileAsync('git', [
      'commit', '-m', 'fix: changes from pair session with Morgan'
    ], { cwd: projectDir });
    await execFileAsync('git', ['push', '-u', 'origin', branchName], { cwd: projectDir });

    const { stdout: prUrl } = await execFileAsync('gh', [
      'pr', 'create',
      '--title', `fix(${projectId}): pair session fixes`,
      '--body', 'Fixes from interactive pair session with Morgan.\n\n🤖 Generated with DevShop'
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

/**
 * Check for unmerged orchestrator session branches with work ahead of main.
 * Offers to consolidate each one so completed work doesn't get lost on next run.
 */
async function consolidateStaleSessionBranches(projectDir, projectId) {
  try {
    // Find local devshop/session-* branches
    const { stdout: branchList } = await execFileAsync(
      'git', ['branch', '--list', 'devshop/session-*', '--format=%(refname:short)'],
      { cwd: projectDir }
    );
    const sessionBranches = branchList.trim().split('\n').filter(Boolean);
    if (sessionBranches.length === 0) return;

    // Check which have commits ahead of main
    const staleBranches = [];
    for (const branch of sessionBranches) {
      try {
        const { stdout: log } = await execFileAsync(
          'git', ['log', '--oneline', `main..${branch}`],
          { cwd: projectDir }
        );
        if (log.trim()) {
          const commitCount = log.trim().split('\n').length;
          staleBranches.push({ branch, commitCount });
        }
      } catch {
        // Branch comparison failed — skip
      }
    }

    if (staleBranches.length === 0) return;

    console.log('');
    console.log('  Unmerged session branches with work:');
    for (const { branch, commitCount } of staleBranches) {
      console.log(`    ${branch} (${commitCount} commit${commitCount > 1 ? 's' : ''} ahead)`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const choice = await new Promise(resolve =>
      rl.question('\n  Consolidate these to main? [y/n] ', resolve)
    );
    rl.close();

    if (choice.trim().toLowerCase() !== 'y') return;

    const { GitOps } = require('../git/git-ops');
    const logger = { log: async () => {}, logCommit: async () => {}, logMerge: async () => {} };
    const gitOps = new GitOps(logger);

    // Ensure we're on main before consolidating
    await execFileAsync('git', ['checkout', 'main'], { cwd: projectDir });
    await execFileAsync('git', ['pull', 'origin', 'main'], { cwd: projectDir, timeout: 120000 });

    for (const { branch } of staleBranches) {
      try {
        await gitOps.consolidateToMain(projectDir, branch, {
          projectId,
          completed: [],
          parked: []
        });
        console.log(`    Consolidated ${branch}`);
      } catch (err) {
        console.log(`    Failed to consolidate ${branch}: ${err.message}`);
      }
    }
  } catch {
    // Non-critical — don't block pair exit
  }
}

module.exports = { pairCommand, buildPairContext, buildClaudeArgs, spawnClaudeTerminal };
