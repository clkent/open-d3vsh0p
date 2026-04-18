/**
 * CompletenessChecker: Detects mock/simulation patterns in production code.
 *
 * Scans changed files for indicators that an implementation is scaffolded
 * but not actually functional (simulated I/O, hardcoded fallback data,
 * TODO-replace markers, commented-out real implementations).
 *
 * Runs after tests pass, before review. Skips test files.
 */

const SIMULATION_PATTERNS = [
  {
    pattern: /\bsimulate\w+\s*\(/i,
    description: 'simulated operation (e.g. simulateFileWrite, simulateFileRead)'
  },
  {
    pattern: /\/\/\s*(?:In a real|In production|TODO:?\s*replace\s*with\s*(?:actual|real))/i,
    description: 'TODO/placeholder comment indicating unfinished implementation'
  },
  {
    pattern: /\/\/\s*(?:Simulate|Simulating|Simulated)\b/i,
    description: 'comment indicating simulated behavior'
  },
  {
    pattern: /\[\s*SIMULATED\s*\]/,
    description: '[SIMULATED] log marker'
  },
  {
    pattern: /(?:\/\/|\/\*)\s*(?:MOCK|STUB|FAKE|PLACEHOLDER)\s*(?:[-—:]|\*\/)/i,
    description: 'mock/stub/placeholder marker comment'
  },
  {
    pattern: /createMock\w+Data\s*\(/,
    description: 'mock data factory in production code'
  },
  {
    pattern: /\breturn\s+(?:this\.)?createMock/,
    description: 'returning mock data from production method'
  },
  {
    pattern: /\/\*[\s\S]{0,200}?(?:CAUSING CRASHES|COMMENTED OUT|DISABLED|REMOVED)[\s\S]*?\*\//i,
    description: 'commented-out production code block'
  },
  {
    pattern: /\bfunction\s+\w+\s*\([^)]*\)\s*\{\s*\}/,
    description: 'empty function body'
  },
  {
    pattern: /=>\s*\{\s*\}/,
    description: 'empty arrow function body'
  },
  {
    pattern: /\breturn\s+\[\s*\]\s*;/m,
    description: 'returns empty array (likely stub)'
  },
  {
    pattern: /\breturn\s+\{\s*\}\s*;/m,
    description: 'returns empty object (likely stub)'
  },
  {
    pattern: /\breturn\s+(?:0|''|"")\s*;.*\/\/\s*(?:TODO|FIXME|placeholder|stub)/i,
    description: 'hardcoded return with TODO comment'
  }
];

// File patterns to skip (test files, config, docs)
const SKIP_FILE_PATTERNS = [
  /\.(test|spec)\.[jt]sx?$/,
  /\/__tests__\//,
  /\/__mocks__\//,
  /\/test\//,
  /\/tests\//,
  /\.test\.[jt]sx?$/,
  /\.d\.ts$/,
  /\.md$/,
  /\.json$/,
  /\.config\.[jt]s$/,
  /mock\w*\.[jt]sx?$/i,
];

class CompletenessChecker {
  /**
   * Check changed files for simulation/mock patterns in production code.
   *
   * @param {string[]} filePaths - Changed file paths (relative)
   * @param {Map<string, string>} fileContents - Map of path → file content
   * @returns {{ passed: boolean, violations: string[] }}
   */
  static check(filePaths, fileContents) {
    const violations = [];

    for (const filePath of filePaths) {
      // Skip non-production files
      if (SKIP_FILE_PATTERNS.some(p => p.test(filePath))) {
        continue;
      }

      // Only check source files
      if (!filePath.match(/\.[jt]sx?$/) && !filePath.match(/\.swift$/) && !filePath.match(/\.kt$/)) {
        continue;
      }

      const content = fileContents.get(filePath);
      if (!content) continue;

      for (const rule of SIMULATION_PATTERNS) {
        if (rule.pattern.test(content)) {
          violations.push(
            `${filePath}: contains ${rule.description} — replace with real implementation`
          );
          break; // One violation per file is enough
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }
}

module.exports = { CompletenessChecker, SIMULATION_PATTERNS, SKIP_FILE_PATTERNS };
