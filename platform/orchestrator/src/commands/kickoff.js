const readline = require('readline');
const path = require('path');
const { Logger } = require('../infra/logger');
const { AgentRunner } = require('../agents/agent-runner');
const { TemplateEngine } = require('../agents/template-engine');
const { PmRunner } = require('../../../pm/src/pm-runner');
const { ProjectScaffolder } = require('../runners/project-scaffolder');
const { loadConfig } = require('../infra/config');
const { BroadcastServer } = require('../infra/broadcast-server');
const { execFile: execFileAsync } = require('../infra/exec-utils');
const { generateSessionId } = require('../session/session-utils');
const { loadProjectContext } = require('./context-loader');
const { readMultiLineInput } = require('../infra/prompt-input');

const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEMPLATES_DIR = path.join(DEVSHOP_ROOT, 'templates', 'agents');

async function kickoffCommand(projectName, registry, saveRegistry, options = {}) {
  // Validate project name is kebab-case
  if (!/^[a-z][a-z0-9-]*$/.test(projectName)) {
    console.error(`  Error: project-name must be kebab-case (e.g., "garden-planner", "task-api")`);
    return 1;
  }

  // Check for duplicate
  const existing = registry.projects.find(p => p.id.endsWith(`-${projectName}`));
  if (existing) {
    console.error(`  Error: project "${projectName}" already exists (${existing.id})`);
    return 1;
  }

  console.log('');
  console.log('=== Project Kickoff ===');
  console.log('');
  console.log(`  Scaffolding "${projectName}"...`);

  // Initialize modules
  const sessionId = generateSessionId();
  const logsDir = path.join(DEVSHOP_ROOT, 'active-agents', '_kickoff', 'logs');
  const logger = new Logger(`kickoff-${sessionId}`, logsDir);
  await logger.init();

  const agentRunner = new AgentRunner(logger);
  const templateEngine = new TemplateEngine(TEMPLATES_DIR);
  const config = await loadConfig({});

  // Step 1: Scaffold the project first
  const scaffolder = new ProjectScaffolder(logger);
  let projectId, projectDir, githubRepo;

  try {
    ({ projectId, projectDir, githubRepo } = await scaffolder.scaffold(
      projectName, registry, saveRegistry, { design: options.design }
    ));
  } catch (err) {
    console.error(`  Scaffold failed: ${err.message}`);
    await logger.log('error', 'kickoff_scaffold_failed', { error: err.message });
    return 1;
  }

  console.log('');
  console.log(`  Project scaffolded!`);
  console.log(`    ID:   ${projectId}`);
  console.log(`    Dir:  ${projectDir}`);
  console.log(`    Repo: ${githubRepo}`);
  console.log('');
  console.log('  Now tell Riley what you want to build.');
  console.log('  Have a product brief? Drop .md files into:');
  console.log(`    ${projectDir}/context/`);
  console.log('');
  console.log('  Type your message and press Enter. For multi-line, keep typing — blank line sends.');
  console.log('  Type "go" when ready to create specs and roadmap.');
  console.log('  Type "push" to commit and push changes to GitHub.');
  console.log('  Type "done" to exit (project is already scaffolded).');
  console.log('==================================');
  console.log('');

  // Step 2: Riley Q&A — single session, always in the project directory
  // PmRunner injects DevShop context and sandboxes writes to project directory.
  // Starts with read-only tools during Q&A; restored when the user types "go".
  const agentSession = await PmRunner.createKickoffSession(agentRunner, templateEngine, {
    projectDir,
    projectId,
    githubRepo,
    config,
    warn: (msg) => console.error(`  Warning: ${msg}`)
  });

  // Start broadcast server for watch command
  const broadcastPort = 3100;
  const broadcastServer = new BroadcastServer();
  try {
    await broadcastServer.start(broadcastPort);
    if (broadcastServer.isRunning) {
      console.log(`  Broadcasting on port ${broadcastPort} (use "watch" to monitor)`);
    }
  } catch {
    // Non-fatal — kickoff session continues without broadcast
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let totalCost = 0;
  let turnCount = 0;

  const exitCode = await new Promise((resolve) => {
    const promptLoop = async () => {
      while (true) {
        const input = await readMultiLineInput(rl);
        const trimmed = input.trim();

        if (!trimmed) {
          continue;
        }

        // "push" commits and pushes changes to GitHub
        if (trimmed.toLowerCase() === 'push') {
          console.log('');
          console.log('  Pushing changes to GitHub...');
          await commitAndPush(projectDir, projectId);
          continue;
        }

        // "done" exits — project is already scaffolded
        if (trimmed.toLowerCase() === 'done' || trimmed.toLowerCase() === 'exit') {
          // Check for unpushed changes before exiting
          try {
            const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
            if (status.trim()) {
              console.log('');
              console.log('  You have unpushed changes. Pushing to GitHub...');
              await commitAndPush(projectDir, projectId);
            }
          } catch { /* git check failed, continue with exit */ }

          if (broadcastServer.isRunning) {
            try { await broadcastServer.stop(); } catch {}
          }
          console.log('');
          console.log(`  Exiting. Project "${projectId}" is scaffolded but has no specs yet.`);
          console.log(`  Run \`./devshop plan ${projectId}\` to create specs later.`);
          console.log(`  Cost: $${totalCost.toFixed(2)}`);
          console.log('');
          rl.close();
          resolve(0);
          return;
        }

        // "go" triggers spec generation in the same session
        if (trimmed.toLowerCase() === 'go') {
          if (turnCount === 0) {
            console.log('  Please describe your project first before typing "go".');
            continue;
          }

          // Restore full tools for spec generation — Q&A phase was read-only
          agentSession.config.allowedTools = ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit'];

          try {
            await generateSpecs(agentSession, projectId, projectDir, githubRepo, logger, totalCost, onEvent);
          } catch (err) {
            console.error(`  Error during spec generation: ${err.message}`);
            await logger.log('error', 'kickoff_spec_failed', { error: err.message });
          }
          continue;
        }

        // Normal Q&A turn
        turnCount++;
        console.log('');
        console.log('  Riley is thinking...');

        try {
          // Load context files on first turn (after user has had time to drop files)
          const options = turnCount === 1 ? {
            systemPromptTemplate: 'pm-agent',
            promptFile: 'kickoff-prompt.md',
            templateVars: {
              PROJECT_ID: projectId,
              PROJECT_DIR: projectDir,
              GITHUB_REPO: githubRepo,
              TECH_STACK: 'Not specified yet',
              PROJECT_CONTEXT: await loadProjectContext(projectDir)
            },
            onEvent
          } : { onEvent };

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

    rl.on('close', () => {
      // resolve is idempotent via Promise
    });

    promptLoop();
  });

  await logger.log('info', 'kickoff_session_ended', { totalCost, turnCount });
  return exitCode;
}

/**
 * Generate specs and roadmap — continues the existing Riley session.
 */
async function generateSpecs(agentSession, projectId, projectDir, githubRepo, logger, costSoFar, onEvent) {
  const fs = require('fs/promises');
  const path = require('path');

  console.log('');
  console.log('  Riley is creating specs and roadmap...');

  const specPrompt = `Great — let's do this! Based on everything we've discussed, please create the OpenSpec files for this project now.

Remember:
- Project ID: ${projectId}
- Project directory: ${projectDir}
- GitHub repo: ${githubRepo}

Create all files inside ${projectDir}/openspec/:
1. project.md — project overview, tech stack, and high-level requirements
2. specs/<capability>/spec.md — one spec file per capability
3. roadmap.md — phased implementation plan
4. conventions.md — actionable do/don't rules for the implementation agents (test framework, styling, imports, etc.)

Be thorough — the implementation agents will work directly from these specs and conventions.`;

  const result = await agentSession.chat(specPrompt, { onEvent });
  costSoFar += result.cost || 0;

  if (!result.success) {
    console.error(`  Warning: Spec generation had issues: ${result.error}`);
  }

  // Verify all required files were created, retry if missing
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const missing = await findMissingFiles(projectDir);
    if (missing.length === 0) {
      console.log('');
      console.log('  All specs and roadmap created!');
      break;
    }

    if (attempt === maxRetries - 1) {
      console.error(`  Warning: Still missing after ${maxRetries} attempts: ${missing.join(', ')}`);
      console.error(`  Run \`./devshop plan ${projectId}\` to finish manually.`);
      break;
    }

    console.log(`  Missing files: ${missing.join(', ')}. Asking Riley to continue...`);

    const retryResult = await agentSession.chat(
      `You're not done yet. The following required files are still missing:\n\n${missing.map(f => `- ${f}`).join('\n')}\n\nPlease create them now. All files go inside ${projectDir}/openspec/.`,
      { onEvent }
    );
    costSoFar += retryResult.cost || 0;
  }

  // Validate requirements format — retry if project.md is missing or has unparseable requirements
  const { validateRequirementsFormat, buildRequirementsFixPrompt } = require('../roadmap/requirements-format-checker');
  const maxReqRetries = 3;
  for (let attempt = 0; attempt < maxReqRetries; attempt++) {
    const reqResult = await validateRequirementsFormat(projectDir);
    if (reqResult.valid) {
      if (attempt > 0) {
        console.log('  Requirements format is now valid!');
      }
      break;
    }

    if (attempt === maxReqRetries - 1) {
      console.error(`  Warning: Requirements format still invalid after ${maxReqRetries} attempts.`);
      console.error(`  Issues: ${reqResult.errors.join('; ')}`);
      console.error(`  Run \`./devshop plan ${projectId}\` to fix manually.`);
      break;
    }

    console.log(`  Requirements format has ${reqResult.errors.length} issue(s). Asking Riley to fix...`);

    const fixPrompt = buildRequirementsFixPrompt(reqResult, projectDir);
    const fixResult = await agentSession.chat(fixPrompt, { onEvent });
    costSoFar += fixResult.cost || 0;
  }

  // Validate roadmap format — retry if Riley used freeform items instead of the required format
  const { validateRoadmapFormat, buildRoadmapFixPrompt } = require('../roadmap/roadmap-format-checker');
  const maxFormatRetries = 3;
  for (let attempt = 0; attempt < maxFormatRetries; attempt++) {
    const fmtResult = await validateRoadmapFormat(projectDir);
    if (fmtResult.valid) {
      if (attempt > 0) {
        console.log('  Roadmap format is now valid!');
      }
      break;
    }

    if (attempt === maxFormatRetries - 1) {
      const issues = [...fmtResult.nearMisses, ...fmtResult.errors, ...(fmtResult.missingGroups || []),
        ...(fmtResult.timelineEstimates || []).map(e => `Line ${e.line}: "${e.match}"`)];
      console.error(`  Warning: Roadmap format still invalid after ${maxFormatRetries} attempts.`);
      console.error(`  Issues: ${issues.join('; ')}`);
      console.error(`  Run \`./devshop plan ${projectId}\` to fix manually.`);
      break;
    }

    const issueCount = fmtResult.nearMisses.length + fmtResult.errors.length
      + (fmtResult.missingGroups?.length || 0)
      + (fmtResult.timelineEstimates?.length || 0);
    console.log(`  Roadmap has ${issueCount} format issue(s). Asking Riley to fix...`);

    const fixPrompt = buildRoadmapFixPrompt(fmtResult, projectDir);
    const fixResult = await agentSession.chat(fixPrompt, { onEvent });
    costSoFar += fixResult.cost || 0;
  }

  // Generate enriched CLAUDE.md from conventions and project info
  try {
    await generateClaudeMd(projectDir);
    console.log('  CLAUDE.md enriched with project conventions.');
  } catch (err) {
    console.error(`  Warning: Could not enrich CLAUDE.md: ${err.message}`);
  }

  // Bootstrap: install and configure the tech stack specified in conventions
  console.log('');
  console.log('  Setting up tech stack from conventions...');

  const bootstrapResult = await bootstrapProject(agentSession.agentRunner, agentSession.templateEngine, {
    templatesDir: TEMPLATES_DIR,
    projectDir: projectDir,
    projectId: projectId
  }, logger);

  costSoFar += bootstrapResult.cost || 0;

  if (bootstrapResult.buildPassed) {
    console.log('');
    console.log('  === Project Ready! ===');
    console.log('  Tech stack installed and verified — build and tests pass.');
    console.log(`  Total cost: $${costSoFar.toFixed(2)}`);
  } else {
    console.log('');
    console.log('  === Specs Created (bootstrap had issues) ===');
    console.log('  Tech stack setup completed but build verification failed.');
    console.log('  You may need to fix config issues before running the orchestrator.');
    console.log(`  Total cost: $${costSoFar.toFixed(2)}`);
  }
  console.log('');
  console.log('  Type "push" to commit and push to GitHub.');
  console.log('  Type "done" to exit without pushing.');
  console.log('');

  return 0;
}

/**
 * Bootstrap the project tech stack based on conventions.md.
 * Uses a dedicated agent to install dependencies, create config files,
 * and verify the build passes.
 */
async function bootstrapProject(agentRunner, templateEngine, config, logger) {
  const { AgentSession } = require('../agents/agent-session');

  const bootstrapSession = new AgentSession(agentRunner, templateEngine, {
    templatesDir: config.templatesDir,
    projectDir: config.projectDir,
    pmModel: 'claude-sonnet-4-20250514',
    pmBudgetUsd: 5,
    pmTimeoutMs: 600000,
    allowedTools: ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit']
  });

  let cost = 0;
  let buildPassed = false;

  try {
    await logger.log('info', 'bootstrap_started', { projectId: config.projectId });

    const result = await bootstrapSession.chat(
      'Read the conventions and project files, then set up the entire tech stack. Install all dependencies, create all config files, wire up package.json scripts, create a smoke test, and verify with npm run build and npm test.',
      {
        systemPromptTemplate: 'pm-agent',
        promptFile: 'bootstrap-prompt.md',
        templateVars: {
          PROJECT_ID: config.projectId,
          PROJECT_DIR: config.projectDir
        }
      }
    );

    cost = result.cost || 0;

    // Verify build after bootstrap
    try {
      await execFileAsync('npm', ['run', 'build'], {
        cwd: config.projectDir,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      });
      await execFileAsync('npm', ['test'], {
        cwd: config.projectDir,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      });

      buildPassed = true;
      await logger.log('info', 'bootstrap_verified', { projectId: config.projectId, cost });
      console.log('  Build and tests pass!');
    } catch (verifyErr) {
      await logger.log('warn', 'bootstrap_verify_failed', {
        projectId: config.projectId,
        error: verifyErr.stderr ? verifyErr.stderr.slice(0, 2000) : verifyErr.message
      });
      console.error(`  Build verification failed: ${verifyErr.message}`);
    }
  } catch (err) {
    await logger.log('error', 'bootstrap_failed', {
      projectId: config.projectId,
      error: err.message
    });
    console.error(`  Bootstrap error: ${err.message}`);
  }

  return { cost, buildPassed };
}

/**
 * Check which required openspec files are missing.
 * Returns an array of human-readable descriptions of missing files.
 */
async function findMissingFiles(projectDir) {
  const fs = require('fs/promises');
  const path = require('path');
  const missing = [];

  // Check project.md
  try {
    await fs.access(path.join(projectDir, 'openspec', 'project.md'));
  } catch {
    missing.push('openspec/project.md');
  }

  // Check roadmap.md
  try {
    await fs.access(path.join(projectDir, 'openspec', 'roadmap.md'));
  } catch {
    missing.push('openspec/roadmap.md');
  }

  // Check conventions.md
  try {
    await fs.access(path.join(projectDir, 'openspec', 'conventions.md'));
  } catch {
    missing.push('openspec/conventions.md');
  }

  // Check that at least one spec exists
  try {
    const specsDir = path.join(projectDir, 'openspec', 'specs');
    const entries = await fs.readdir(specsDir, { withFileTypes: true });
    const specDirs = entries.filter(e => e.isDirectory());

    if (specDirs.length === 0) {
      missing.push('openspec/specs/ (no spec directories found)');
    } else {
      // Check each spec dir has a spec.md
      for (const dir of specDirs) {
        try {
          await fs.access(path.join(specsDir, dir.name, 'spec.md'));
        } catch {
          missing.push(`openspec/specs/${dir.name}/spec.md`);
        }
      }
    }
  } catch {
    missing.push('openspec/specs/ (directory missing)');
  }

  return missing;
}

/**
 * Validate a project name is kebab-case.
 */
function isValidProjectName(name) {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

/**
 * Commit and push changes via feature branch + PR.
 */
async function commitAndPush(projectDir, projectId) {
  try {
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
    if (!status.trim()) {
      console.log('  No changes to commit.');
      return;
    }

    const branchName = `feat/specs-${Date.now()}`;
    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: projectDir });
    await execFileAsync('git', ['add', '-A'], { cwd: projectDir });
    await execFileAsync('git', [
      'commit', '-m', 'feat: add OpenSpec specs and roadmap'
    ], { cwd: projectDir });
    await execFileAsync('git', ['push', '-u', 'origin', branchName], { cwd: projectDir });

    const { stdout: prUrl } = await execFileAsync('gh', [
      'pr', 'create',
      '--title', `feat(${projectId}): add specs and roadmap`,
      '--body', 'Specs and roadmap created/updated via DevShop.\n\n🤖 Generated with DevShop'
    ], { cwd: projectDir });

    console.log(`  PR created: ${prUrl.trim()}`);

    await execFileAsync('gh', ['pr', 'merge', '--merge'], { cwd: projectDir });
    await execFileAsync('git', ['checkout', 'main'], { cwd: projectDir });
    await execFileAsync('git', ['pull'], { cwd: projectDir });
    console.log('  PR merged.');
  } catch (err) {
    console.error(`  Warning: Git commit/push failed: ${err.message}`);
  }
}

/**
 * Generate an enriched CLAUDE.md from conventions.md and project.md.
 * Reads existing files and builds a comprehensive CLAUDE.md that Claude Code
 * will natively pick up, so orchestrator-injected prompts can stay minimal.
 */
async function generateClaudeMd(projectDir) {
  const fs = require('fs/promises');
  const path = require('path');

  // Read project name from directory
  const projectName = path.basename(projectDir);

  // Read conventions if available
  let conventions = '';
  try {
    conventions = await fs.readFile(path.join(projectDir, 'openspec', 'conventions.md'), 'utf-8');
  } catch { /* no conventions yet */ }

  // Read project.md for tech stack summary
  let techStack = '';
  try {
    const projectMd = await fs.readFile(path.join(projectDir, 'openspec', 'project.md'), 'utf-8');
    // Extract tech stack section if present
    const stackMatch = projectMd.match(/##\s*Tech(?:nology)?\s*Stack([\s\S]*?)(?=\n##|\n$|$)/i);
    if (stackMatch) {
      techStack = stackMatch[1].trim();
    }
  } catch { /* no project.md yet */ }

  // Read gotchas if available
  let gotchas = '';
  try {
    gotchas = await fs.readFile(path.join(projectDir, 'openspec', 'gotchas.md'), 'utf-8');
  } catch { /* no gotchas yet */ }

  // Build CLAUDE.md
  let content = `# ${projectName} — Claude Code Instructions\n\n`;

  content += `## Git Workflow\n\n`;
  content += `**Never push directly to main.** All changes must go through feature branches and pull requests.\n\n`;
  content += `1. Create a feature branch: \`git checkout -b <type>/<description>\`\n`;
  content += `2. Make commits on the feature branch\n`;
  content += `3. Push the branch: \`git push -u origin <branch-name>\`\n`;
  content += `4. Create a PR: \`gh pr create --title "..." --body "..."\`\n\n`;
  content += `Branch types: feat, fix, chore, docs, refactor, test\n\n`;

  content += `## Testing\n\n`;
  content += `Run tests before committing: \`npm test\`\n\n`;

  content += `## Project Standards\n\n`;
  content += `Read \`openspec/conventions.md\` for the full project conventions — test framework, styling, imports, project structure, and patterns.\n\n`;

  // Detect design skills (works whether installed via --design or manually)
  let hasDesignSkills = false;
  try {
    await fs.access(path.join(projectDir, '.claude', 'skills', 'frontend-design'));
    hasDesignSkills = true;
  } catch { /* no design skills */ }

  if (hasDesignSkills) {
    content += `## Design Skills\n\n`;
    content += `This project has Impeccable design skills installed. Use \`/polish\`, \`/audit\`, \`/critique\`, \`/typeset\`, \`/arrange\`, and other design commands when working on UI code. See \`.claude/skills/\` for available commands.\n\n`;
  } else if (techStack && isFrontendTechStack(techStack)) {
    console.log('  Tip: This looks like a frontend project. Consider re-running with --design to install design skills.');
  }

  if (techStack) {
    content += `## Tech Stack\n\n${techStack}\n\n`;
  }

  if (gotchas) {
    content += `## Gotchas\n\n`;
    content += `See \`openspec/gotchas.md\` for known pitfalls and surprising patterns in this project.\n\n`;
  }

  content += `## Project Specs\n\n`;
  content += `See \`openspec/\` for project specifications, roadmap, and change proposals.\n`;

  await fs.writeFile(path.join(projectDir, 'CLAUDE.md'), content);
}

const FRONTEND_KEYWORDS = ['react', 'next', 'vue', 'svelte', 'angular', 'react native', 'expo', 'remix', 'nuxt', 'astro'];

function isFrontendTechStack(techStack) {
  const lower = techStack.toLowerCase();
  return FRONTEND_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = { kickoffCommand, isValidProjectName, findMissingFiles, bootstrapProject, generateClaudeMd, isFrontendTechStack };
