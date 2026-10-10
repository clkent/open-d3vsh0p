const fs = require('fs/promises');
const path = require('path');
const execUtils = require('../infra/exec-utils');

const PROJECTS_DIR = path.join(require('os').homedir(), 'projects');
const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEMPLATES_DIR = path.join(DEVSHOP_ROOT, 'templates', 'project-starter');
const ACTIVE_AGENTS_DIR = path.join(DEVSHOP_ROOT, 'active-agents');

const WORKFLOWS_TEMPLATE_DIR = path.join(TEMPLATES_DIR, '.github', 'workflows');

const WORKFLOW_SCOPE_REMEDY =
  "GitHub token is missing the 'workflow' scope (needed to push .github/workflows/*). " +
  'Run: gh auth refresh -h github.com -s workflow';

const WORKFLOW_SCOPE_REJECTION = /workflow.*scope|refusing to allow an OAuth App/i;

class ProjectScaffolder {
  /**
   * @param {object} logger
   * @param {object} [deps] - injectable dependencies (tests)
   * @param {Function} [deps.execFile] - promisified execFile; defaults to infra/exec-utils
   * @param {Function} [deps.templateHasWorkflows] - async () => boolean
   */
  constructor(logger, deps = {}) {
    this.logger = logger;
    this._execFile = deps.execFile || execUtils.execFile;
    this._templateHasWorkflows = deps.templateHasWorkflows || defaultTemplateHasWorkflows;
  }

  /**
   * Generate a unique project ID by scanning existing IDs in the registry.
   * Format: proj-NNN-<shortName>
   */
  generateProjectId(registry, shortName) {
    const existing = registry.projects
      .map(p => p.id)
      .filter(id => id.startsWith('proj-'))
      .map(id => {
        const match = id.match(/^proj-(\d+)-/);
        return match ? parseInt(match[1], 10) : -1;
      })
      .filter(n => n >= 0);

    const next = existing.length > 0 ? Math.max(...existing) + 1 : 0;
    const padded = String(next).padStart(3, '0');
    return `proj-${padded}-${shortName}`;
  }

  /**
   * Full scaffold pipeline:
   * 1. Verify gh CLI is authenticated
   * 2. Create project directory
   * 3. Create GitHub repo + clone
   * 4. Copy + render template files
   * 5. Create openspec directory structure
   * 6. Initial commit + push
   * 7. Register in project-registry.json
   * 8. Create active-agents directory
   */
  async scaffold(shortName, registry, saveRegistry, options = {}) {
    const projectName = options.projectName || shortName;
    const description = options.description || '';
    const projectId = this.generateProjectId(registry, shortName);
    const projectDir = path.join(PROJECTS_DIR, shortName);
    const githubOwner = await this._getGitHubOwner();
    const githubRepo = `https://github.com/${githubOwner}/${shortName}`;

    await this.logger.log('info', 'kickoff_scaffold_start', { projectId, shortName });

    // Step 1: Verify gh CLI
    await this._verifyGhCli();

    // Step 2: Create projects directory if needed
    await fs.mkdir(PROJECTS_DIR, { recursive: true });

    // Step 3: Create GitHub repo and clone
    await this.logger.log('info', 'kickoff_creating_repo', { shortName });
    try {
      await this._execFile('gh', [
        'repo', 'create', `${githubOwner}/${shortName}`,
        '--private', '--clone'
      ], { cwd: PROJECTS_DIR });
    } catch (err) {
      // If repo already exists, clone it instead
      if (err.stderr && err.stderr.includes('already exists')) {
        await this.logger.log('info', 'kickoff_repo_exists', { shortName });
        try {
          await this._execFile('git', ['clone', `https://github.com/${githubOwner}/${shortName}.git`], {
            cwd: PROJECTS_DIR
          });
        } catch (cloneErr) {
          if (!cloneErr.stderr || !cloneErr.stderr.includes('already exists')) {
            throw cloneErr;
          }
        }
      } else {
        throw new Error(`Failed to create GitHub repo: ${err.stderr || err.message}`);
      }
    }

    // Step 4: Copy + render template files
    await this.logger.log('info', 'kickoff_rendering_templates', { projectDir });
    const vars = {
      PROJECT_NAME: projectName,
      DESCRIPTION: description
    };
    await this._renderTemplates(TEMPLATES_DIR, projectDir, vars);

    // Step 4.5: Configure git hooks
    await this._execFile('git', ['config', 'core.hooksPath', '.githooks'], { cwd: projectDir });
    const hooksDir = path.join(projectDir, '.githooks');
    try {
      const hooks = await fs.readdir(hooksDir);
      for (const hook of hooks) {
        await fs.chmod(path.join(hooksDir, hook), 0o755);
      }
    } catch {
      // No hooks dir — that's fine
    }

    // Step 4.6: Install design skills if requested
    if (options.design) {
      await this._installDesignSkills(projectDir);
    }

    // Step 5: Create openspec directory structure
    await fs.mkdir(path.join(projectDir, 'openspec', 'specs'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'openspec', 'changes'), { recursive: true });

    // Step 6: Initial commit + push
    await this.logger.log('info', 'kickoff_initial_commit', { projectDir });
    await this._commitScaffold(projectDir, projectName);
    await this._pushInitial(projectDir);

    // Step 7: Register in project-registry.json
    const entry = {
      id: projectId,
      name: projectName,
      projectDir,
      githubRepo,
      registeredAt: new Date().toISOString(),
      status: 'active',
      lastSessionId: null,
      schedule: {
        enabled: false
      }
    };
    registry.projects.push(entry);
    await saveRegistry(registry);
    await this.logger.log('info', 'kickoff_registered', { projectId });

    // Step 8: Create active-agents directory
    const logsDir = path.join(ACTIVE_AGENTS_DIR, projectId, 'orchestrator', 'logs');
    await fs.mkdir(logsDir, { recursive: true });

    await this.logger.log('info', 'kickoff_scaffold_complete', { projectId, projectDir, githubRepo });

    return { projectId, projectDir, githubRepo };
  }

  async _getGitHubOwner() {
    const { stdout } = await this._execFile('gh', ['api', 'user', '--jq', '.login']);
    return stdout.trim();
  }

  /**
   * Verify gh is authenticated and the token can push the starter template.
   * GitHub refuses pushes that add/update .github/workflows/* from a token
   * without the `workflow` scope, and `gh auth login` doesn't grant it by
   * default — so check up front, before creating any repo or directory.
   */
  async _verifyGhCli() {
    let output;
    try {
      const { stdout, stderr } = await this._execFile('gh', ['auth', 'status']);
      // gh prints the status report to stderr on older versions, stdout on newer
      output = `${stdout || ''}\n${stderr || ''}`;
    } catch (err) {
      throw new Error(
        'GitHub CLI (gh) is not authenticated. Run `gh auth login` first.\n' +
        (err.stderr || err.message)
      );
    }

    const scopes = parseTokenScopes(output);
    if (scopes === null) {
      await this.logger.log('warn', 'kickoff_scopes_unknown', {
        reason: 'no "Token scopes:" line in gh auth status output'
      });
      return;
    }

    if (await this._templateHasWorkflows() && !scopes.includes('workflow')) {
      await this.logger.log('error', 'kickoff_missing_scope', { scopes, required: 'workflow' });
      throw new Error(WORKFLOW_SCOPE_REMEDY);
    }
  }

  /**
   * Stage and commit the rendered scaffold. A retry after a rejected push
   * already has the scaffold committed; committing a clean tree fails, so
   * skip it and let the caller go straight to push.
   */
  async _commitScaffold(projectDir, projectName) {
    await this._execFile('git', ['add', '-A'], { cwd: projectDir });
    const { stdout } = await this._execFile('git', ['status', '--porcelain'], { cwd: projectDir });
    if ((stdout || '').trim() === '') {
      await this.logger.log('info', 'kickoff_nothing_to_commit', { projectDir });
      return false;
    }
    await this._execFile('git', [
      'commit', '-m', `chore: scaffold ${projectName} via DevShop kickoff`
    ], { cwd: projectDir });
    return true;
  }

  /**
   * Initial scaffold push. Bypasses the pre-push hook (--no-verify) because
   * the remote is empty — there's no upstream main to PR against yet.
   * Maps GitHub's workflow-scope rejection to an actionable error.
   */
  async _pushInitial(projectDir) {
    let lastErr;
    try {
      await this._execFile('git', ['push', '--no-verify', '-u', 'origin', 'main'], { cwd: projectDir });
      return;
    } catch (err) {
      lastErr = err;
    }
    // Try HEAD if main doesn't exist yet
    try {
      await this._execFile('git', ['push', '--no-verify', '-u', 'origin', 'HEAD'], { cwd: projectDir });
      return;
    } catch (err) {
      lastErr = err;
    }
    const stderr = lastErr.stderr || '';
    if (WORKFLOW_SCOPE_REJECTION.test(stderr)) {
      await this.logger.log('error', 'kickoff_push_rejected_scope', { stderr });
      throw new Error(`${WORKFLOW_SCOPE_REMEDY}\n${stderr.trim()}`);
    }
    throw lastErr;
  }

  async _installDesignSkills(projectDir) {
    try {
      await this.logger.log('info', 'design_skills_installing', { projectDir });
      await this._execFile('npx', ['impeccable', 'install', '--providers=claude', '--scope=project'], {
        cwd: projectDir,
        timeout: 60000
      });
      await this.logger.log('info', 'design_skills_installed', { projectDir });
      console.log('  Impeccable design skills installed (.claude/skills/)');
    } catch (err) {
      await this.logger.log('warn', 'design_skills_failed', {
        projectDir,
        error: err.message
      });
      console.error(`  Warning: Could not install design skills: ${err.message}`);
    }
  }

  async _renderTemplates(srcDir, destDir, vars) {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this._renderTemplates(srcPath, destPath, vars);
      } else {
        let content = await fs.readFile(srcPath, 'utf-8');
        for (const [key, value] of Object.entries(vars)) {
          content = content.replaceAll(`{{${key}}}`, value);
        }
        await fs.writeFile(destPath, content);
      }
    }
  }
}

/**
 * Parse the "Token scopes: 'gist', 'read:org', 'repo'" line from gh auth status.
 * Returns an array of scopes, or null if no such line is present.
 */
function parseTokenScopes(output) {
  const match = /Token scopes:\s*(.+)/i.exec(output || '');
  if (!match) return null;
  return match[1]
    .split(',')
    .map(s => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

async function defaultTemplateHasWorkflows() {
  try {
    const entries = await fs.readdir(WORKFLOWS_TEMPLATE_DIR);
    return entries.length > 0;
  } catch {
    return false;
  }
}

module.exports = { ProjectScaffolder, parseTokenScopes, WORKFLOW_SCOPE_REMEDY };
