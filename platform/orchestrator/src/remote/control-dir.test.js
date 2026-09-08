const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { ensureControlDir, renderProjectList, buildControlSettings, renderControlClaudeMd } = require('./control-dir');

const registry = {
  projects: [
    { id: 'proj-001-alpha', name: 'alpha', projectDir: '/tmp/projects/alpha' },
    { id: 'proj-002-beta', name: 'beta', projectDir: '/tmp/projects/beta' }
  ]
};

describe('control-dir', () => {
  it('renders the project list with IDs and directories', () => {
    const list = renderProjectList(registry);
    assert.match(list, /`proj-001-alpha` — alpha \(\/tmp\/projects\/alpha\)/);
    assert.match(list, /`proj-002-beta`/);
    assert.match(renderProjectList({ projects: [] }), /no projects registered/);
  });

  it('builds a narrow permission allow list with absolute devshop paths', () => {
    const settings = buildControlSettings('/opt/devshop');
    const allow = settings.permissions.allow;
    assert.ok(allow.includes('Bash(/opt/devshop/devshop remote:*)'));
    assert.ok(allow.includes('Bash(/opt/devshop/devshop status:*)'));
    assert.ok(allow.includes('Read'));
    assert.ok(!allow.includes('Bash'), 'no blanket Bash allowance');
    assert.ok(!allow.some(a => /^Bash\(\*\)|^Write|^Edit/.test(a)));
  });

  it('renders CLAUDE.md from the template with the project list and paths', async () => {
    const md = await renderControlClaudeMd({ registry, devshopRoot: '/opt/devshop' });
    assert.match(md, /proj-001-alpha/);
    assert.match(md, /\/opt\/devshop\/devshop remote launch run <project-id>/);
    assert.ok(!md.includes('{{'), 'no unresolved placeholders');
  });

  it('ensureControlDir writes CLAUDE.md, settings, and logs dir, and regenerates on the next call', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'control-'));
    await ensureControlDir({ registry, controlDir: dir, devshopRoot: '/opt/devshop' });
    const md1 = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf-8');
    assert.match(md1, /proj-002-beta/);
    const settings = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf-8'));
    assert.ok(settings.permissions.allow.includes('Bash(/opt/devshop/devshop remote:*)'));
    await fs.access(path.join(dir, 'logs'));

    await ensureControlDir({ registry: { projects: [registry.projects[0]] }, controlDir: dir, devshopRoot: '/opt/devshop' });
    const md2 = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf-8');
    assert.ok(!md2.includes('proj-002-beta'), 'stale project removed on regeneration');
  });
});
