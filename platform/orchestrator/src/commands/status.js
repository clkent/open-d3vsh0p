const fs = require('fs/promises');
const path = require('path');
const { CostEstimator } = require('../session/cost-estimator');

async function statusCommand(project, config) {
  const orchestratorDir = path.join(config.activeAgentsDir, 'orchestrator');
  const stateFilePath = path.join(orchestratorDir, 'state.json');
  const openspecDir = path.join(project.projectDir, 'openspec');

  console.log('');
  console.log(`=== Project Status: ${project.name} ===`);
  console.log(`  ID:        ${project.id}`);
  console.log(`  Directory: ${project.projectDir}`);
  console.log('');

  // Try to read roadmap
  const roadmapPath = path.join(openspecDir, 'roadmap.md');
  let hasRoadmap = false;
  try {
    const roadmap = await fs.readFile(roadmapPath, 'utf-8');
    hasRoadmap = true;
    printRoadmapStatus(roadmap);
  } catch {
    console.log('  Roadmap:   Not found — run `devshop kickoff` first');
    console.log('');
  }

  // Try to read state
  try {
    const raw = await fs.readFile(stateFilePath, 'utf-8');
    const state = JSON.parse(raw);
    printSessionState(state);
  } catch {
    console.log('  Session:   No active session');
    console.log('');
  }

  // Try to read latest summary
  const logsDir = path.join(orchestratorDir, 'logs');
  try {
    const files = await fs.readdir(logsDir);
    const summaries = files.filter(f => f.endsWith('-summary.json')).sort();
    if (summaries.length > 0) {
      const latest = summaries[summaries.length - 1];
      const raw = await fs.readFile(path.join(logsDir, latest), 'utf-8');
      const summary = JSON.parse(raw);
      printLastSession(summary);
    }
  } catch {
    // No logs directory yet
  }

  // Cost estimate for remaining work
  try {
    const logsDir = path.join(orchestratorDir, 'logs');
    const costEstimator = new CostEstimator(logsDir);
    await costEstimator.init();

    if (costEstimator.sessionCount >= 1 && hasRoadmap) {
      const { RoadmapReader } = require('../roadmap/roadmap-reader');
      const roadmapReader = new RoadmapReader(project.projectDir);
      const roadmap = await roadmapReader.parse();
      const pendingCount = roadmapReader.getAllItems(roadmap)
        .filter(i => i.status === 'pending').length;

      if (pendingCount > 0) {
        const avgCost = costEstimator.getAverageCostPerRequirement();
        const totalEstimate = Math.round(pendingCount * avgCost * 100) / 100;
        console.log('  Cost Estimate:');
        console.log(`    Avg cost/req: $${avgCost.toFixed(2)} (from ${costEstimator.sessionCount} session(s))`);
        console.log(`    Remaining:    $${totalEstimate.toFixed(2)} est. (${pendingCount} pending items)`);
        console.log('');
      }
    }
  } catch {
    // Non-fatal
  }

  console.log('================================');
  console.log('');

  return 0;
}

function printRoadmapStatus(roadmap) {
  const lines = roadmap.split('\n');
  let currentPhase = null;
  let currentGroup = null;
  let totalItems = 0;
  let completedItems = 0;
  let parkedItems = 0;

  console.log('  Roadmap Progress:');

  for (const line of lines) {
    if (line.startsWith('## Phase')) {
      currentPhase = line.replace(/^## /, '').trim();
    }
    if (line.startsWith('### Group')) {
      currentGroup = line.replace(/^### /, '').trim();
    }
    const pendingMatch = line.match(/^- \[ \] `([^`]+)`/);
    const doneMatch = line.match(/^- \[x\] `([^`]+)`/);
    const parkedMatch = line.match(/^- \[!\] `([^`]+)`/);

    if (pendingMatch) totalItems++;
    if (doneMatch) { totalItems++; completedItems++; }
    if (parkedMatch) { totalItems++; parkedItems++; }
  }

  const pending = totalItems - completedItems - parkedItems;
  console.log(`    Total:     ${totalItems} items`);
  console.log(`    Completed: ${completedItems}`);
  console.log(`    Pending:   ${pending}`);
  if (parkedItems > 0) {
    console.log(`    Parked:    ${parkedItems}`);
  }
  console.log('');
}

function printSessionState(state) {
  console.log('  Active Session:');
  console.log(`    Session:   ${state.sessionId}`);
  console.log(`    State:     ${state.state}`);
  console.log(`    Branch:    ${state.sessionBranch}`);

  if (state.currentRequirement) {
    console.log(`    Working:   ${state.currentRequirement.id} (attempt ${state.currentRequirement.attempt})`);
  }

  if (state.requirements) {
    console.log(`    Completed: ${state.requirements.completed.length}`);
    console.log(`    Pending:   ${state.requirements.pending.length}`);
    console.log(`    Parked:    ${state.requirements.parked.length}`);
  }

  if (state.consumption) {
    console.log(`    Cost:      $${(state.consumption.totalCostUsd || 0).toFixed(2)}`);
    console.log(`    Invocations: ${state.consumption.agentInvocations || 0}`);
  }

  // Show active agents if present (parallel mode)
  if (state.activeAgents && state.activeAgents.length > 0) {
    console.log('    Active Agents:');
    for (const agent of state.activeAgents) {
      console.log(`      - ${agent.persona} → ${agent.groupLabel} (${agent.requirementId})`);
    }
  }

  console.log('');
}

function printLastSession(summary) {
  console.log('  Last Session:');
  console.log(`    ID:        ${summary.sessionId}`);
  console.log(`    Cost:      $${(summary.totalCostUsd || 0).toFixed(2)}`);
  console.log(`    Completed: ${summary.results.completed.length}`);
  console.log(`    Parked:    ${summary.results.parked.length}`);
  console.log(`    Remaining: ${summary.results.remaining.length}`);
  console.log('');

  // Review metrics from session
  if (summary.reviewMetrics && summary.reviewMetrics.structuredReviews > 0) {
    printReviewMetrics(summary.reviewMetrics);
  }
}

function printReviewMetrics(metrics) {
  console.log('  Review Scores (last session):');
  const dims = ['spec_adherence', 'test_coverage', 'code_quality', 'security', 'simplicity'];
  const labels = {
    spec_adherence: 'Spec adherence',
    test_coverage: 'Test coverage ',
    code_quality: 'Code quality  ',
    security: 'Security      ',
    simplicity: 'Simplicity    '
  };

  for (const dim of dims) {
    const val = metrics.avgScores[dim];
    if (val !== null && val !== undefined) {
      console.log(`    ${labels[dim]} ${val.toFixed(1)}/5`);
    }
  }

  const { critical, major, minor } = metrics.issueCounts;
  if (critical > 0 || major > 0 || minor > 0) {
    const parts = [];
    if (critical > 0) parts.push(`${critical} critical`);
    if (major > 0) parts.push(`${major} major`);
    if (minor > 0) parts.push(`${minor} minor`);
    console.log(`    Issues:        ${parts.join(', ')}`);
  }

  console.log(`    Reviews:       ${metrics.structuredReviews}/${metrics.totalReviews} structured`);
  console.log('');
}

module.exports = { statusCommand };
