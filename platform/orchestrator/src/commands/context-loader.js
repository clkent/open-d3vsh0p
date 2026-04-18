const fs = require('fs/promises');
const path = require('path');

/**
 * Load all .md files from <projectDir>/context/ and concatenate them
 * with filename headers. Returns empty string if directory is missing or empty.
 */
async function loadProjectContext(projectDir) {
  const contextDir = path.join(projectDir, 'context');

  let entries;
  try {
    entries = await fs.readdir(contextDir);
  } catch {
    return '';
  }

  const mdFiles = entries.filter(f => f.endsWith('.md')).sort();
  if (mdFiles.length === 0) return '';

  const sections = [];
  for (const file of mdFiles) {
    const content = await fs.readFile(path.join(contextDir, file), 'utf-8');
    sections.push(`### ${file}\n\n${content.trim()}`);
  }

  return sections.join('\n\n');
}

module.exports = { loadProjectContext };
