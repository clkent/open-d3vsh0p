const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CompletenessChecker, SIMULATION_PATTERNS, SKIP_FILE_PATTERNS } = require('./completeness-checker');

describe('CompletenessChecker', () => {
  describe('check', () => {
    it('passes when no simulation patterns found', () => {
      const files = ['src/auth.js'];
      const contents = new Map([['src/auth.js', 'function login(user, pass) { return db.authenticate(user, pass); }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
      assert.equal(result.violations.length, 0);
    });

    it('detects simulateFileWrite calls', () => {
      const files = ['src/storage.js'];
      const contents = new Map([['src/storage.js', 'async function save(data) { await simulateFileWrite(path, data); }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.equal(result.violations.length, 1);
      assert.ok(result.violations[0].includes('src/storage.js'));
      assert.ok(result.violations[0].includes('simulated operation'));
    });

    it('detects simulateFileRead calls', () => {
      const files = ['src/loader.ts'];
      const contents = new Map([['src/loader.ts', 'const data = simulateFileRead(containerPath);']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('simulated operation'));
    });

    it('detects "In a real implementation" comments', () => {
      const files = ['src/api.js'];
      const contents = new Map([['src/api.js', '// In a real implementation, this would call the API\nreturn mockData;']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('TODO/placeholder'));
    });

    it('detects "TODO: replace with actual" comments', () => {
      const files = ['src/service.ts'];
      const contents = new Map([['src/service.ts', '// TODO: replace with actual API call\nreturn {};']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('TODO/placeholder'));
    });

    it('detects "// Simulating" comments', () => {
      const files = ['src/bridge.js'];
      const contents = new Map([['src/bridge.js', '// Simulating the native bridge response\nreturn { success: true };']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('comment indicating simulated'));
    });

    it('detects [SIMULATED] markers', () => {
      const files = ['src/io.js'];
      const contents = new Map([['src/io.js', 'console.log("[SIMULATED] Writing to shared container");']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('[SIMULATED]'));
    });

    it('detects MOCK/STUB/PLACEHOLDER marker comments', () => {
      const files = ['src/data.ts'];
      const contents = new Map([['src/data.ts', '// MOCK: hardcoded data for testing\nconst items = [1,2,3];']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('mock/stub/placeholder'));
    });

    it('detects createMockData factories', () => {
      const files = ['src/loader.js'];
      const contents = new Map([['src/loader.js', 'function createMockPrecomputedData() { return { chars: {} }; }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('mock data factory'));
    });

    it('detects return createMock calls', () => {
      const files = ['src/service.ts'];
      const contents = new Map([['src/service.ts', 'async load() {\n  return this.createMockData();\n}']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('returning mock data'));
    });

    it('detects commented-out production code blocks', () => {
      const files = ['src/engine.js'];
      const contents = new Map([['src/engine.js', '/* COMMENTED OUT due to instability\nconst real = await fetch(url);\n*/']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('commented-out'));
    });

    it('detects empty function bodies', () => {
      const files = ['src/handler.js'];
      const contents = new Map([['src/handler.js', 'function processPayment(amount, currency) {}']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('empty function body'));
    });

    it('detects empty arrow function bodies', () => {
      const files = ['src/utils.ts'];
      const contents = new Map([['src/utils.ts', 'const handleClick = (event) => {}']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('empty arrow function body'));
    });

    it('detects return empty array stubs', () => {
      const files = ['src/repo.js'];
      const contents = new Map([['src/repo.js', 'function getUsers() {\n  return [];\n}']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('returns empty array'));
    });

    it('detects return empty object stubs', () => {
      const files = ['src/config.ts'];
      const contents = new Map([['src/config.ts', 'function loadConfig() {\n  return {};\n}']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('returns empty object'));
    });

    it('detects hardcoded return with TODO comment', () => {
      const files = ['src/calc.js'];
      const contents = new Map([['src/calc.js', "function getTotal() {\n  return 0; // TODO placeholder\n}"]]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('hardcoded return with TODO'));
    });

    it('does not flag arrow functions with real bodies', () => {
      const files = ['src/utils.js'];
      const contents = new Map([['src/utils.js', 'const add = (a, b) => { return a + b; }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('does not flag return of empty array in test files', () => {
      const files = ['src/repo.test.js'];
      const contents = new Map([['src/repo.test.js', 'function getUsers() { return []; }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    // --- Skip patterns ---

    it('skips test files', () => {
      const files = ['src/auth.test.js'];
      const contents = new Map([['src/auth.test.js', 'function createMockUserData() { return {}; }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips spec files', () => {
      const files = ['src/auth.spec.ts'];
      const contents = new Map([['src/auth.spec.ts', 'simulateLogin();']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips __tests__ directory', () => {
      const files = ['src/__tests__/helper.js'];
      const contents = new Map([['src/__tests__/helper.js', 'simulateFileWrite();']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips __mocks__ directory', () => {
      const files = ['src/__mocks__/fs.js'];
      const contents = new Map([['src/__mocks__/fs.js', 'createMockFsData()']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips .md files', () => {
      const files = ['docs/README.md'];
      const contents = new Map([['docs/README.md', '// In a real implementation...']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips .json files', () => {
      const files = ['package.json'];
      const contents = new Map([['package.json', '{"test": "simulateTests"}']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips config files', () => {
      const files = ['jest.config.js'];
      const contents = new Map([['jest.config.js', 'simulateSetup();']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips mock helper files', () => {
      const files = ['src/mockData.js'];
      const contents = new Map([['src/mockData.js', 'function createMockUserData() {}']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips non-source files (e.g. .css)', () => {
      const files = ['src/styles.css'];
      const contents = new Map([['src/styles.css', '/* PLACEHOLDER — fill with real styles */']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('skips .d.ts files', () => {
      const files = ['src/types.d.ts'];
      const contents = new Map([['src/types.d.ts', '// MOCK: placeholder types']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    // --- Edge cases ---

    it('reports only one violation per file', () => {
      const files = ['src/bad.js'];
      const contents = new Map([['src/bad.js', 'simulateFileWrite();\n// MOCK: data\ncreateMockData();']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.equal(result.violations.length, 1);
    });

    it('reports violations across multiple files', () => {
      const files = ['src/a.js', 'src/b.ts'];
      const contents = new Map([
        ['src/a.js', 'simulateFileWrite();'],
        ['src/b.ts', '// In a real implementation, this would work']
      ]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.equal(result.violations.length, 2);
    });

    it('handles empty file list', () => {
      const result = CompletenessChecker.check([], new Map());
      assert.equal(result.passed, true);
      assert.equal(result.violations.length, 0);
    });

    it('handles missing file content gracefully', () => {
      const files = ['src/missing.js'];
      const contents = new Map(); // no content for this file
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, true);
    });

    it('checks Swift files', () => {
      const files = ['ios/MyApp/Service.swift'];
      const contents = new Map([['ios/MyApp/Service.swift', 'func simulateWrite(_ data: Data) { }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
    });

    it('checks Kotlin files', () => {
      const files = ['android/app/Service.kt'];
      const contents = new Map([['android/app/Service.kt', 'fun simulateNetworkCall() { }']]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
    });

    it('mixes passing and failing files correctly', () => {
      const files = ['src/good.js', 'src/bad.ts', 'src/auth.test.js'];
      const contents = new Map([
        ['src/good.js', 'const result = await db.query(sql);'],
        ['src/bad.ts', '// Simulating the database query\nreturn [];'],
        ['src/auth.test.js', 'createMockUserData();'] // test file, should be skipped
      ]);
      const result = CompletenessChecker.check(files, contents);
      assert.equal(result.passed, false);
      assert.equal(result.violations.length, 1);
      assert.ok(result.violations[0].includes('src/bad.ts'));
    });
  });

  describe('SIMULATION_PATTERNS', () => {
    it('exports the patterns array', () => {
      assert.ok(Array.isArray(SIMULATION_PATTERNS));
      assert.ok(SIMULATION_PATTERNS.length > 0);
      for (const rule of SIMULATION_PATTERNS) {
        assert.ok(rule.pattern instanceof RegExp);
        assert.ok(typeof rule.description === 'string');
      }
    });
  });

  describe('SKIP_FILE_PATTERNS', () => {
    it('exports the skip patterns array', () => {
      assert.ok(Array.isArray(SKIP_FILE_PATTERNS));
      assert.ok(SKIP_FILE_PATTERNS.length > 0);
      for (const pat of SKIP_FILE_PATTERNS) {
        assert.ok(pat instanceof RegExp);
      }
    });
  });
});
