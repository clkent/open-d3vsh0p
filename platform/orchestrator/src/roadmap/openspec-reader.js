const fs = require('fs/promises');
const path = require('path');

class OpenSpecReader {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.openspecDir = path.join(projectDir, 'openspec');
    this._projectMdCache = null;
  }

  async _getProjectMd() {
    if (!this._projectMdCache) {
      const projectMdPath = path.join(this.openspecDir, 'project.md');
      this._projectMdCache = await fs.readFile(projectMdPath, 'utf-8');
    }
    return this._projectMdCache;
  }

  async getRequirements() {
    const content = await this._getProjectMd();
    return this._parseRequirements(content);
  }

  async getNextRequirement(state) {
    const all = await this.getRequirements();
    const done = new Set([
      ...state.requirements.completed,
      ...state.requirements.parked.map(p => typeof p === 'string' ? p : p.id)
    ]);

    // If specific requirements were requested, filter to those
    if (state.targetRequirements) {
      return all.find(r => state.targetRequirements.includes(r.id) && !done.has(r.id)) || null;
    }

    return all.find(r => !done.has(r.id)) || null;
  }

  async getRequirementById(requirementId) {
    const all = await this.getRequirements();
    return all.find(r => r.id === requirementId) || null;
  }

  async parseProjectName() {
    const content = await this._getProjectMd();
    const firstLine = content.split('\n').find(l => l.startsWith('# '));
    if (firstLine) {
      return firstLine.slice(2).trim();
    }
    return 'Unknown Project';
  }

  async parseConventions() {
    const conventionsPath = path.join(this.openspecDir, 'conventions.md');
    try {
      return await fs.readFile(conventionsPath, 'utf-8');
    } catch {
      return null;
    }
  }

  async parseGotchas() {
    const gotchasPath = path.join(this.openspecDir, 'gotchas.md');
    try {
      return await fs.readFile(gotchasPath, 'utf-8');
    } catch {
      return null;
    }
  }

  async hasDesignSkills() {
    try {
      await fs.access(path.join(this.projectDir, '.claude', 'skills', 'frontend-design'));
      return true;
    } catch {
      return false;
    }
  }

  async getDesignSkillsSection() {
    const has = await this.hasDesignSkills();
    if (!has) return '';
    return OpenSpecReader.DESIGN_SKILLS_INSTRUCTIONS;
  }

  async parseTechStack() {
    const content = await this._getProjectMd();
    const lines = content.split('\n');
    let inTechStack = false;
    const bullets = [];

    for (const line of lines) {
      if (line.startsWith('## Tech Stack')) {
        inTechStack = true;
        continue;
      }
      if (inTechStack && line.startsWith('## ')) {
        break;
      }
      if (inTechStack && line.startsWith('- ')) {
        bullets.push(line.slice(2).trim());
      }
    }

    return bullets.length > 0 ? bullets.join(', ') : 'Not specified';
  }

  _parseRequirements(markdown) {
    const requirements = [];
    const lines = markdown.split('\n');
    let currentReq = null;
    let inRequirementsSection = false;

    for (const line of lines) {
      // Look for the ## Requirements section
      if (line.startsWith('## Requirements')) {
        inRequirementsSection = true;
        continue;
      }

      // Stop at the next ## section
      if (inRequirementsSection && line.startsWith('## ') && !line.startsWith('## Requirements')) {
        inRequirementsSection = false;
        if (currentReq) {
          requirements.push(currentReq);
          currentReq = null;
        }
        continue;
      }

      if (!inRequirementsSection) continue;

      // Each ### is a requirement
      if (line.startsWith('### ')) {
        if (currentReq) requirements.push(currentReq);
        const name = line.slice(4).trim();
        currentReq = {
          id: this._toKebab(name),
          name,
          changeName: 'add-' + this._toKebab(name),
          bullets: []
        };
      } else if (currentReq && line.startsWith('- ')) {
        currentReq.bullets.push(line.slice(2).trim());
      }
    }

    if (currentReq) requirements.push(currentReq);
    return requirements;
  }

  buildPreflightPrompt(requirement) {
    const bullets = requirement.bullets.map(b => `- ${b}`).join('\n');
    return (
      `## Pre-Implementation Planning\n` +
      `You are about to implement the "${requirement.name}" feature. Before writing any code, analyze the requirement and create a brief plan.\n\n` +
      `## Requirements\n` +
      `${bullets}\n\n` +
      `## Project Context\n` +
      `- Working directory: ${this.projectDir}\n` +
      `- Source code: ${path.join(this.projectDir, 'src')}\n\n` +
      `## Your Task\n` +
      `Output a brief plan (under 200 words) covering:\n\n` +
      `1. **Files to modify/create** — List specific file paths\n` +
      `2. **Files to read first** — What existing code do you need to understand?\n` +
      `3. **Risks** — What could go wrong? (dependencies, breaking changes, edge cases)\n` +
      `4. **Approach** — 2-3 sentence description of your implementation strategy\n\n` +
      `This is thinking time, not implementation time. Do not write any code.`
    );
  }

  buildImplementationPrompt(requirement, preflightPlan, peerContext, phaseContext) {
    const bullets = requirement.bullets.map(b => `- ${b}`).join('\n');
    const planSection = preflightPlan
      ? `## Your Pre-Implementation Plan\n${preflightPlan}\n\nFollow the plan above. If you discover the plan was wrong, adjust — but explain why.\n\n`
      : '';

    // Parallel work section
    let peerSection = '';
    if (peerContext && peerContext.length > 0) {
      const peerEntries = peerContext.map(p => {
        const peerBullets = p.bullets.map(b => `  - ${b}`).join('\n');
        return `- **${p.personaName}** is implementing "${p.requirementName}":\n${peerBullets}`;
      }).join('\n');
      const sharedWarning = OpenSpecReader._detectSharedFileKeywords(
        requirement.bullets,
        peerContext.flatMap(p => p.bullets)
      );
      const warningText = sharedWarning ? `\n\n${sharedWarning}` : '';
      peerSection =
        `## Parallel Work (Other Agents)\n` +
        `Other agents are simultaneously implementing requirements in separate worktrees:\n\n` +
        `${peerEntries}\n\n` +
        `Coordinate by: using stable interfaces, not modifying files the other agent is likely touching, ` +
        `and not creating conflicting exports or routes.${warningText}\n\n`;
    }

    // Phase context section (already-merged items)
    let phaseSection = '';
    if (phaseContext && phaseContext.length > 0) {
      const items = phaseContext.map(i => `- \`${i.id}\`: ${i.description}`).join('\n');
      phaseSection =
        `## Already Completed This Phase\n` +
        `The following requirements have already been merged. Their code is on the session branch.\n` +
        `${items}\n\n`;
    }

    return (
      `## Your Assignment\n` +
      `Implement the "${requirement.name}" feature.\n\n` +
      `## Requirements\n` +
      `${bullets}\n\n` +
      `## Project Context\n` +
      `- Working directory: ${this.projectDir}\n` +
      `- Source code: ${path.join(this.projectDir, 'src')}\n` +
      `- Existing code: Read the current src/ directory to understand patterns before writing new code\n\n` +
      peerSection +
      phaseSection +
      planSection +
      `## Instructions\n` +
      `1. Read existing code first — understand the project's patterns, structure, and conventions\n` +
      `2. Implement the requirements incrementally — don't try to build everything at once\n` +
      `3. Write tests for each piece as you go\n` +
      `4. Commit after each logical unit using conventional commit format\n` +
      `5. Run tests before your final commit to make sure everything passes`
    );
  }

  static _detectSharedFileKeywords(currentBullets, peerBullets) {
    const SHARED_FILE_KEYWORDS = [
      'route', 'api', 'config', 'schema', 'database', 'middleware',
      'model', 'controller', 'handler', 'endpoint', 'migration', 'auth'
    ];
    const normalize = (bullets) => {
      const text = bullets.join(' ').toLowerCase();
      return SHARED_FILE_KEYWORDS.filter(kw => text.includes(kw));
    };
    const currentKws = normalize(currentBullets || []);
    const peerKws = normalize(peerBullets || []);
    const overlap = currentKws.filter(kw => peerKws.includes(kw));
    if (overlap.length === 0) return '';
    return `**Shared file warning:** Both your requirement and a peer requirement reference: ${overlap.join(', ')}. Be careful with shared files in these areas.`;
  }

  buildRetryPrompt(requirement, errorContext, attemptNumber, attemptHistory) {
    const bullets = requirement.bullets.map(b => `- ${b}`).join('\n');

    // Cap error context to 2000 chars to improve signal-to-noise
    const maxErrorLength = 2000;
    const truncatedError = errorContext.length > maxErrorLength
      ? errorContext.slice(0, maxErrorLength) + '\n... (truncated, ' + (errorContext.length - maxErrorLength) + ' chars omitted)'
      : errorContext;

    // Strategy-shift instructions based on attempt number
    let strategyShift = '';
    if (attemptNumber >= 3) {
      strategyShift =
        `## Strategy Shift Required\n` +
        `This is your final attempt. Previous approaches have failed twice. You MUST try a significantly different strategy. ` +
        `Review the failure history below and identify the root pattern -- don't just tweak the same code.\n\n`;
    } else if (attemptNumber === 2) {
      strategyShift =
        `## Strategy Shift Recommended\n` +
        `Your previous approach didn't work. Before fixing the same code, consider whether a fundamentally different ` +
        `strategy would be more appropriate. If you're retrying the same approach, explain why you believe it will work this time.\n\n`;
    }

    // Attempt history section — collapse older entries when 3+ attempts
    let historySection = '';
    if (attemptHistory && attemptHistory.length > 0) {
      let historyLines;
      if (attemptHistory.length >= 3) {
        const older = attemptHistory.slice(0, -2);
        const recent = attemptHistory.slice(-2);
        const olderSummary = `Attempts 1-${older.length}: ${[...new Set(older.map(h => h.type))].join(', ')} failures`;
        historyLines = [
          `- ${olderSummary}`,
          ...recent.map(h => `- Attempt ${h.attempt}: ${h.error}`)
        ].join('\n');
      } else {
        historyLines = attemptHistory
          .map(h => `- Attempt ${h.attempt}: ${h.error}`)
          .join('\n');
      }
      const types = [...new Set(attemptHistory.map(h => h.type))];
      const patternNote = types.length === 1
        ? `These are the same type of failure (${types[0]}). Consider a fundamentally different approach.`
        : `These are different failure modes. Identify the underlying pattern.`;
      historySection =
        `## Attempt History\n` +
        `${historyLines}\n\n` +
        `${patternNote}\n\n`;
    }

    return (
      `## Your Assignment\n` +
      `Implement the "${requirement.name}" feature.\n\n` +
      `## Requirements\n` +
      `${bullets}\n\n` +
      `## Project Context\n` +
      `- Working directory: ${this.projectDir}\n` +
      `- Source code: ${path.join(this.projectDir, 'src')}\n\n` +
      strategyShift +
      historySection +
      `## Previous Attempt Results\n` +
      `Your previous implementation had issues that need to be addressed:\n\n` +
      `${truncatedError}\n\n` +
      `## What To Do\n` +
      `Address each issue specifically. Don't rewrite everything — fix what's broken.\n` +
      `If tests failed, focus on making them pass.\n` +
      `If Morgan requested changes, address every point in the feedback.`
    );
  }

  buildReviewPrompt(requirement, diff, diffStat, phaseContext = [], designSkillsSection = '') {
    const bullets = requirement.bullets.map(b => `- ${b}`).join('\n');

    let phaseContextSection = '';
    if (phaseContext.length > 0) {
      const items = phaseContext.map(i => `- \`${i.id}\`: ${i.description}`).join('\n');
      phaseContextSection =
        `## Other Work Merged This Phase\n` +
        `The following requirements have already been merged in the same phase. ` +
        `Consider whether this implementation is compatible with them.\n` +
        `${items}\n\n`;
    }

    let designReviewSection = '';
    if (designSkillsSection) {
      designReviewSection =
        `\n\n## Design Quality Review\n` +
        `This project has design skills installed. Include \`design_quality\` in your scoring JSON:\n` +
        OpenSpecReader.DESIGN_REVIEW_SECTION;
    }

    return (
      `## Review Assignment\n` +
      `Review the implementation of the "${requirement.name}" feature.\n\n` +
      `## Requirements Being Implemented\n` +
      `${bullets}\n\n` +
      phaseContextSection +
      `## Changes Summary\n` +
      `${diffStat}\n\n` +
      `## Full Diff\n` +
      `\`\`\`\n${diff}\n\`\`\`\n\n` +
      `## Your Review\n` +
      `Evaluate against your review criteria. Be specific in feedback.\n` +
      `Remember: approve if it's good enough to ship. Request changes only for real issues.\n` +
      `Pay special attention to whether the implementation uses real logic or contains mock/placeholder/simulated patterns.` +
      designReviewSection
    );
  }

  _toKebab(str) {
    return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }
}

OpenSpecReader.DESIGN_SKILLS_INSTRUCTIONS = `## Design Skills

This project has Impeccable design skills installed. When working on frontend code:

1. **Run \`/polish\`** on every new or modified \`.tsx\`, \`.vue\`, \`.svelte\`, or \`.jsx\` file before committing — this refines spacing, typography, and visual consistency
2. **Run \`/audit\`** before your final commit — this checks design consistency across the codebase (color contrast, spacing system, responsive patterns)

Only apply these to UI component files. Skip for config files, tests, utilities, and backend code.`;

OpenSpecReader.DESIGN_REVIEW_SECTION = `
**design_quality** — Does the frontend code follow good design practices? (Only score when diff contains .tsx/.vue/.svelte/.jsx/.css/.scss files)
- 5: Consistent spacing system, readable typography, accessible color contrast (WCAG AA), responsive layout patterns, no hardcoded magic pixel values
- 4: Good design patterns with minor inconsistencies
- 3: Acceptable design, some spacing/typography issues
- 2: Inconsistent spacing, poor contrast, hardcoded pixel values throughout
- 1: No design consideration — random spacing, inaccessible colors, no responsive patterns`;

module.exports = { OpenSpecReader };
