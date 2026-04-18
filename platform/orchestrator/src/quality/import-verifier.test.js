const assert = require('node:assert');
const { describe, it, beforeEach, afterEach } = require('node:test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ImportVerifier } = require('./import-verifier');

describe('ImportVerifier', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-verifier-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractImports', () => {
    it('extracts ES module imports', () => {
      const content = `import { UserService } from '../services/user-service';
import express from 'express';
import './styles.css';`;
      const imports = ImportVerifier.extractImports(content);
      // Should only get relative imports
      assert.equal(imports.length, 2);
      assert.equal(imports[0].importPath, '../services/user-service');
      assert.equal(imports[0].line, 1);
      assert.equal(imports[1].importPath, './styles.css');
      assert.equal(imports[1].line, 3);
    });

    it('extracts CommonJS requires', () => {
      const content = `const db = require('./lib/db');
const express = require('express');
const utils = require('../utils/helpers');`;
      const imports = ImportVerifier.extractImports(content);
      assert.equal(imports.length, 2);
      assert.equal(imports[0].importPath, './lib/db');
      assert.equal(imports[1].importPath, '../utils/helpers');
    });

    it('extracts mixed import styles', () => {
      const content = `import { foo } from './foo';
const bar = require('./bar');`;
      const imports = ImportVerifier.extractImports(content);
      assert.equal(imports.length, 2);
      assert.equal(imports[0].importPath, './foo');
      assert.equal(imports[1].importPath, './bar');
    });

    it('skips third-party packages', () => {
      const content = `import express from 'express';
import { Router } from 'express';
const lodash = require('lodash');
const path = require('path');`;
      const imports = ImportVerifier.extractImports(content);
      assert.equal(imports.length, 0);
    });

    it('handles empty or null content', () => {
      assert.deepEqual(ImportVerifier.extractImports(''), []);
      assert.deepEqual(ImportVerifier.extractImports(null), []);
      assert.deepEqual(ImportVerifier.extractImports(undefined), []);
    });

    it('extracts default and named imports', () => {
      const content = `import defaultExport from './default';
import { named } from './named';
import * as all from './all';`;
      const imports = ImportVerifier.extractImports(content);
      assert.equal(imports.length, 3);
      assert.equal(imports[0].importPath, './default');
      assert.equal(imports[1].importPath, './named');
      assert.equal(imports[2].importPath, './all');
    });

    it('tracks correct line numbers', () => {
      const content = `// comment
import { a } from './a';
// another comment
const b = require('./b');`;
      const imports = ImportVerifier.extractImports(content);
      assert.equal(imports[0].line, 2);
      assert.equal(imports[1].line, 4);
    });
  });

  describe('resolveImport', () => {
    it('resolves exact file path', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), '');
      const result = ImportVerifier.resolveImport('./utils.js', 'src/index.js', tmpDir);
      assert.ok(result.endsWith('utils.js'), `expected path ending in utils.js, got ${result}`);
    });

    it('resolves with .ts extension inference', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils.ts'), '');
      const result = ImportVerifier.resolveImport('./utils', 'src/index.ts', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('utils.ts'));
    });

    it('resolves with .js extension inference', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), '');
      const result = ImportVerifier.resolveImport('./utils', 'src/index.js', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('utils.js'));
    });

    it('resolves with .tsx extension inference', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'Button.tsx'), '');
      const result = ImportVerifier.resolveImport('./Button', 'src/App.tsx', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('Button.tsx'));
    });

    it('resolves with .jsx extension inference', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'Button.jsx'), '');
      const result = ImportVerifier.resolveImport('./Button', 'src/App.jsx', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('Button.jsx'));
    });

    it('resolves index.ts in directory', () => {
      fs.mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'index.ts'), '');
      const result = ImportVerifier.resolveImport('./utils', 'src/index.ts', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('index.ts'));
    });

    it('resolves index.js in directory', () => {
      fs.mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'index.js'), '');
      const result = ImportVerifier.resolveImport('./utils', 'src/index.js', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('index.js'));
    });

    it('resolves parent directory imports', () => {
      fs.mkdirSync(path.join(tmpDir, 'src', 'routes'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'src', 'services'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'services', 'auth.ts'), '');
      const result = ImportVerifier.resolveImport('../services/auth', 'src/routes/login.ts', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('auth.ts'));
    });

    it('returns null for non-existent file', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      const result = ImportVerifier.resolveImport('./nonexistent', 'src/index.ts', tmpDir);
      assert.equal(result, null);
    });

    it('prefers .ts over .js when both exist', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils.ts'), '');
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), '');
      const result = ImportVerifier.resolveImport('./utils', 'src/index.ts', tmpDir);
      assert.ok(result);
      assert.ok(result.endsWith('utils.ts'));
    });
  });

  describe('verify', () => {
    it('passes when all imports resolve', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), `import { helper } from './helper';`);
      fs.writeFileSync(path.join(tmpDir, 'src', 'helper.ts'), 'export function helper() {}');

      const result = await ImportVerifier.verify(['src/index.ts'], tmpDir);
      assert.equal(result.passed, true);
      assert.equal(result.errors.length, 0);
    });

    it('fails with clear error for unresolved imports', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), `import { ghost } from './phantom';`);

      const result = await ImportVerifier.verify(['src/index.ts'], tmpDir);
      assert.equal(result.passed, false);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes('./phantom'));
      assert.ok(result.errors[0].includes('src/index.ts'));
      assert.ok(result.errors[0].includes('does not exist'));
    });

    it('reports multiple unresolved imports', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'),
        `import { a } from './a';\nimport { b } from './b';`);

      const result = await ImportVerifier.verify(['src/index.ts'], tmpDir);
      assert.equal(result.passed, false);
      assert.equal(result.errors.length, 2);
    });

    it('skips non-JS/TS files', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'readme.md'), `import { ghost } from './phantom';`);

      const result = await ImportVerifier.verify(['src/readme.md'], tmpDir);
      assert.equal(result.passed, true);
    });

    it('skips deleted files gracefully', async () => {
      const result = await ImportVerifier.verify(['src/deleted-file.ts'], tmpDir);
      assert.equal(result.passed, true);
    });

    it('handles empty changed files list', async () => {
      const result = await ImportVerifier.verify([], tmpDir);
      assert.equal(result.passed, true);
      assert.equal(result.errors.length, 0);
    });

    it('checks multiple files', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'a.ts'), `import { x } from './x';`);
      fs.writeFileSync(path.join(tmpDir, 'src', 'b.ts'), `import { y } from './y';`);
      fs.writeFileSync(path.join(tmpDir, 'src', 'x.ts'), '');

      const result = await ImportVerifier.verify(['src/a.ts', 'src/b.ts'], tmpDir);
      assert.equal(result.passed, false);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes('./y'));
    });

    it('includes line number in error', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), `// comment\nimport { ghost } from './phantom';`);

      const result = await ImportVerifier.verify(['src/index.ts'], tmpDir);
      assert.equal(result.passed, false);
      assert.ok(result.errors[0].includes(':2'));
    });
  });
});
