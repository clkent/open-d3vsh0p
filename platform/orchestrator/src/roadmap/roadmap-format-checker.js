const fs = require('fs/promises');
const path = require('path');
const { RoadmapReader } = require('./roadmap-reader');
const { RoadmapValidator } = require('./roadmap-validator');

// Same regex the parser uses to match valid items
const ITEM_REGEX = /^- \[([x !\-])\]\s+`([^`]+)`\s*(?:—|--|-)\s*(.+)$/;

// Matches any checkbox line (valid or freeform)
const CHECKBOX_REGEX = /^- \[([x !\-])\]\s+(.+)$/;

/**
 * Scan raw roadmap markdown for lines that look like checkbox items
 * but don't match the parser's item regex. These are "near-misses" —
 * lines Riley intended as roadmap items but formatted wrong.
 *
 * @param {string} content - Raw markdown content
 * @returns {string[]} Array of diagnostic messages with line numbers
 */
function findNearMisses(content) {
  const lines = content.split('\n');
  const nearMisses = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Only look at checkbox lines
    if (!CHECKBOX_REGEX.test(line)) continue;

    // If it matches the full item regex, it's valid — skip
    if (ITEM_REGEX.test(line)) continue;

    // It's a near-miss. Diagnose the problem.
    const lineNum = i + 1;
    const hint = diagnoseNearMiss(line);
    nearMisses.push(`Line ${lineNum}: "${line.trim()}" — ${hint}`);
  }

  return nearMisses;
}

/**
 * Diagnose why a checkbox line doesn't match the item regex.
 */
function diagnoseNearMiss(line) {
  const hasBackticks = /`[^`]+`/.test(line);
  const hasEmDash = /—/.test(line);
  const hasDoubleDash = /--/.test(line);
  const hasSingleDash = / - /.test(line);
  const hasSeparator = hasEmDash || hasDoubleDash || hasSingleDash;

  if (!hasBackticks && !hasSeparator) {
    return 'missing `kebab-id` in backticks and em-dash separator';
  }
  if (!hasBackticks) {
    return 'missing `kebab-id` in backticks before the em-dash';
  }
  if (!hasSeparator) {
    return 'missing em-dash (—) separator between ID and description';
  }
  return 'format not recognized — expected: - [ ] `kebab-id` — Description';
}

/**
 * Scan raw roadmap content for Phase/Group headings at wrong heading levels.
 * Only called when the parser can't find phases or groups.
 *
 * @param {string} content - Raw markdown content
 * @param {object} roadmap - Parsed roadmap from RoadmapReader
 * @returns {string[]} Array of diagnostic messages
 */
function findHeadingLevelIssues(content, roadmap) {
  const lines = content.split('\n');
  const diagnostics = [];

  // Wrong-level phase headings: ### Phase, #### Phase, etc. (should be ##)
  if (roadmap.phases.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{3,})\s+(Phase\s+.+)$/i);
      if (match) {
        diagnostics.push(
          `Line ${i + 1}: Found \`${match[1]} ${match[2].trim()}\` — use \`##\` for phase headings`
        );
      }
    }
  }

  // Wrong-level group headings: ## Group, #### Group, etc. (should be ###)
  const phasesWithNoGroups = roadmap.phases.filter(p => p.groups.length === 0);
  if (phasesWithNoGroups.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{2}(?!#)|#{4,})\s+(Group\s+.+)$/i);
      if (match) {
        diagnostics.push(
          `Line ${i + 1}: Found \`${match[1]} ${match[2].trim()}\` — use \`###\` for group headings`
        );
      }
    }
  }

  return diagnostics;
}

/**
 * Validate the roadmap format for a project directory.
 * Reads the roadmap file, checks for near-misses in raw content,
 * then parses and validates structure.
 *
 * @param {string} projectDir - Path to the project directory
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[], nearMisses: string[], headingIssues: string[] }>}
 */
async function validateRoadmapFormat(projectDir) {
  const roadmapPath = path.join(projectDir, 'openspec', 'roadmap.md');

  // Check file exists
  let content;
  try {
    content = await fs.readFile(roadmapPath, 'utf-8');
  } catch {
    return {
      valid: false,
      errors: ['roadmap.md not found'],
      warnings: [],
      nearMisses: [],
      headingIssues: []
    };
  }

  // Check for near-misses in raw content
  const nearMisses = findNearMisses(content);

  // Parse and validate structure
  const reader = new RoadmapReader(projectDir);
  const roadmap = reader.parseContent(content);
  const validation = RoadmapValidator.validate(roadmap);

  // Heading-level diagnostics (only when parser couldn't find phases/groups)
  const headingIssues = findHeadingLevelIssues(content, roadmap);

  // Spec-count cross-check: warn if roadmap items < spec files
  const warnings = [...validation.warnings];
  try {
    const specsDir = path.join(projectDir, 'openspec', 'specs');
    const specEntries = await fs.readdir(specsDir, { withFileTypes: true });
    const specCount = specEntries.filter(e => e.isDirectory()).length;
    const totalItems = roadmap.phases.reduce(
      (sum, p) => sum + p.groups.reduce((gs, g) => gs + g.items.length, 0), 0
    );
    if (specCount > 0 && totalItems > 0 && totalItems < specCount) {
      warnings.push(
        `Roadmap has ${totalItems} items but project has ${specCount} specs — items may be bundled (each spec should map to at least one roadmap item)`
      );
    }
  } catch {
    // specs dir may not exist yet during early kickoff — that's fine
  }

  // Near-misses and heading issues cause invalid result
  const valid = validation.valid && nearMisses.length === 0 && headingIssues.length === 0;

  return {
    valid,
    errors: validation.errors,
    warnings,
    nearMisses,
    headingIssues
  };
}

/**
 * Build a chat message for Riley to fix roadmap format issues.
 *
 * @param {{ valid: boolean, errors: string[], warnings: string[], nearMisses: string[] }} result
 * @param {string} projectDir - Path to the project directory
 * @returns {string}
 */
function buildRoadmapFixPrompt(result, projectDir) {
  const parts = [];

  parts.push(`The roadmap at ${projectDir}/openspec/roadmap.md has formatting issues that will break the orchestrator. Please fix them now.\n`);

  if (result.headingIssues && result.headingIssues.length > 0) {
    parts.push('**Heading-level errors** (phases and groups use wrong heading depth):');
    for (const issue of result.headingIssues) {
      parts.push(`  - ${issue}`);
    }
    parts.push('');
    parts.push('**Required heading levels:**');
    parts.push('- Phases: `## Phase I: Label` (two #)');
    parts.push('- Groups: `### Group A: Label` (three #)');
    parts.push('');
  }

  if (result.nearMisses.length > 0) {
    parts.push('**Near-miss items** (checkbox lines that the parser will skip):');
    for (const miss of result.nearMisses) {
      parts.push(`  - ${miss}`);
    }
    parts.push('');
  }

  if (result.errors.length > 0) {
    parts.push('**Structural errors**:');
    for (const err of result.errors) {
      parts.push(`  - ${err}`);
    }
    parts.push('');
  }

  if (result.warnings.length > 0) {
    parts.push('**Warnings**:');
    for (const warn of result.warnings) {
      parts.push(`  - ${warn}`);
    }
    parts.push('');
  }

  parts.push('**Required format** for every roadmap item:');
  parts.push('```');
  parts.push('- [ ] `kebab-case-id` — Description of the requirement');
  parts.push('```');
  parts.push('');
  parts.push('Each item MUST have:');
  parts.push('1. A checkbox `- [ ]` (or `- [x]` for complete, `- [!]` for parked)');
  parts.push('2. A requirement ID in backticks (lowercase, hyphens, 2+ chars)');
  parts.push('3. An em-dash `—` separating the ID from the description');
  parts.push('');
  parts.push('Please rewrite the roadmap file to fix all issues listed above.');

  return parts.join('\n');
}

module.exports = { findNearMisses, findHeadingLevelIssues, validateRoadmapFormat, buildRoadmapFixPrompt };
