const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { findNearMisses, findHeadingLevelIssues, findMissingGroups, validateRoadmapFormat, buildRoadmapFixPrompt } = require('./roadmap-format-checker');
const { RoadmapReader } = require('./roadmap-reader');

describe('findNearMisses', () => {
  it('returns empty for valid items', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [x] \`setup-auth\` — Add auth module
- [!] \`setup-cache\` — Add caching layer
`;
    assert.deepEqual(findNearMisses(content), []);
  });

  it('detects freeform checkbox lines without backtick IDs', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] Create basic Swift project
- [ ] Set up database schema
`;
    const misses = findNearMisses(content);
    assert.equal(misses.length, 2);
    assert.ok(misses[0].includes('Line 4'));
    assert.ok(misses[0].includes('Create basic Swift project'));
    assert.ok(misses[0].includes('missing `kebab-id` in backticks'));
    assert.ok(misses[1].includes('Line 5'));
  });

  it('detects missing backticks with em-dash present', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] setup-db — Initialize database
`;
    const misses = findNearMisses(content);
    assert.equal(misses.length, 1);
    assert.ok(misses[0].includes('missing `kebab-id` in backticks'));
  });

  it('detects missing em-dash with backticks present', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` Initialize database
`;
    const misses = findNearMisses(content);
    assert.equal(misses.length, 1);
    assert.ok(misses[0].includes('missing em-dash'));
  });

  it('ignores non-checkbox lines', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
Some random text about tasks
- Not a checkbox item
* Also not a checkbox
`;
    assert.deepEqual(findNearMisses(content), []);
  });

  it('reports correct line numbers', () => {
    const content = `# Roadmap: Test

## Phase I: Foundation
### Group A: Core
- [ ] \`valid-item\` — This is fine
- [ ] Create something without an ID
- [x] \`another-valid\` — Also fine
- [ ] Another freeform task
`;
    const misses = findNearMisses(content);
    assert.equal(misses.length, 2);
    assert.ok(misses[0].includes('Line 6'));
    assert.ok(misses[1].includes('Line 8'));
  });

  it('handles double-dash separator as valid', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` -- Initialize database
`;
    assert.deepEqual(findNearMisses(content), []);
  });

  it('handles single-dash separator as valid', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` - Initialize database
`;
    assert.deepEqual(findNearMisses(content), []);
  });

  it('detects mixed valid and invalid items', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [ ] Build the authentication system
- [x] \`setup-auth\` — Add auth module
- [ ] Add caching layer for performance
`;
    const misses = findNearMisses(content);
    assert.equal(misses.length, 2);
    assert.ok(misses[0].includes('Line 5'));
    assert.ok(misses[1].includes('Line 7'));
  });
});

describe('validateRoadmapFormat', () => {
  let tmpDir;

  async function writeRoadmap(content) {
    const openspecDir = path.join(tmpDir, 'openspec');
    await fs.mkdir(openspecDir, { recursive: true });
    await fs.writeFile(path.join(openspecDir, 'roadmap.md'), content);
  }

  async function writeSpecs(specNames) {
    for (const name of specNames) {
      const specDir = path.join(tmpDir, 'openspec', 'specs', name);
      await fs.mkdir(specDir, { recursive: true });
      await fs.writeFile(path.join(specDir, 'spec.md'), `# ${name}\n`);
    }
  }

  it('returns error when roadmap file is missing', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    const result = await validateRoadmapFormat(tmpDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('not found'));
    assert.deepEqual(result.nearMisses, []);
    assert.deepEqual(result.headingIssues, []);
  });

  it('passes for a valid roadmap', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: Test Project

## Phase I: Foundation
### Group A: Core Setup
- [ ] \`setup-db\` — Initialize database schema
- [x] \`setup-auth\` — Add authentication module

### Group B: API Layer
- [ ] \`api-routes\` — Create REST endpoints

## Phase II: Features
<!-- depends: Phase I -->
### Group A: User Features
- [ ] \`user-profile\` — User profile page
`);
    const result = await validateRoadmapFormat(tmpDir);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.nearMisses, []);
    assert.deepEqual(result.headingIssues, []);
  });

  it('fails for freeform items', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: Bad Project

## Phase I: Foundation
### Group A: Core Setup
- [ ] Create the database schema
- [ ] Set up authentication
`);
    const result = await validateRoadmapFormat(tmpDir);
    assert.equal(result.valid, false);
    assert.equal(result.nearMisses.length, 2);
  });

  it('combines near-misses and structural errors', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: Mixed Issues

## Phase I: Foundation
### Group A: Core Setup
- [ ] \`BadId\` — Uppercase ID
- [ ] Build the auth system
`);
    const result = await validateRoadmapFormat(tmpDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0, 'should have structural errors');
    assert.ok(result.nearMisses.length > 0, 'should have near-misses');
  });

  it('detects wrong heading levels and returns headingIssues', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: Wrong Levels
### Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Work
`);
    const result = await validateRoadmapFormat(tmpDir);
    assert.equal(result.valid, false);
    assert.ok(result.headingIssues.length > 0);
    assert.ok(result.headingIssues[0].includes('Phase I'));
  });

  it('warns when roadmap items < spec count', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: Bundled
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [ ] \`setup-auth\` — Add auth
`);
    await writeSpecs(['database', 'auth', 'api', 'users', 'settings']);

    const result = await validateRoadmapFormat(tmpDir);
    assert.ok(result.warnings.some(w =>
      w.includes('2 items') && w.includes('5 specs') && w.includes('bundled')
    ));
  });

  it('does not warn when items >= specs', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: Enough
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [ ] \`setup-auth\` — Add auth
- [ ] \`api-routes\` — Create API
`);
    await writeSpecs(['database', 'auth']);

    const result = await validateRoadmapFormat(tmpDir);
    assert.ok(!result.warnings.some(w => w.includes('bundled')));
  });

  it('fails with missingGroups when items lack group headings', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: No Groups
## Phase I: Foundation
- [ ] \`setup-db\` — Initialize database
- [ ] \`setup-auth\` — Add auth
`);
    const result = await validateRoadmapFormat(tmpDir);
    assert.equal(result.valid, false);
    assert.ok(result.missingGroups.length > 0);
    assert.ok(result.missingGroups[0].includes('Foundation'));
  });

  it('handles missing specs dir gracefully', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeRoadmap(`# Roadmap: NoSpecs
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
`);
    // No specs dir at all
    const result = await validateRoadmapFormat(tmpDir);
    assert.ok(!result.warnings.some(w => w.includes('bundled')));
  });
});

describe('buildRoadmapFixPrompt', () => {
  it('includes near-miss details', () => {
    const result = {
      valid: false,
      errors: [],
      warnings: [],
      nearMisses: ['Line 5: "- [ ] Create database" — missing `kebab-id` in backticks']
    };
    const prompt = buildRoadmapFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('Line 5'));
    assert.ok(prompt.includes('Create database'));
    assert.ok(prompt.includes('Near-miss'));
  });

  it('includes format reminder', () => {
    const result = {
      valid: false,
      errors: [],
      warnings: [],
      nearMisses: ['Line 5: "- [ ] Create database" — missing ID']
    };
    const prompt = buildRoadmapFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('`kebab-case-id`'));
    assert.ok(prompt.includes('Required format'));
  });

  it('includes structural errors', () => {
    const result = {
      valid: false,
      errors: ['Invalid requirement ID "BadId" — must be kebab-case'],
      warnings: [],
      nearMisses: []
    };
    const prompt = buildRoadmapFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('Structural errors'));
    assert.ok(prompt.includes('BadId'));
  });

  it('includes warnings', () => {
    const result = {
      valid: false,
      errors: [],
      warnings: ['Phase II "Empty Phase" has no items'],
      nearMisses: []
    };
    const prompt = buildRoadmapFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('Warnings'));
    assert.ok(prompt.includes('Empty Phase'));
  });

  it('includes project directory path', () => {
    const result = {
      valid: false,
      errors: [],
      warnings: [],
      nearMisses: ['Line 1: "- [ ] bad" — missing ID']
    };
    const prompt = buildRoadmapFixPrompt(result, '/home/user/my-project');
    assert.ok(prompt.includes('/home/user/my-project/openspec/roadmap.md'));
  });

  it('includes missing-groups section when present', () => {
    const result = {
      valid: false,
      errors: [],
      warnings: [],
      nearMisses: [],
      missingGroups: ['Line 3: Phase "Foundation" has 2 checkbox item(s) but no ### Group headings — add at least one group, e.g. ### Group A: Foundation']
    };
    const prompt = buildRoadmapFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('Missing group headings'));
    assert.ok(prompt.includes('Foundation'));
    assert.ok(prompt.includes('Every phase MUST have at least one group heading'));
    assert.ok(prompt.includes('### Group A:'));
  });

  it('includes heading-level diagnostics when present', () => {
    const result = {
      valid: false,
      errors: ['No phases found in roadmap'],
      warnings: [],
      nearMisses: [],
      headingIssues: ['Line 3: Found `### Phase I: Setup` — use `##` for phase headings']
    };
    const prompt = buildRoadmapFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('Heading-level errors'));
    assert.ok(prompt.includes('### Phase I: Setup'));
    assert.ok(prompt.includes('Phases: `## Phase I: Label` (two #)'));
    assert.ok(prompt.includes('Groups: `### Group A: Label` (three #)'));
  });
});

describe('findMissingGroups', () => {
  it('detects phase with items but no group headings', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
- [ ] \`setup-db\` — Initialize database
- [ ] \`setup-auth\` — Add auth
`;
    const diags = findMissingGroups(content);
    assert.equal(diags.length, 1);
    assert.ok(diags[0].includes('Phase "Foundation"'));
    assert.ok(diags[0].includes('2 checkbox item(s)'));
    assert.ok(diags[0].includes('no ### Group headings'));
  });

  it('passes when all phases have group headings', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [x] \`setup-auth\` — Add auth
`;
    assert.deepEqual(findMissingGroups(content), []);
  });

  it('handles mixed phases — some with groups, some without', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database

## Phase II: Features
- [ ] \`user-profile\` — User profile page
- [ ] \`user-settings\` — User settings
`;
    const diags = findMissingGroups(content);
    assert.equal(diags.length, 1);
    assert.ok(diags[0].includes('Phase "Features"'));
    assert.ok(diags[0].includes('2 checkbox item(s)'));
  });

  it('returns empty when phase has no items and no groups', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
Some descriptive text but no items.

## Phase II: Features
### Group A: UI
- [ ] \`user-profile\` — Profile page
`;
    assert.deepEqual(findMissingGroups(content), []);
  });

  it('reports correct line numbers', () => {
    const content = `# Roadmap: Test

## Phase I: Foundation
- [ ] \`setup-db\` — Work
`;
    const diags = findMissingGroups(content);
    assert.equal(diags.length, 1);
    assert.ok(diags[0].includes('Line 3'));
  });
});

describe('findHeadingLevelIssues', () => {
  const reader = new RoadmapReader('/tmp/fake');

  it('detects ### Phase headings (should be ##)', () => {
    const content = `# Roadmap: Test
### Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Work
`;
    const roadmap = reader.parseContent(content);
    const issues = findHeadingLevelIssues(content, roadmap);
    assert.ok(issues.length > 0);
    assert.ok(issues[0].includes('Phase I: Foundation'));
    assert.ok(issues[0].includes('use `##`'));
    assert.ok(issues[0].includes('Line 2'));
  });

  it('detects #### Phase headings (should be ##)', () => {
    const content = `# Roadmap: Test
#### Phase I: Setup
### Group A: Core
- [ ] \`setup-db\` — Work
`;
    const roadmap = reader.parseContent(content);
    const issues = findHeadingLevelIssues(content, roadmap);
    assert.ok(issues.some(i => i.includes('Phase I: Setup') && i.includes('use `##`')));
  });

  it('returns no issues for correct heading levels', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Work
`;
    const roadmap = reader.parseContent(content);
    const issues = findHeadingLevelIssues(content, roadmap);
    assert.deepEqual(issues, []);
  });

  it('detects ## Group headings (should be ###)', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
## Group A: Core
- [ ] \`setup-db\` — Work
`;
    const roadmap = reader.parseContent(content);
    // Phase I has no groups because ## Group is parsed as a phase, not a group
    const issues = findHeadingLevelIssues(content, roadmap);
    assert.ok(issues.some(i => i.includes('Group A: Core') && i.includes('use `###`')));
  });

  it('detects #### Group headings (should be ###)', () => {
    const content = `# Roadmap: Test
## Phase I: Foundation
#### Group A: Core
- [ ] \`setup-db\` — Work
`;
    const roadmap = reader.parseContent(content);
    const issues = findHeadingLevelIssues(content, roadmap);
    assert.ok(issues.some(i => i.includes('Group A: Core') && i.includes('use `###`')));
  });

  it('reports correct line numbers', () => {
    const content = `# Roadmap: Test

### Phase I: Foundation
### Phase II: Features
`;
    const roadmap = reader.parseContent(content);
    const issues = findHeadingLevelIssues(content, roadmap);
    assert.equal(issues.length, 2);
    assert.ok(issues[0].includes('Line 3'));
    assert.ok(issues[1].includes('Line 4'));
  });
});
