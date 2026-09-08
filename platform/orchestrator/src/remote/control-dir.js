const fs = require('fs/promises');
const path = require('path');
const { DEVSHOP_ROOT } = require('../infra/registry');
const { TemplateEngine } = require('../agents/template-engine');

const CONTROL_DIR = path.join(DEVSHOP_ROOT, 'active-agents', 'remote');
const TEMPLATE_PATH = path.join(DEVSHOP_ROOT, 'templates', 'agents', 'remote-control', 'control-claude.md');

function renderProjectList(registry) {
  const projects = registry?.projects || [];
  if (projects.length === 0) return '(no projects registered — use `remote launch kickoff <name>` to create one)';
  return projects.map(p => `- \`${p.id}\` — ${p.name} (${p.projectDir})`).join('\n');
}

/**
 * Permission rules for the control session: the launcher and status
 * commands by absolute path, tmux listing, and read-only tools. Everything
 * else still prompts (and Remote Control forwards the prompt to the phone).
 */
function buildControlSettings(devshopRoot = DEVSHOP_ROOT) {
  const bin = path.join(devshopRoot, 'devshop');
  return {
    permissions: {
      allow: [
        `Bash(${bin} remote:*)`,
        `Bash(${bin} status:*)`,
        'Bash(tmux ls)',
        'Bash(tmux list-sessions:*)',
        'Read',
        'Glob',
        'Grep'
      ]
    }
  };
}

async function renderControlClaudeMd({ registry, devshopRoot = DEVSHOP_ROOT, templatePath = TEMPLATE_PATH }) {
  const template = await fs.readFile(templatePath, 'utf-8');
  const engine = new TemplateEngine(path.dirname(templatePath));
  return engine.renderString(template, {
    PROJECT_LIST: renderProjectList(registry),
    DEVSHOP_ROOT: devshopRoot,
    DEVSHOP_BIN: path.join(devshopRoot, 'devshop')
  });
}

/**
 * (Re)generate the control directory: CLAUDE.md with the current project
 * list, the narrow permission settings, and a logs dir. Idempotent.
 */
async function ensureControlDir({ registry, controlDir = CONTROL_DIR, devshopRoot = DEVSHOP_ROOT, templatePath = TEMPLATE_PATH } = {}) {
  await fs.mkdir(path.join(controlDir, '.claude'), { recursive: true });
  await fs.mkdir(path.join(controlDir, 'logs'), { recursive: true });
  await fs.writeFile(path.join(controlDir, 'CLAUDE.md'), await renderControlClaudeMd({ registry, devshopRoot, templatePath }));
  await fs.writeFile(
    path.join(controlDir, '.claude', 'settings.json'),
    JSON.stringify(buildControlSettings(devshopRoot), null, 2) + '\n'
  );
  return controlDir;
}

module.exports = { CONTROL_DIR, TEMPLATE_PATH, ensureControlDir, renderControlClaudeMd, renderProjectList, buildControlSettings };
