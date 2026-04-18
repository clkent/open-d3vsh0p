const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { checkRequirementsContent, validateRequirementsFormat, buildRequirementsFixPrompt } = require('./requirements-format-checker');

describe('checkRequirementsContent', () => {
  it('passes for valid requirements', () => {
    const content = `# My Project

## Tech Stack
- Node.js

## Requirements

### User Authentication
- Support email/password login
- Add session management

### Dashboard
- Show summary stats

## Deployment
Notes here.
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('fails when ## Requirements section is missing', () => {
    const content = `# My Project

## Tech Stack
- Node.js

## Features
### Login
- Support login
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Missing "## Requirements"'));
  });

  it('detects case-sensitive mismatch in header', () => {
    const content = `# My Project

## requirements

### Login
- Support login
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('case-sensitive'));
  });

  it('detects capitalized variant', () => {
    const content = `# My Project

## REQUIREMENTS

### Login
- Support login
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('case-sensitive'));
  });

  it('fails when section exists but has no ### headers', () => {
    const content = `# My Project

## Requirements

Some text about requirements but no actual requirement headers.

## Deployment
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('no ### requirement headers'));
  });

  it('warns when requirements have no bullets', () => {
    const content = `# My Project

## Requirements

### Login

### Dashboard
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length >= 1);
    assert.ok(result.warnings.some(w => w.includes('Login') && w.includes('no bullet')));
    assert.ok(result.warnings.some(w => w.includes('Dashboard') && w.includes('no bullet')));
  });

  it('does not warn when requirements have bullets', () => {
    const content = `# My Project

## Requirements

### Login
- Support login

### Dashboard
- Show stats
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, true);
    assert.deepEqual(result.warnings, []);
  });

  it('handles requirements at end of file (no trailing section)', () => {
    const content = `# My Project

## Requirements

### Login
- Support login
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('only checks within the ## Requirements section', () => {
    const content = `# My Project

## Other Section
### Not A Requirement
- Not counted

## Requirements

### Real Requirement
- Real bullet
`;
    const result = checkRequirementsContent(content);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });
});

describe('validateRequirementsFormat', () => {
  let tmpDir;

  async function writeProjectMd(content) {
    const openspecDir = path.join(tmpDir, 'openspec');
    await fs.mkdir(openspecDir, { recursive: true });
    await fs.writeFile(path.join(openspecDir, 'project.md'), content);
  }

  it('returns error when project.md is missing', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'req-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    const result = await validateRequirementsFormat(tmpDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('not found'));
  });

  it('passes for valid project.md', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'req-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeProjectMd(`# Test
## Requirements
### Feature One
- Build it
`);
    const result = await validateRequirementsFormat(tmpDir);
    assert.equal(result.valid, true);
  });

  it('fails for missing requirements section', async (t) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'req-test-'));
    t.after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    await writeProjectMd(`# Test
## Features
### Feature One
- Build it
`);
    const result = await validateRequirementsFormat(tmpDir);
    assert.equal(result.valid, false);
  });
});

describe('buildRequirementsFixPrompt', () => {
  it('includes errors', () => {
    const result = {
      valid: false,
      errors: ['Missing "## Requirements" section'],
      warnings: []
    };
    const prompt = buildRequirementsFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('Missing "## Requirements"'));
    assert.ok(prompt.includes('/tmp/project/openspec/project.md'));
  });

  it('includes warnings', () => {
    const result = {
      valid: true,
      errors: [],
      warnings: ['Requirement "Login" has no bullet points']
    };
    const prompt = buildRequirementsFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('Login'));
    assert.ok(prompt.includes('no bullet'));
  });

  it('includes required format example', () => {
    const result = {
      valid: false,
      errors: ['Missing section'],
      warnings: []
    };
    const prompt = buildRequirementsFixPrompt(result, '/tmp/project');
    assert.ok(prompt.includes('## Requirements'));
    assert.ok(prompt.includes('### Requirement Name'));
    assert.ok(prompt.includes('Required format'));
  });
});
