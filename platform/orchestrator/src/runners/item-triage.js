const fs = require('fs/promises');
const path = require('path');
const { extractJson } = require('../infra/json-extractor');
const { InterventionClassifier } = require('./intervention-classifier');

class ItemTriage {
  constructor(orchestrator) {
    this.o = orchestrator;
  }

  /**
   * Triage parked items from a completed phase against next phase items.
   */
  async triageParkedItems(completedPhase, nextPhaseItems) {
    const parkedItems = this.o.roadmapReader.getParkedItemsInPhase(completedPhase);

    const state = this.o.stateMachine.getState();
    const alreadyClassified = new Set(
      state.requirements.parked
        .filter(p => p.triageClassification)
        .map(p => p.id)
    );
    const unclassified = parkedItems.filter(item => !alreadyClassified.has(item.id));

    if (unclassified.length === 0) return;

    const parkedList = unclassified.map(item => {
      const stateEntry = state.requirements.parked.find(p => p.id === item.id);
      const reason = stateEntry?.reason || 'Unknown failure';
      return `- \`${item.id}\` — ${item.description}\n  Failure reason: ${reason}`;
    }).join('\n');

    const nextList = nextPhaseItems.map(item =>
      `- \`${item.id}\` — ${item.description}`
    ).join('\n');

    const userPrompt = `## Parked Items (from completed phase)\n${parkedList}\n\n## Next Phase Items (dependent on completed phase)\n${nextList}\n\nClassify each parked item as BLOCKING or NON_BLOCKING for the next phase.`;

    const triageConfig = this.o.config.agents.triage;

    await this.o.logger.log('info', 'triage_started', {
      parkedCount: unclassified.length,
      nextPhaseItemCount: nextPhaseItems.length
    });

    let systemPrompt;
    try {
      systemPrompt = await this.o.templateEngine.renderAgentPrompt('triage-agent', {
        PROJECT_ID: this.o.cliOptions.projectId,
        PROJECT_DIR: this.o.cliOptions.projectDir
      });
    } catch (err) {
      await this.o.logger.log('error', 'triage_template_error', { error: err.message });
      await this.markAllAsBlocking(unclassified, 'Triage template failed to load');
      return;
    }

    try {
      const result = await this.o.agentRunner.runAgent({
        systemPrompt,
        userPrompt,
        workingDir: this.o.cliOptions.projectDir,
        model: triageConfig.model,
        maxBudgetUsd: triageConfig.maxBudgetUsd,
        timeoutMs: triageConfig.timeoutMs,
        allowedTools: triageConfig.allowedTools
      });

      this.o.monitor.recordInvocation(result.cost || 0, result.duration || 0);

      if (!result.success) {
        await this.o.logger.log('warn', 'triage_agent_failed', { error: result.error });
        await this.markAllAsBlocking(unclassified, 'Triage agent failed');
        return;
      }

      const output = result.output.trim();
      const parsed = extractJson(output);

      if (!parsed) {
        await this.o.logger.log('debug', 'triage_raw_output', {
          output: output.slice(0, 2000)
        });
        throw new Error('Response is not valid JSON');
      }

      if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
        await this.o.logger.log('debug', 'triage_unexpected_json', {
          keys: Object.keys(parsed)
        });
        throw new Error('Response missing classifications array');
      }

      // Validate each classification entry
      const validClassifications = ['BLOCKING', 'NON_BLOCKING'];
      for (const entry of parsed.classifications) {
        if (typeof entry.id !== 'string' || !entry.id) {
          throw new Error(`Invalid classification entry: missing or non-string id`);
        }
        if (!validClassifications.includes(entry.classification?.toUpperCase())) {
          throw new Error(`Invalid classification for ${entry.id}: "${entry.classification}" (expected BLOCKING or NON_BLOCKING)`);
        }
      }

      // Apply classifications to state
      const currentState = this.o.stateMachine.getState();
      const updatedParked = currentState.requirements.parked.map(entry => {
        const classification = parsed.classifications.find(c => c.id === entry.id);
        if (classification) {
          return {
            ...entry,
            triageClassification: classification.classification.toLowerCase() === 'non_blocking'
              ? 'non_blocking' : 'blocking',
            triageReason: classification.reason || ''
          };
        }
        return entry;
      });

      await this.o.stateMachine.update({
        requirements: { ...currentState.requirements, parked: updatedParked }
      });

      // Check for any unclassified items that the agent missed
      const classifiedIds = new Set(parsed.classifications.map(c => c.id));
      const missed = unclassified.filter(item => !classifiedIds.has(item.id));
      if (missed.length > 0) {
        await this.markAllAsBlocking(missed, 'Triage agent did not classify this item');
      }

      await this.o.logger.log('info', 'triage_complete', {
        classifications: parsed.classifications.map(c => ({
          id: c.id,
          classification: c.classification,
          reason: c.reason
        }))
      });

    } catch (err) {
      await this.o.logger.log('error', 'triage_parse_error', { error: err.message });
      await this.markAllAsBlocking(unclassified, `Triage failed: ${err.message}`);
    }
  }

  /**
   * Mark all items as blocking (fail-safe default).
   */
  async markAllAsBlocking(items, reason) {
    const currentState = this.o.stateMachine.getState();
    const blockingIds = new Set(items.map(i => i.id));
    const updatedParked = currentState.requirements.parked.map(entry => {
      if (blockingIds.has(entry.id) && !entry.triageClassification) {
        return { ...entry, triageClassification: 'blocking', triageReason: reason };
      }
      return entry;
    });

    await this.o.stateMachine.update({
      requirements: { ...currentState.requirements, parked: updatedParked }
    });

    await this.o.logger.log('warn', 'triage_fallback_blocking', {
      ids: items.map(i => i.id),
      reason
    });
  }

  /**
   * Classify a single parked item as blocking or non_blocking via the triage agent.
   */
  async classifySingleItem(itemId, reason) {
    const triageConfig = this.o.config.agents.triage;

    let systemPrompt;
    try {
      systemPrompt = await this.o.templateEngine.renderAgentPrompt('triage-agent', {
        PROJECT_ID: this.o.cliOptions.projectId,
        PROJECT_DIR: this.o.cliOptions.projectDir
      });
    } catch (err) {
      await this.o.logger.log('error', 'inline_triage_template_error', { error: err.message, itemId });
      return 'blocking';
    }

    try {
      const userPrompt = `## Parked Item\n- \`${itemId}\`\n  Failure reason: ${reason || 'Unknown failure'}\n\nClassify this item as BLOCKING or NON_BLOCKING. A blocking item means other requirements that depend on it will fail.`;

      const result = await this.o.agentRunner.runAgent({
        systemPrompt,
        userPrompt,
        workingDir: this.o.cliOptions.projectDir,
        model: triageConfig.model,
        maxBudgetUsd: triageConfig.maxBudgetUsd,
        timeoutMs: triageConfig.timeoutMs,
        allowedTools: triageConfig.allowedTools
      });

      this.o.monitor.recordInvocation(result.cost || 0, result.duration || 0);

      if (!result.success) {
        await this.o.logger.log('warn', 'inline_triage_failed', { itemId, error: result.error });
        return 'blocking';
      }

      const parsed = extractJson(result.output.trim());
      if (!parsed || !parsed.classifications || !Array.isArray(parsed.classifications)) {
        await this.o.logger.log('warn', 'inline_triage_parse_error', { itemId });
        return 'blocking';
      }

      const entry = parsed.classifications.find(c => c.id === itemId);
      if (!entry || typeof entry.id !== 'string') {
        return 'blocking';
      }

      const validClassifications = ['BLOCKING', 'NON_BLOCKING'];
      if (!validClassifications.includes(entry.classification?.toUpperCase())) {
        await this.o.logger.log('warn', 'inline_triage_invalid_classification', {
          itemId,
          classification: entry.classification
        });
        return 'blocking';
      }

      const classification = entry.classification.toLowerCase() === 'non_blocking'
        ? 'non_blocking' : 'blocking';

      await this.o.logger.log('info', 'inline_triage_complete', {
        itemId,
        classification,
        reason: entry.reason || ''
      });

      return classification;
    } catch (err) {
      await this.o.logger.log('error', 'inline_triage_error', { itemId, error: err.message });
      return 'blocking';
    }
  }

  /**
   * Park an item: mark in roadmap, commit, classify, check for human intervention, update state.
   */
  async parkItem(itemId, metadata) {
    await this.o.roadmapReader.markItemParked(itemId);
    await this.o.gitOps.commitAll(
      this.o.cliOptions.projectDir,
      `chore: park ${itemId} in roadmap`
    );

    let classification = metadata.triageClassification || null;
    if (!classification) {
      classification = await this.classifySingleItem(itemId, metadata.reason);
    }

    // Intervention classification — zero cost pattern matching (no LLM)
    let intervention = null;
    if (!metadata.triageClassification) {
      try {
        const classifier = new InterventionClassifier(this.o.logger);
        await classifier.init(this.o.cliOptions.projectDir);
        const result = classifier.classify(metadata.reason);

        if (result.classification === 'human_needed') {
          const instructions = classifier.generateInstructions(metadata.reason, result.category);
          intervention = {
            ...instructions,
            category: result.category,
            discoveredAt: new Date().toISOString()
          };

          // Annotate parked item in roadmap with [HUMAN]
          const annotated = await this.o.roadmapReader.annotateWithHuman(itemId);
          if (annotated) {
            await this.o.gitOps.commitAll(
              this.o.cliOptions.projectDir,
              `chore: mark ${itemId} as requiring human intervention`
            );
          }

          // Write to interventions sidecar file
          await this._writeIntervention(itemId, intervention);

          await this.o.logger.log('info', 'intervention_classified', {
            requirementId: itemId,
            category: result.category,
            title: instructions.title
          });
        }
      } catch (err) {
        // Intervention classification is non-fatal
        await this.o.logger.log('debug', 'intervention_classification_failed', {
          requirementId: itemId,
          error: err.message
        });
      }
    }

    const currentState = this.o.stateMachine.getState();
    await this.o.stateMachine.update({
      requirements: {
        ...currentState.requirements,
        parked: [
          ...currentState.requirements.parked,
          {
            id: itemId,
            ...metadata,
            triageClassification: classification,
            parkedAt: new Date().toISOString(),
            ...(intervention && { intervention })
          }
        ],
        pending: currentState.requirements.pending.filter(id => id !== itemId)
      }
    });

    return { classification, intervention };
  }

  /**
   * Write an intervention to the project's interventions sidecar file.
   * Appends to existing entries, creating the file if needed.
   */
  async _writeIntervention(requirementId, intervention) {
    const sidecarPath = path.join(this.o.cliOptions.projectDir, 'openspec', 'interventions.json');

    let existing = { interventions: [] };
    try {
      const content = await fs.readFile(sidecarPath, 'utf-8');
      existing = JSON.parse(content);
    } catch {
      // File doesn't exist yet — start fresh
    }

    // Remove any existing entry for this requirement (idempotent)
    existing.interventions = existing.interventions.filter(i => i.requirementId !== requirementId);

    existing.interventions.push({
      requirementId,
      ...intervention,
      resolved: false
    });

    await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
    await fs.writeFile(sidecarPath, JSON.stringify(existing, null, 2));
  }
}

module.exports = { ItemTriage };
