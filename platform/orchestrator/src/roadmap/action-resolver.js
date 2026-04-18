const fs = require('fs/promises');
const path = require('path');
const { RoadmapReader } = require('./roadmap-reader');
const { EnvManager } = require('../infra/env-manager');

const ENV_KEYWORD_PATTERN = /(\bapi.?keys?\b|\benvironment.?variables?\b|\.env\b|\bsecrets?\b|\bcredentials\b)/i;

class ActionResolver {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.roadmapReader = new RoadmapReader(projectDir);
    this.envManager = new EnvManager(projectDir);
    this.interventionsPath = path.join(projectDir, 'openspec', 'interventions.json');
  }

  /**
   * Analyze incomplete HUMAN-tagged roadmap items.
   * Returns: { items: [{ id, description, phaseNumber, phaseLabel, status, actionType, envDetails? }] }
   */
  async analyze() {
    if (!(await this.roadmapReader.exists())) {
      const err = new Error('No roadmap.md found in project');
      err.code = 'NO_ROADMAP';
      throw err;
    }

    const roadmap = await this.roadmapReader.parse();
    const allItems = this.roadmapReader.getAllItems(roadmap);
    const actionablePhases = new Set(this.roadmapReader.getActionablePhaseNumbers(roadmap));

    // Filter to incomplete HUMAN items (pending or parked, with [HUMAN] tag)
    const humanItems = allItems.filter(
      item => item.isHuman && item.status !== 'complete'
    );

    // Split into actionable vs deferred
    const actionableHumanItems = humanItems.filter(item => actionablePhases.has(item.phaseNumber));
    const deferredCount = humanItems.length - actionableHumanItems.length;

    const hasEnvExample = await this.envManager.hasEnvExample();

    // Load interventions sidecar file
    const interventions = await this._loadInterventions();

    const items = [];
    for (const item of actionableHumanItems) {
      // Check if there's a matching intervention with structured instructions
      const intervention = interventions.get(item.id);

      let actionType;
      if (intervention) {
        actionType = 'intervention';
      } else if (this._isEnvRelated(item.description) && hasEnvExample) {
        actionType = 'env_setup';
      } else {
        actionType = 'manual';
      }

      const entry = {
        id: item.id,
        description: item.description.replace(/\s*\[HUMAN\]\s*/g, '').trim(),
        phaseNumber: item.phaseNumber,
        phaseLabel: item.phaseLabel,
        groupLetter: item.groupLetter,
        groupLabel: item.groupLabel,
        status: item.status,
        actionType
      };

      if (actionType === 'intervention') {
        entry.interventionDetails = intervention;
      } else if (actionType === 'env_setup') {
        const missingKeys = await this.envManager.getMissingKeys();
        const existingKeys = await this.envManager.getExistingKeys();
        entry.envDetails = {
          missingKeys,
          alreadySet: [...existingKeys],
          envExamplePath: this.envManager.envExamplePath
        };
      }

      items.push(entry);
    }

    return { items, deferredCount };
  }

  /**
   * Check if description relates to environment/API key setup.
   */
  _isEnvRelated(description) {
    return ENV_KEYWORD_PATTERN.test(description);
  }

  /**
   * Mark a roadmap item as complete.
   */
  async resolveItem(itemId) {
    await this.roadmapReader.markItemComplete(itemId);
  }

  /**
   * Write env key values to .env file.
   */
  async writeEnvValues(keyValues) {
    await this.envManager.writeKeys(keyValues);
  }

  /**
   * Load interventions from the sidecar file.
   * Returns a Map of requirementId → intervention details.
   */
  async _loadInterventions() {
    const interventions = new Map();
    try {
      const content = await fs.readFile(this.interventionsPath, 'utf-8');
      const data = JSON.parse(content);
      for (const entry of (data.interventions || [])) {
        if (!entry.resolved) {
          interventions.set(entry.requirementId, entry);
        }
      }
    } catch {
      // File doesn't exist or is malformed — no interventions
    }
    return interventions;
  }

  /**
   * Resolve an intervention: mark as resolved in sidecar file and complete in roadmap.
   */
  async resolveIntervention(itemId) {
    await this.roadmapReader.markItemComplete(itemId);

    // Update sidecar file
    try {
      const content = await fs.readFile(this.interventionsPath, 'utf-8');
      const data = JSON.parse(content);
      for (const entry of (data.interventions || [])) {
        if (entry.requirementId === itemId) {
          entry.resolved = true;
          entry.resolvedAt = new Date().toISOString();
        }
      }
      await fs.writeFile(this.interventionsPath, JSON.stringify(data, null, 2));
    } catch {
      // Sidecar file missing — roadmap was still updated
    }
  }
}

// ENV_KEYWORD_PATTERN exported for testing
module.exports = { ActionResolver, ENV_KEYWORD_PATTERN };
