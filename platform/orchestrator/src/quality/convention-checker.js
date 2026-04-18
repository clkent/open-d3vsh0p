/**
 * ConventionChecker: Zero-cost grep-based convention compliance check.
 *
 * Parses conventions.md to extract machine-checkable rules, then verifies
 * changed files comply. Runs after tests pass, before review.
 */
class ConventionChecker {
  /**
   * Parse conventions text to extract machine-checkable rules.
   * @param {string} conventionsText - Content of conventions.md
   * @returns {Array<{ type: string, expected: string, forbidden: string[] }>}
   */
  static parseRules(conventionsText) {
    if (!conventionsText) return [];
    const text = conventionsText.toLowerCase();
    const rules = [];

    // Test framework detection
    const testFrameworks = [
      { name: 'vitest', patterns: ['vitest'], forbidden: ['jest', '@jest/globals', 'mocha', 'chai'] },
      { name: 'jest', patterns: ['jest'], forbidden: ['vitest', 'mocha', 'chai'] },
      { name: 'mocha', patterns: ['mocha'], forbidden: ['jest', '@jest/globals', 'vitest'] },
      { name: 'node:test', patterns: ['node:test', 'node test runner'], forbidden: ['jest', '@jest/globals', 'vitest', 'mocha'] }
    ];
    for (const tf of testFrameworks) {
      if (tf.patterns.some(p => text.includes(p))) {
        rules.push({ type: 'test_framework', expected: tf.name, forbidden: tf.forbidden });
        break;
      }
    }

    // Styling detection
    const stylingOptions = [
      { name: 'tailwind', patterns: ['tailwind'], forbidden: ['styled-components', 'emotion', '@emotion'] },
      { name: 'styled-components', patterns: ['styled-components'], forbidden: ['tailwind'] },
      { name: 'css-modules', patterns: ['css modules', 'css module'], forbidden: ['styled-components', 'tailwind'] },
      { name: 'sass', patterns: ['sass', 'scss'], forbidden: ['styled-components'] },
      { name: 'emotion', patterns: ['emotion', '@emotion'], forbidden: ['styled-components'] }
    ];
    for (const s of stylingOptions) {
      if (s.patterns.some(p => text.includes(p))) {
        rules.push({ type: 'styling', expected: s.name, forbidden: s.forbidden });
        break;
      }
    }

    // ORM detection
    const ormOptions = [
      { name: 'prisma', patterns: ['prisma'], forbidden: ['typeorm', 'sequelize', 'drizzle', 'mongoose'] },
      { name: 'drizzle', patterns: ['drizzle'], forbidden: ['prisma', 'typeorm', 'sequelize', 'mongoose'] },
      { name: 'typeorm', patterns: ['typeorm'], forbidden: ['prisma', 'drizzle', 'sequelize'] },
      { name: 'sequelize', patterns: ['sequelize'], forbidden: ['prisma', 'drizzle', 'typeorm'] },
      { name: 'mongoose', patterns: ['mongoose'], forbidden: ['prisma', 'drizzle', 'typeorm', 'sequelize'] }
    ];
    for (const o of ormOptions) {
      if (o.patterns.some(p => text.includes(p))) {
        rules.push({ type: 'orm', expected: o.name, forbidden: o.forbidden });
        break;
      }
    }

    return rules;
  }

  /**
   * Check changed files for convention violations.
   * @param {string[]} filePaths - Changed file paths
   * @param {Map<string, string>} fileContents - Map of path → file content
   * @param {Array<{ type: string, expected: string, forbidden: string[] }>} rules
   * @returns {{ passed: boolean, violations: string[] }}
   */
  static check(filePaths, fileContents, rules) {
    if (!rules || rules.length === 0) return { passed: true, violations: [] };

    const violations = [];

    for (const rule of rules) {
      if (rule.type === 'test_framework') {
        const testFiles = filePaths.filter(f =>
          f.match(/\.(test|spec)\.[jt]sx?$/) || f.includes('__tests__/')
        );
        for (const tf of testFiles) {
          const content = fileContents.get(tf) || '';
          for (const forbidden of rule.forbidden) {
            if (content.includes(forbidden)) {
              violations.push(
                `Convention violation: ${tf} imports "${forbidden}" but conventions specify ${rule.expected}`
              );
            }
          }
        }
      }

      if (rule.type === 'styling') {
        const sourceFiles = filePaths.filter(f =>
          f.match(/\.[jt]sx?$/) && !f.match(/\.(test|spec)\./)
        );
        for (const sf of sourceFiles) {
          const content = fileContents.get(sf) || '';
          for (const forbidden of rule.forbidden) {
            if (content.includes(forbidden)) {
              violations.push(
                `Convention violation: ${sf} uses "${forbidden}" but conventions specify ${rule.expected}`
              );
            }
          }
        }
      }

      if (rule.type === 'orm') {
        const sourceFiles = filePaths.filter(f =>
          f.match(/\.[jt]sx?$/) && !f.match(/\.(test|spec)\./)
        );
        for (const sf of sourceFiles) {
          const content = fileContents.get(sf) || '';
          for (const forbidden of rule.forbidden) {
            if (content.includes(forbidden)) {
              violations.push(
                `Convention violation: ${sf} uses "${forbidden}" but conventions specify ${rule.expected}`
              );
            }
          }
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }
}

module.exports = { ConventionChecker };
