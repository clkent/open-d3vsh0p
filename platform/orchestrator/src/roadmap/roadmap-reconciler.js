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

  if (needsReconciliation.length === 0) return { reconciled: 0, items: [] };

  // Mark each as complete in the roadmap
  for (const item of needsReconciliation) {
    await roadmapReader.markItemComplete(item.id);
  }

  const reconciledIds = needsReconciliation.map(i => i.id);

  // Update state machine
  const state = stateMachine.getState();
  const newCompleted = [...state.requirements.completed, ...reconciledIds];
  const newPending = state.requirements.pending.filter(id => !reconciledIds.includes(id));
  await stateMachine.update({
    requirements: {
      ...state.requirements,
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
