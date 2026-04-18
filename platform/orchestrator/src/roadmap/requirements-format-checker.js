const fs = require('fs/promises');
const path = require('path');

// Matches lines that look like they could be requirements headers
// but use wrong markdown level (####, #####, etc.) or wrong section name
const REQUIREMENTS_HEADER_REGEX = /^## Requirements/;
const REQUIREMENT_ITEM_REGEX = /^### .+/;

/**
 * Validate that project.md has a parseable Requirements section.
 * The orchestrator's OpenSpecReader._parseRequirements() expects:
 *   ## Requirements
 *   ### Requirement Name
 *   - Bullet point
 *
 * @param {string} projectDir - Path to the project directory
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 */
async function validateRequirementsFormat(projectDir) {
  const projectMdPath = path.join(projectDir, 'openspec', 'project.md');

  let content;
  try {
    content = await fs.readFile(projectMdPath, 'utf-8');
  } catch {
    return {
      valid: false,
      errors: ['project.md not found'],
      warnings: []
    };
  }

  return checkRequirementsContent(content);
}

/**
 * Check raw project.md content for requirements format issues.
 * Pure function for testability.
 *
 * @param {string} content - Raw markdown content
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function checkRequirementsContent(content) {
  const lines = content.split('\n');
  const errors = [];
  const warnings = [];

  // Check for ## Requirements section
  const hasRequirementsSection = lines.some(l => REQUIREMENTS_HEADER_REGEX.test(l));

  if (!hasRequirementsSection) {
    // Check for common misspellings/alternatives
    const nearMissHeaders = lines.filter(l =>
      /^##\s+requirement/i.test(l) && !REQUIREMENTS_HEADER_REGEX.test(l)
    );
    if (nearMissHeaders.length > 0) {
      errors.push(`Found "${nearMissHeaders[0].trim()}" but expected exactly "## Requirements" (case-sensitive)`);
    } else {
      errors.push('Missing "## Requirements" section — the orchestrator cannot find any requirements to implement');
    }
    return { valid: false, errors, warnings };
  }

  // Count requirement items (### headers inside ## Requirements)
  let inRequirements = false;
  let requirementCount = 0;
  let bulletCount = 0;
  let requirementsWithNoBullets = [];
  let currentReqName = null;
  let currentReqBullets = 0;

  for (const line of lines) {
    if (REQUIREMENTS_HEADER_REGEX.test(line)) {
      inRequirements = true;
      continue;
    }
    if (inRequirements && line.startsWith('## ') && !REQUIREMENTS_HEADER_REGEX.test(line)) {
      // Flush last requirement
      if (currentReqName && currentReqBullets === 0) {
        requirementsWithNoBullets.push(currentReqName);
      }
      inRequirements = false;
      continue;
    }
    if (!inRequirements) continue;

    if (line.startsWith('### ')) {
      // Flush previous requirement
      if (currentReqName && currentReqBullets === 0) {
        requirementsWithNoBullets.push(currentReqName);
      }
      requirementCount++;
      currentReqName = line.slice(4).trim();
      currentReqBullets = 0;
    } else if (line.startsWith('- ') && currentReqName) {
      bulletCount++;
      currentReqBullets++;
    }
  }
  // Flush last
  if (currentReqName && currentReqBullets === 0) {
    requirementsWithNoBullets.push(currentReqName);
  }

  if (requirementCount === 0) {
    errors.push('## Requirements section exists but contains no ### requirement headers — the orchestrator needs at least one requirement (### Name followed by bullet points)');
  }

  if (bulletCount === 0 && requirementCount > 0) {
    warnings.push('Requirements have no bullet points — implementation agents need bullet-point requirements to know what to build');
  }

  for (const name of requirementsWithNoBullets) {
    warnings.push(`Requirement "${name}" has no bullet points — agents may not know what to implement`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Build a chat message for Riley to fix requirements format issues.
 *
 * @param {{ valid: boolean, errors: string[], warnings: string[] }} result
 * @param {string} projectDir
 * @returns {string}
 */
function buildRequirementsFixPrompt(result, projectDir) {
  const parts = [];

  parts.push(`The project file at ${projectDir}/openspec/project.md has formatting issues that will prevent the orchestrator from finding requirements.\n`);

  if (result.errors.length > 0) {
    parts.push('**Errors**:');
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

  parts.push('**Required format** for the requirements section in project.md:');
  parts.push('```markdown');
  parts.push('## Requirements');
  parts.push('');
  parts.push('### Requirement Name');
  parts.push('- Specific thing the implementation agent should build');
  parts.push('- Another requirement bullet point');
  parts.push('');
  parts.push('### Another Requirement');
  parts.push('- What the agent should do');
  parts.push('```');
  parts.push('');
  parts.push('Each requirement MUST have:');
  parts.push('1. A `### ` header (h3) with the requirement name');
  parts.push('2. One or more bullet points starting with `- ` describing what to implement');
  parts.push('');
  parts.push('Please fix the project.md file to include a properly formatted ## Requirements section.');

  return parts.join('\n');
}

module.exports = { validateRequirementsFormat, checkRequirementsContent, buildRequirementsFixPrompt };
