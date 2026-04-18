const fs = require('fs/promises');
const path = require('path');
const { execFile: execFileAsync } = require('../infra/exec-utils');

const PROJECTS_DIR = path.join(require('os').homedir(), 'projects');
const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEMPLATES_DIR = path.join(DEVSHOP_ROOT, 'templates', 'project-starter');
const ACTIVE_AGENTS_DIR = path.join(DEVSHOP_ROOT, 'active-agents');

class ProjectScaffolder {
  constructor(logger) {
    this.logger = logger;
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
      await execFileAsync('gh', [
        'repo', 'create', `${githubOwner}/${shortName}`,
        '--private', '--clone'
      ], { cwd: PROJECTS_DIR });
    } catch (err) {
      // If repo already exists, clone it instead
      if (err.stderr && err.stderr.includes('already exists')) {
        await this.logger.log('info', 'kickoff_repo_exists', { shortName });
        try {
          await execFileAsync('git', ['clone', `https://github.com/${githubOwner}/${shortName}.git`], {
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
    await execFileAsync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: projectDir });
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
    await execFileAsync('git', ['add', '-A'], { cwd: projectDir });
    await execFileAsync('git', [
      'commit', '-m', `chore: scaffold ${projectName} via DevShop kickoff`
    ], { cwd: projectDir });
    // Initial scaffold push bypasses pre-push hook (--no-verify) because
    // the remote is empty — there's no upstream main to PR against yet.
    try {
      await execFileAsync('git', ['push', '--no-verify', '-u', 'origin', 'main'], { cwd: projectDir });
    } catch {
      // Try HEAD if main doesn't exist yet
      await execFileAsync('git', ['push', '--no-verify', '-u', 'origin', 'HEAD'], { cwd: projectDir });
    }

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
    const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login']);
    return stdout.trim();
  }

  async _verifyGhCli() {
    try {
      await execFileAsync('gh', ['auth', 'status']);
    } catch (err) {
      throw new Error(
        'GitHub CLI (gh) is not authenticated. Run `gh auth login` first.\n' +
        (err.stderr || err.message)
      );
    }
  }

  async _installDesignSkills(projectDir) {
    try {
      await this.logger.log('info', 'design_skills_installing', { projectDir });
      await execFileAsync('npx', ['skills', 'add', 'pbakaus/impeccable', '-y'], {
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

module.exports = { ProjectScaffolder };
