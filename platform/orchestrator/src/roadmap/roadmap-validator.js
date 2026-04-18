const ID_PATTERN = /^[a-z][a-z0-9-]+$/;

class RoadmapValidator {
  /**
   * Validate a parsed roadmap for structural correctness.
   * Catches agent hallucination (bad IDs, duplicates, invalid deps) deterministically.
   *
   * @param {object} roadmap - Parsed roadmap from RoadmapReader.parseContent()
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  static validate(roadmap) {
    const errors = [];
    const warnings = [];

    // Structural emptiness: no phases at all
    if (roadmap.phases.length === 0) {
      errors.push('No phases found in roadmap');
    }

    const seenIds = new Map(); // id → "Phase X Group Y" location string
    let totalItemCount = 0;

    for (const phase of roadmap.phases) {
      let phaseItemCount = 0;

      for (const group of phase.groups) {
        if (group.items.length > 10) {
          warnings.push(
            `Phase ${phase.number} Group ${group.letter}: ${group.items.length} items (max recommended: 10)`
          );
        }

        for (const item of group.items) {
          phaseItemCount++;
          totalItemCount++;

          // ID format
          if (!ID_PATTERN.test(item.id)) {
            errors.push(
              `Invalid requirement ID "${item.id}" — must be kebab-case (lowercase, hyphens, 2+ chars)`
            );
          }

          // ID uniqueness
          const location = `Phase ${phase.number} Group ${group.letter}`;
          if (seenIds.has(item.id)) {
            errors.push(
              `Duplicate requirement ID "${item.id}" in ${location} (first seen in ${seenIds.get(item.id)})`
            );
          } else {
            seenIds.set(item.id, location);
          }
        }
      }

      // Empty phase — an error because it means the parser couldn't find
      // any ### Group headings (or items) under this phase
      if (phaseItemCount === 0) {
        errors.push(`Phase ${phase.number} "${phase.label}" has no items`);
      }
    }

    // Structural emptiness: phases exist but no items at all
    if (roadmap.phases.length > 0 && totalItemCount === 0) {
      errors.push('No items found in roadmap — check item format: - [ ] `id` — description');
    }

    // Quality warnings (only check when phases exist)
    if (roadmap.phases.length > 0) {
      // Group Z checkpoint check
      const hasGroupZ = roadmap.phases.some(p =>
        p.groups.some(g => g.letter === 'Z')
      );
      if (!hasGroupZ) {
        warnings.push(
          'No Group Z (User Testing) checkpoints found — every phase should end with a Group Z: User Testing checkpoint'
        );
      }

      // [HUMAN] marker check
      const hasHumanItem = roadmap.phases.some(p =>
        p.groups.some(g =>
          g.items.some(item => item.description.includes('[HUMAN]'))
        )
      );
      if (!hasHumanItem && totalItemCount > 0) {
        warnings.push(
          'No [HUMAN] items found — mark items requiring human action (API key setup, manual testing, service configuration) with [HUMAN]'
        );
      }
    }

    // Dependency validity
    const phaseNumbers = new Set(roadmap.phases.map(p => p.number));
    for (const phase of roadmap.phases) {
      if (phase.depends) {
        for (const dep of phase.depends) {
          if (!phaseNumbers.has(dep)) {
            errors.push(
              `Phase ${phase.number} depends on Phase ${dep} which does not exist`
            );
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

module.exports = { RoadmapValidator };
