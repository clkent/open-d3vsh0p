const readline = require('readline');
const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const { Logger } = require('../infra/logger');
const { TemplateEngine } = require('../agents/template-engine');
const { ProjectScaffolder } = require('../runners/project-scaffolder');
const { loadConfig } = require('../infra/config');
const { execFile: execFileAsync } = require('../infra/exec-utils');
const { generateSessionId } = require('../session/session-utils');
const { loadProjectContext } = require('./context-loader');
const { spawnClaudeTerminal, saveCliSession } = require('./cli-spawn');
const { loadDevShopContext } = require('../../../pm/src/devshop-context');

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

  // Step 2: Build Riley's system prompt with full DevShop context
  const devshopContext = await loadDevShopContext({ warn: (msg) => console.error(`  Warning: ${msg}`) });
  const projectContext = await loadProjectContext(projectDir);

  const templateVars = {
    PROJECT_ID: projectId,
    PROJECT_DIR: projectDir,
    GITHUB_REPO: githubRepo,
    TECH_STACK: 'Not specified yet',
    PROJECT_CONTEXT: projectContext,
    DEVSHOP_CONTEXT: devshopContext
  };

  const promptPath = path.join(TEMPLATES_DIR, 'pm-agent', 'kickoff-prompt.md');
  const promptTemplate = await fs.readFile(promptPath, 'utf-8');
  const resolvedTemplate = await templateEngine._resolvePartials(promptTemplate);
  const renderedPrompt = templateEngine.renderString(resolvedTemplate, templateVars);

  const kickoffAgentConfig = config.agents?.pm || {};
  const claudeSessionId = randomUUID();

  console.log('  Now tell Riley what you want to build.');
  console.log('  Have a product brief? Drop .md files into:');
  console.log(`    ${projectDir}/context/`);
  console.log('');
  console.log('  Opening Claude Code terminal with Riley...');
  console.log('  Type "go" when ready to create specs and roadmap.');
  console.log('  Use Ctrl+C or /exit to end the session.');
  console.log('==================================');
  console.log('');

  // Step 3: Interactive Riley session via Claude CLI
  const stateDir = path.join(DEVSHOP_ROOT, 'active-agents', '_kickoff');
  let reenter = true;
  let isFirstRun = true;

  while (reenter) {
    reenter = false;

    if (isFirstRun) {
      await spawnClaudeTerminal({
        projectDir,
        appendSystemPrompt: renderedPrompt,
        model: kickoffAgentConfig.model,
        sessionId: claudeSessionId,
        name: `Riley — ${projectId} kickoff`,
        initialPrompt: 'Introduce yourself and ask me what I want to build.'
      }).promise;
      isFirstRun = false;
    } else {
      // Re-enter: continue the most recent session in this project directory
      await spawnClaudeTerminal({
        projectDir,
        continueSession: true,
        model: kickoffAgentConfig.model,
        name: `Riley — ${projectId} kickoff`,
        initialPrompt: 'I re-entered the session because there were validation issues with the specs/roadmap. Please check the openspec/ directory and fix any missing or malformed files.'
      }).promise;
    }

    // Save session for reference
    await saveCliSession(stateDir, claudeSessionId, 'kickoff');

    // Commit Riley's changes before running validation
    try {
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
      if (status.trim()) {
        await execFileAsync('git', ['add', '-A'], { cwd: projectDir });
        await execFileAsync('git', ['commit', '-m', 'wip: kickoff session progress'], { cwd: projectDir });
        console.log('  Changes committed.');
      }
    } catch { /* commit failed — validation will still run on working tree */ }

    // Step 4: Post-session validation
    const validationResult = await validateKickoffOutput(projectDir);

    if (validationResult.passed) {
      console.log('  Validation passed.');
    } else {
      console.log('');
      console.log('  Post-session validation:');
      for (const issue of validationResult.issues) {
        console.log(`    ${issue}`);
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const choice = await new Promise(resolve =>
        rl.question('\n  [r]e-enter Claude to fix / [s]kip validation / [q]uit? ', resolve)
      );
      rl.close();

      const c = choice.trim().toLowerCase();
      if (c === 'r') {
        reenter = true;
        continue;
      } else if (c === 'q') {
        console.log('');
        console.log(`  Exiting. Project "${projectId}" is scaffolded but may have incomplete specs.`);
        await logger.log('info', 'kickoff_session_ended', { sessionId });
        return 0;
      }
      // 's': fall through to bootstrap
    }
  }

  // Step 5: Generate enriched CLAUDE.md from conventions and project info
  try {
    await generateClaudeMd(projectDir);
    console.log('  CLAUDE.md enriched with project conventions.');
  } catch (err) {
    console.error(`  Warning: Could not enrich CLAUDE.md: ${err.message}`);
  }

  // Step 6: Bootstrap — install and configure the tech stack
  const { AgentRunner } = require('../agents/agent-runner');
  const agentRunner = new AgentRunner(logger);

  console.log('');
  console.log('  Setting up tech stack from conventions...');

  const bootstrapResult = await bootstrapProject(agentRunner, templateEngine, {
    templatesDir: TEMPLATES_DIR,
    projectDir,
    projectId
  }, logger);

  if (bootstrapResult.buildPassed) {
    console.log('');
    console.log('  === Project Ready! ===');
    console.log('  Tech stack installed and verified — build and tests pass.');
  } else {
    console.log('');
    console.log('  === Specs Created (bootstrap had issues) ===');
    console.log('  Tech stack setup completed but build verification failed.');
    console.log('  You may need to fix config issues before running the orchestrator.');
  }

  // Step 7: Commit and push
  try {
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
    if (status.trim()) {
      console.log('');
      console.log('  Pushing changes to GitHub...');
      await commitAndPush(projectDir, projectId);
    }
  } catch { /* git check failed */ }

  console.log('');
  await logger.log('info', 'kickoff_session_ended', { sessionId });
  return 0;
}

/**
 * Validate the output of a kickoff session — check for required files and format.
 * Returns { passed, issues } where issues is an array of human-readable strings.
 */
async function validateKickoffOutput(projectDir) {
  const issues = [];

  // Check required files
  const missing = await findMissingFiles(projectDir);
  if (missing.length > 0) {
    for (const m of missing) {
      issues.push(`Missing: ${m}`);
    }
  }

  // Check requirements format
  try {
    const { validateRequirementsFormat } = require('../roadmap/requirements-format-checker');
    const reqResult = await validateRequirementsFormat(projectDir);
    if (!reqResult.valid) {
      for (const err of reqResult.errors) {
        issues.push(`Requirements: ${err}`);
      }
    }
  } catch { /* no project.md */ }

  // Check roadmap format
  try {
    const { validateRoadmapFormat } = require('../roadmap/roadmap-format-checker');
    const fmtResult = await validateRoadmapFormat(projectDir);
    if (!fmtResult.valid) {
      const fmtIssues = [...fmtResult.nearMisses, ...fmtResult.errors,
        ...(fmtResult.missingGroups || []),
        ...(fmtResult.timelineEstimates || []).map(e => `Line ${e.line}: "${e.match}"`)];
      for (const issue of fmtIssues) {
        issues.push(`Roadmap: ${issue}`);
      }
    }
  } catch { /* no roadmap */ }

  return {
    passed: issues.length === 0,
    issues
  };
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
    pmModel: 'claude-sonnet-4-6',
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

  // Detect design skills
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
