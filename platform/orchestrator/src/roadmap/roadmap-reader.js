const fs = require('fs/promises');
const path = require('path');

class RoadmapReader {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.roadmapPath = path.join(projectDir, 'openspec', 'roadmap.md');
  }

  /**
   * Check if a roadmap.md exists for this project.
   */
  async exists() {
    try {
      await fs.access(this.roadmapPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse roadmap.md into structured phases/groups/items.
   * Returns: { title, phases: [{ number, label, depends, groups: [{ letter, label, items: [{ id, description, status }] }] }] }
   */
  async parse() {
    const content = await fs.readFile(this.roadmapPath, 'utf-8');
    return this.parseContent(content);
  }

  /**
   * Parse roadmap content string (for testability).
   */
  parseContent(content) {
    const lines = content.split('\n');
    const roadmap = { title: '', phases: [] };
    let currentPhase = null;
    let currentGroup = null;

    for (const line of lines) {
      // # Roadmap: Title
      const titleMatch = line.match(/^# Roadmap:\s*(.+)$/);
      if (titleMatch) {
        roadmap.title = titleMatch[1].trim();
        continue;
      }

      // ## Phase N: Label
      const phaseMatch = line.match(/^## Phase\s+([IVXLC]+|[0-9]+):\s*(.+)$/);
      if (phaseMatch) {
        if (currentGroup && currentPhase) {
          currentPhase.groups.push(currentGroup);
        }
        if (currentPhase) {
          roadmap.phases.push(currentPhase);
        }
        currentPhase = {
          number: phaseMatch[1],
          label: phaseMatch[2].trim(),
          depends: null,
          groups: []
        };
        currentGroup = null;
        continue;
      }

      // <!-- depends: Phase I --> or <!-- depends: Phase IV, Phase V -->
      const dependsMatch = line.match(/<!--\s*depends:\s*(.+?)\s*-->/);
      if (dependsMatch && currentPhase) {
        const deps = dependsMatch[1]
          .split(/,\s*/)
          .map(d => d.replace(/^Phase\s+/, '').trim())
          .filter(Boolean);
        currentPhase.depends = deps;
        continue;
      }

      // ### Group X: Label
      const groupMatch = line.match(/^### Group\s+([A-Z]):\s*(.+)$/);
      if (groupMatch && currentPhase) {
        if (currentGroup) {
          currentPhase.groups.push(currentGroup);
        }
        currentGroup = {
          letter: groupMatch[1],
          label: groupMatch[2].trim(),
          items: []
        };
        continue;
      }

      // - [ ] `requirement-id` — Description  (pending)
      // - [x] `requirement-id` — Description  (complete)
      // - [!] `requirement-id` — Description  (parked)
      const itemMatch = line.match(/^- \[([x !\-])\]\s+`([^`]+)`\s*(?:—|--|-)\s*(.+)$/);
      if (itemMatch && currentGroup) {
        const marker = itemMatch[1];
        let status = 'pending';
        if (marker === 'x') status = 'complete';
        else if (marker === '!') status = 'parked';

        const description = itemMatch[3].trim();
        currentGroup.items.push({
          id: itemMatch[2].trim(),
          description,
          status,
          isHuman: description.includes('[HUMAN]'),
          isSpike: description.includes('[SPIKE]')
        });
        continue;
      }
    }

    // Push last group and phase
    if (currentGroup && currentPhase) {
      currentPhase.groups.push(currentGroup);
    }
    if (currentPhase) {
      roadmap.phases.push(currentPhase);
    }

    // Set implicit dependencies: each phase depends on the previous unless explicit
    for (let i = 1; i < roadmap.phases.length; i++) {
      if (!roadmap.phases[i].depends) {
        roadmap.phases[i].depends = [roadmap.phases[i - 1].number];
      }
    }

    return roadmap;
  }

  /**
   * Get phase numbers for all phases whose dependencies are satisfied.
   * A phase is actionable when all items in its dependency phases are complete or parked.
   */
  getActionablePhaseNumbers(roadmap) {
    const actionable = [];
    for (const phase of roadmap.phases) {
      if (!phase.depends || phase.depends.length === 0) {
        actionable.push(phase.number);
        continue;
      }
      const allDepsSatisfied = phase.depends.every(depNumber => {
        const depPhase = roadmap.phases.find(p => p.number === depNumber);
        if (!depPhase) return true;
        return depPhase.groups.every(g =>
          g.items.every(i => i.status === 'complete' || i.status === 'parked')
        );
      });
      if (allDepsSatisfied) {
        actionable.push(phase.number);
      }
    }
    return actionable;
  }

  /**
   * Mark a requirement item as complete in the roadmap file.
   */
  async markItemComplete(requirementId) {
    await this._updateItemStatus(requirementId, 'x');
  }

  async _updateItemStatus(requirementId, marker) {
    let content = await fs.readFile(this.roadmapPath, 'utf-8');

    // Match any checkbox status for this requirement ID
    const pattern = new RegExp(
      `^(- \\[)[x !\\-](\\]\\s+\`${this._escapeRegex(requirementId)}\`)`,
      'm'
    );

    content = content.replace(pattern, `$1${marker}$2`);
    await fs.writeFile(this.roadmapPath, content);
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get a flat list of all items across all phases.
   */
  getAllItems(roadmap) {
    const items = [];
    for (const phase of roadmap.phases) {
      for (const group of phase.groups) {
        for (const item of group.items) {
          items.push({
            ...item,
            phaseNumber: phase.number,
            phaseLabel: phase.label,
            groupLetter: group.letter,
            groupLabel: group.label
          });
        }
      }
    }
    return items;
  }
}

module.exports = { RoadmapReader };
