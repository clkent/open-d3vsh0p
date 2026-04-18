const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { loadDevShopContext, CONTEXT_FILES } = require('./devshop-context');

describe('loadDevShopContext', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-ctx-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads all files when they exist', async () => {
    // Create all expected files
    for (const file of CONTEXT_FILES) {
      const filePath = path.join(tmpDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `// content of ${file.path}\n`);
    }

    const result = await loadDevShopContext({ devshopRoot: tmpDir, warn: () => {} });
    assert.ok(result.length > 0, 'should return non-empty context');

    // Each file should have a section with its label
    for (const file of CONTEXT_FILES) {
      assert.ok(result.includes(file.label), `should include label: ${file.label}`);
      assert.ok(result.includes(`// content of ${file.path}`), `should include content of ${file.path}`);
    }
  });

  it('wraps each file in a code block', async () => {
    const file = CONTEXT_FILES[0];
    const filePath = path.join(tmpDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'const x = 1;\n');

    const result = await loadDevShopContext({ devshopRoot: tmpDir, warn: () => {} });
    assert.ok(result.includes('```\nconst x = 1;\n```'));
  });

  it('skips missing files and logs warnings', async () => {
    // Create only the first file
    const file = CONTEXT_FILES[0];
    const filePath = path.join(tmpDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '// exists\n');

    const warnings = [];
    const result = await loadDevShopContext({
      devshopRoot: tmpDir,
      warn: (msg) => warnings.push(msg)
    });

    assert.ok(result.includes('// exists'), 'should include existing file');
    assert.equal(warnings.length, CONTEXT_FILES.length - 1, 'should warn for each missing file');
    assert.ok(warnings[0].includes('could not load'), 'warning should explain the issue');
  });

  it('returns empty string when no files exist', async () => {
    const warnings = [];
    const result = await loadDevShopContext({
      devshopRoot: tmpDir,
      warn: (msg) => warnings.push(msg)
    });

    assert.equal(result, '');
    assert.equal(warnings.length, CONTEXT_FILES.length);
  });

  it('uses ### headers with file labels', async () => {
    const file = CONTEXT_FILES[0];
    const filePath = path.join(tmpDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '// code\n');

    const result = await loadDevShopContext({ devshopRoot: tmpDir, warn: () => {} });
    assert.ok(result.startsWith(`### ${file.label}`));
  });

  it('trims trailing whitespace from file contents', async () => {
    const file = CONTEXT_FILES[0];
    const filePath = path.join(tmpDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'code\n\n\n');

    const result = await loadDevShopContext({ devshopRoot: tmpDir, warn: () => {} });
    // Should end with code\n``` not code\n\n\n```
    assert.ok(result.includes('code\n```'));
    assert.ok(!result.includes('code\n\n\n```'));
  });
});
