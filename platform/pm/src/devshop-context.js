const fs = require('fs/promises');
const path = require('path');

const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Files to load as read-only context for the PM agent.
 * Each entry specifies the file path (relative to DEVSHOP_ROOT) and a label
 * that helps Riley understand what the file does.
 */
const CONTEXT_FILES = [
  {
    path: 'platform/orchestrator/src/roadmap/roadmap-reader.js',
    label: 'Roadmap Parser — this is the exact code that parses your roadmap.md into structured data'
  },
  {
    path: 'platform/orchestrator/src/roadmap/roadmap-validator.js',
    label: 'Roadmap Validator — this validates the parsed roadmap and rejects bad IDs, duplicates, empty phases'
  },
  {
    path: 'platform/orchestrator/src/roadmap/roadmap-format-checker.js',
    label: 'Roadmap Format Checker — detects near-miss items, wrong heading levels, spec-count mismatches'
  },
  {
    path: 'templates/agents/implementation-agent/system-prompt.md',
    label: 'Implementation Agent Prompt — this is what implementation agents see when they build from your specs'
  },
  {
    path: 'templates/agents/principal-engineer/system-prompt.md',
    label: 'Review Agent Prompt — this is what the principal engineer checks during code review'
  }
];

/**
 * Load DevShop internal files as read-only context for the PM agent.
 * Returns a formatted string suitable for injection into the system prompt.
 *
 * Missing files are logged and skipped — never fatal.
 *
 * @param {object} [options]
 * @param {function} [options.warn] - Warning logger (default: console.warn)
 * @param {string} [options.devshopRoot] - Override DevShop root (for testing)
 * @returns {Promise<string>} Formatted context string
 */
async function loadDevShopContext(options = {}) {
  const warn = options.warn || console.warn;
  const root = options.devshopRoot || DEVSHOP_ROOT;

  const sections = [];

  for (const file of CONTEXT_FILES) {
    const filePath = path.join(root, file.path);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      sections.push(`### ${file.label}\n\`\`\`\n${content.trimEnd()}\n\`\`\``);
    } catch (err) {
      warn(`DevShop context: could not load ${file.path}: ${err.message}`);
    }
  }

  if (sections.length === 0) {
    return '';
  }

  return sections.join('\n\n');
}

module.exports = { loadDevShopContext, CONTEXT_FILES };
