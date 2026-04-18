const path = require('path');
const fs = require('fs');

/**
 * ImportVerifier: Zero-cost file-system check that all relative imports
 * in changed files resolve to real modules. Catches hallucinated imports
 * before tests run.
 */
class ImportVerifier {
  /**
   * Extract relative import/require paths from file content.
   * Returns array of { importPath, line } objects.
   */
  static extractImports(fileContent) {
    if (!fileContent) return [];

    const imports = [];
    const lines = fileContent.split('\n');

    // ES module: import ... from '...' or import '...'
    const esImportRe = /(?:import\s+.*?\s+from\s+|import\s+)['"]([^'"]+)['"]/g;
    // CommonJS: require('...')
    const cjsRequireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;

      esImportRe.lastIndex = 0;
      while ((match = esImportRe.exec(line)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          imports.push({ importPath, line: i + 1 });
        }
      }

      cjsRequireRe.lastIndex = 0;
      while ((match = cjsRequireRe.exec(line)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
          imports.push({ importPath, line: i + 1 });
        }
      }
    }

    return imports;
  }

  /**
   * Check if an import path resolves to a real file.
   * Tries exact path, then extension inference, then index files.
   * Returns the resolved path or null if not found.
   */
  static resolveImport(importPath, sourceFile, projectDir) {
    const sourceDir = path.dirname(path.resolve(projectDir, sourceFile));
    const targetBase = path.resolve(sourceDir, importPath);

    // Extension inference order
    const extensions = ['.ts', '.js', '.tsx', '.jsx'];
    const indexFiles = extensions.map(ext => path.join('index' + ext));

    // 1. Exact path
    if (fs.existsSync(targetBase) && fs.statSync(targetBase).isFile()) {
      return targetBase;
    }

    // 2. With extensions
    for (const ext of extensions) {
      const candidate = targetBase + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    // 3. As directory with index file
    for (const indexFile of indexFiles) {
      const candidate = path.join(targetBase, indexFile);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Verify all relative imports in the given changed files.
   * Returns { passed: boolean, errors: string[] }
   */
  static async verify(changedFiles, projectDir) {
    const errors = [];

    for (const filePath of changedFiles) {
      const fullPath = path.resolve(projectDir, filePath);

      // Skip non-JS/TS files
      if (!/\.(js|ts|jsx|tsx|mjs|cjs)$/.test(filePath)) continue;

      let content;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        // File might have been deleted in diff — skip
        continue;
      }

      const imports = ImportVerifier.extractImports(content);

      for (const { importPath, line } of imports) {
        const resolved = ImportVerifier.resolveImport(importPath, filePath, projectDir);
        if (!resolved) {
          errors.push(`'${importPath}' in ${filePath}:${line} -- this file does not exist`);
        }
      }
    }

    return {
      passed: errors.length === 0,
      errors
    };
  }
}

module.exports = { ImportVerifier };
