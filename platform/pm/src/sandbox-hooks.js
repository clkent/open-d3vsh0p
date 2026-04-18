const fs = require('fs');
const path = require('path');

/**
 * Create SDK PreToolUse hooks that sandbox file writes to a specific directory.
 * Write and Edit calls targeting paths outside projectDir are blocked.
 * Path traversal (../) is handled by resolving to absolute paths before checking.
 * Symlinks are resolved via fs.realpathSync to prevent symlink escape.
 *
 * @param {string} projectDir - Absolute path to the allowed write directory
 * @returns {object} SDK-compatible hooks object with preToolUse array
 */
function createWriteSandbox(projectDir) {
  // Resolve symlinks in the project dir itself so comparisons are consistent
  let resolvedProjectDir;
  try {
    resolvedProjectDir = fs.realpathSync(projectDir) + path.sep;
  } catch {
    // If projectDir doesn't exist yet, fall back to path.resolve
    resolvedProjectDir = path.resolve(projectDir) + path.sep;
  }

  return {
    preToolUse: [
      ({ tool, input }) => {
        if (tool === 'Write' || tool === 'Edit') {
          const filePath = input.file_path || input.filePath;
          if (!filePath) {
            return { decision: 'block', message: 'Blocked: no file path provided' };
          }

          // Resolve the target path — use realpathSync for existing paths
          // to follow symlinks, fall back to path.resolve for new files
          let resolved;
          try {
            resolved = fs.realpathSync(filePath);
          } catch {
            // File doesn't exist yet — resolve the parent directory if possible,
            // then append the filename
            const dir = path.dirname(filePath);
            const base = path.basename(filePath);
            try {
              resolved = path.join(fs.realpathSync(dir), base);
            } catch {
              resolved = path.resolve(filePath);
            }
          }

          if (!resolved.startsWith(resolvedProjectDir) && resolved !== resolvedProjectDir.slice(0, -1)) {
            return {
              decision: 'block',
              message: `Blocked: writes restricted to ${projectDir}`
            };
          }
        }
        // Allow all other tools (Read, Glob, Grep, Bash with cwd enforcement)
      }
    ]
  };
}

module.exports = { createWriteSandbox };
