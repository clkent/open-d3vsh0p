/**
 * Session-start reconciliation: detect pending roadmap items whose
 * implementation already exists on main, and mark them complete before
 * agents begin work.
 */

const MERGE_PATTERN = /^[a-f0-9]+ merge: (\S+)/;

/**
 * Reconcile pending roadmap items against merge commits on main.
 *
 * @param {object} opts
 * @param {object} opts.gitOps - GitOps instance
 * @param {object} opts.roadmapReader - RoadmapReader instance
 * @param {object} opts.stateMachine - StateMachine instance
 * @param {string} opts.projectDir - Project directory path
 * @param {object} opts.logger - Logger instance
 * @returns {Promise<{ reconciled: number, items: string[] }>}
 */
async function reconcile({ gitOps, roadmapReader, stateMachine, projectDir, logger }) {
  // Get all merge commit IDs from main in a single call
  let stdout;
  try {
    const result = await gitOps._git(projectDir, ['log', '--oneline', 'main']);
    stdout = result.stdout;
  } catch {
    // No git log available (empty repo, no main branch, etc.)
    return { reconciled: 0, items: [] };
  }

  const mergedIds = new Set();
  for (const line of stdout.split('\n')) {
    const match = line.match(MERGE_PATTERN);
    if (match) mergedIds.add(match[1]);
  }

  if (mergedIds.size === 0) return { reconciled: 0, items: [] };

  // Parse roadmap and find pending items that are already merged
  const roadmap = await roadmapReader.parse();
  const allItems = roadmapReader.getAllItems(roadmap);
  const needsReconciliation = allItems.filter(
    item => item.status === 'pending' && mergedIds.has(item.id)
  );

  // Sync parked items from roadmap into state (items marked [!] in roadmap
  // but not yet in state.parked — e.g., manually parked between sessions)
  const state = stateMachine.getState();
  const stateParkedIds = new Set((state.requirements.parked || []).map(p => typeof p === 'string' ? p : p.id));
  const roadmapParkedItems = allItems.filter(i => i.status === 'parked' && !stateParkedIds.has(i.id));

  if (roadmapParkedItems.length > 0) {
    const newParkedEntries = roadmapParkedItems.map(i => ({
      id: i.id,
      triageClassification: 'blocking',
      triageReason: 'Parked in roadmap — synced at session start',
      reason: 'Parked in roadmap'
    }));
    const updatedParked = [...(state.requirements.parked || []), ...newParkedEntries];
    const parkedIdSet = new Set(roadmapParkedItems.map(i => i.id));
    const updatedPending = state.requirements.pending.filter(id => !parkedIdSet.has(id));
    await stateMachine.update({
      requirements: {
        ...state.requirements,
        parked: updatedParked,
        pending: updatedPending
      }
    });

    await logger.log('info', 'roadmap_parked_synced', {
      count: roadmapParkedItems.length,
      items: roadmapParkedItems.map(i => i.id)
    });
  }

  if (needsReconciliation.length === 0) return { reconciled: 0, items: [] };

  // Mark each as complete in the roadmap
  for (const item of needsReconciliation) {
    await roadmapReader.markItemComplete(item.id);
  }

  const reconciledIds = needsReconciliation.map(i => i.id);

  // Update state machine (re-read state in case parked sync modified it)
  const currentState = stateMachine.getState();
  const newCompleted = [...currentState.requirements.completed, ...reconciledIds];
  const newPending = currentState.requirements.pending.filter(id => !reconciledIds.includes(id));
  await stateMachine.update({
    requirements: {
      ...currentState.requirements,
      completed: newCompleted,
      pending: newPending
    }
  });

  // Commit the roadmap changes
  await gitOps.commitAll(
    projectDir,
    `fix: reconcile ${reconciledIds.length} items already completed on main`
  );

  return { reconciled: reconciledIds.length, items: reconciledIds };
}

module.exports = { reconcile };
