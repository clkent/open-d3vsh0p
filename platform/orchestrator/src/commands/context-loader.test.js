const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { loadProjectContext } = require('./context-loader');

describe('loadProjectContext', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctx-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string when context/ directory does not exist', async () => {
    const result = await loadProjectContext(tmpDir);
    assert.equal(result, '');
  });

  it('returns empty string when context/ directory is empty', async () => {
    await fs.mkdir(path.join(tmpDir, 'context'));
    const result = await loadProjectContext(tmpDir);
    assert.equal(result, '');
  });

  it('returns empty string when context/ has only non-md files', async () => {
    const contextDir = path.join(tmpDir, 'context');
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'notes.txt'), 'some notes');
    await fs.writeFile(path.join(contextDir, '.gitkeep'), '');
    const result = await loadProjectContext(tmpDir);
    assert.equal(result, '');
  });

  it('loads a single .md file with filename header', async () => {
    const contextDir = path.join(tmpDir, 'context');
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'brief.md'), 'Build a todo app.');
    const result = await loadProjectContext(tmpDir);
    assert.equal(result, '### brief.md\n\nBuild a todo app.');
  });

  it('loads multiple .md files sorted alphabetically', async () => {
    const contextDir = path.join(tmpDir, 'context');
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'b-research.md'), 'Research notes');
    await fs.writeFile(path.join(contextDir, 'a-brief.md'), 'Product brief');
    const result = await loadProjectContext(tmpDir);
    assert.equal(result, '### a-brief.md\n\nProduct brief\n\n### b-research.md\n\nResearch notes');
  });

  it('trims whitespace from file content', async () => {
    const contextDir = path.join(tmpDir, 'context');
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'brief.md'), '  content with whitespace  \n\n');
    const result = await loadProjectContext(tmpDir);
    assert.equal(result, '### brief.md\n\ncontent with whitespace');
  });

  it('ignores non-md files alongside md files', async () => {
    const contextDir = path.join(tmpDir, 'context');
    await fs.mkdir(contextDir);
    await fs.writeFile(path.join(contextDir, 'brief.md'), 'The brief');
    await fs.writeFile(path.join(contextDir, 'image.png'), 'binary');
    await fs.writeFile(path.join(contextDir, '.gitkeep'), '');
    const result = await loadProjectContext(tmpDir);
    assert.equal(result, '### brief.md\n\nThe brief');
  });
});
