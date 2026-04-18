const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ConventionChecker } = require('./convention-checker');

describe('ConventionChecker', () => {
  describe('parseRules', () => {
    it('extracts test framework rule for vitest', () => {
      const rules = ConventionChecker.parseRules('## Testing\n- Use Vitest for all tests');
      assert.equal(rules.length, 1);
      assert.equal(rules[0].type, 'test_framework');
      assert.equal(rules[0].expected, 'vitest');
      assert.ok(rules[0].forbidden.includes('jest'));
    });

    it('extracts test framework rule for jest', () => {
      const rules = ConventionChecker.parseRules('Test framework: Jest');
      const tf = rules.find(r => r.type === 'test_framework');
      assert.ok(tf);
      assert.equal(tf.expected, 'jest');
      assert.ok(tf.forbidden.includes('vitest'));
    });

    it('extracts test framework rule for node:test', () => {
      const rules = ConventionChecker.parseRules('Use node:test for testing');
      const tf = rules.find(r => r.type === 'test_framework');
      assert.ok(tf);
      assert.equal(tf.expected, 'node:test');
    });

    it('extracts styling rule for tailwind', () => {
      const rules = ConventionChecker.parseRules('Styling: Tailwind CSS');
      const s = rules.find(r => r.type === 'styling');
      assert.ok(s);
      assert.equal(s.expected, 'tailwind');
      assert.ok(s.forbidden.includes('styled-components'));
    });

    it('extracts ORM rule for prisma', () => {
      const rules = ConventionChecker.parseRules('ORM: Prisma');
      const o = rules.find(r => r.type === 'orm');
      assert.ok(o);
      assert.equal(o.expected, 'prisma');
      assert.ok(o.forbidden.includes('typeorm'));
    });

    it('returns empty array when no conventions found', () => {
      const rules = ConventionChecker.parseRules('Follow best practices for code quality.');
      assert.equal(rules.length, 0);
    });

    it('returns empty array for null input', () => {
      assert.deepEqual(ConventionChecker.parseRules(null), []);
      assert.deepEqual(ConventionChecker.parseRules(''), []);
    });

    it('extracts multiple rule types', () => {
      const rules = ConventionChecker.parseRules(
        '## Testing\nUse Vitest\n## Styling\nUse Tailwind\n## Data\nUse Prisma'
      );
      assert.equal(rules.length, 3);
      assert.ok(rules.find(r => r.type === 'test_framework'));
      assert.ok(rules.find(r => r.type === 'styling'));
      assert.ok(rules.find(r => r.type === 'orm'));
    });
  });

  describe('check', () => {
    it('detects wrong test framework', () => {
      const rules = [{ type: 'test_framework', expected: 'vitest', forbidden: ['jest', '@jest/globals'] }];
      const files = ['src/auth.test.js'];
      const contents = new Map([['src/auth.test.js', "import { describe } from '@jest/globals';"]]);

      const result = ConventionChecker.check(files, contents, rules);
      assert.equal(result.passed, false);
      assert.ok(result.violations.length >= 1);
      assert.ok(result.violations.some(v => v.includes('@jest/globals')));
      assert.ok(result.violations.some(v => v.includes('vitest')));
    });

    it('passes when correct framework is used', () => {
      const rules = [{ type: 'test_framework', expected: 'vitest', forbidden: ['jest', '@jest/globals'] }];
      const files = ['src/auth.test.ts'];
      const contents = new Map([['src/auth.test.ts', "import { describe, it } from 'vitest';"]]);

      const result = ConventionChecker.check(files, contents, rules);
      assert.equal(result.passed, true);
      assert.equal(result.violations.length, 0);
    });

    it('only checks test files for test_framework rules', () => {
      const rules = [{ type: 'test_framework', expected: 'vitest', forbidden: ['jest'] }];
      // Non-test file mentioning jest should not trigger violation
      const files = ['src/config.js'];
      const contents = new Map([['src/config.js', "// jest config fallback"]]);

      const result = ConventionChecker.check(files, contents, rules);
      assert.equal(result.passed, true);
    });

    it('detects wrong styling library', () => {
      const rules = [{ type: 'styling', expected: 'tailwind', forbidden: ['styled-components'] }];
      const files = ['src/Button.jsx'];
      const contents = new Map([['src/Button.jsx', "import styled from 'styled-components';"]]);

      const result = ConventionChecker.check(files, contents, rules);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('styled-components'));
    });

    it('detects wrong ORM', () => {
      const rules = [{ type: 'orm', expected: 'prisma', forbidden: ['typeorm', 'sequelize'] }];
      const files = ['src/db.ts'];
      const contents = new Map([['src/db.ts', "import { Sequelize } from 'sequelize';"]]);

      const result = ConventionChecker.check(files, contents, rules);
      assert.equal(result.passed, false);
      assert.ok(result.violations[0].includes('sequelize'));
    });

    it('reports multiple violations', () => {
      const rules = [
        { type: 'test_framework', expected: 'vitest', forbidden: ['jest'] },
        { type: 'styling', expected: 'tailwind', forbidden: ['styled-components'] }
      ];
      const files = ['src/Button.test.tsx', 'src/Button.tsx'];
      const contents = new Map([
        ['src/Button.test.tsx', "import { render } from 'jest';"],
        ['src/Button.tsx', "import styled from 'styled-components';"]
      ]);

      const result = ConventionChecker.check(files, contents, rules);
      assert.equal(result.passed, false);
      assert.ok(result.violations.length >= 2);
    });

    it('passes when no rules provided', () => {
      const result = ConventionChecker.check(['src/a.js'], new Map(), []);
      assert.equal(result.passed, true);
    });

    it('passes when rules is null', () => {
      const result = ConventionChecker.check(['src/a.js'], new Map(), null);
      assert.equal(result.passed, true);
    });
  });
});
