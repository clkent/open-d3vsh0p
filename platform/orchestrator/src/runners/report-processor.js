const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile: execFileAsync } = require('../infra/exec-utils');

/**
 * Read the report queue from disk.
 * Returns an empty array if the file doesn't exist or is malformed.
 */
async function readQueue(queuePath) {
  try {
    const raw = await fs.readFile(queuePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Write the report queue to disk.
 */
async function writeQueue(queuePath, entries) {
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, JSON.stringify(entries, null, 2) + '\n');
}

/**
 * Append a new report to the queue.
 * Returns the created report object (with generated id).
 */
async function appendReport(queuePath, { type, description }) {
  const queue = await readQueue(queuePath);
  const report = {
    id: randomUUID().slice(0, 8),
    type,
    description,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  queue.push(report);
  await writeQueue(queuePath, queue);
  return report;
}

/**
 * Process all pending reports in the queue.
 * Bug reports are processed first, then feature requests.
 *
 * Options:
 *   projectDir, templatesDir, techStack, conventions,
 *   logger, agentRunner, templateEngine, gitOps, onEvent,
 *   roadmapContext (string with current roadmap state)
 */
async function processReports(queuePath, options) {
  const queue = await readQueue(queuePath);
  const pending = queue.filter(r => r.status === 'pending');

  if (pending.length === 0) return { processed: 0 };

  // Sort: bugs first, then features
  const bugs = pending.filter(r => r.type === 'bug');
  const features = pending.filter(r => r.type === 'feature');
  const ordered = [...bugs, ...features];

  const results = [];

  for (const report of ordered) {
    report.status = 'processing';
    await writeQueue(queuePath, queue);

    try {
      if (report.type === 'bug') {
        await _handleBugReport(report, options);
      } else {
        await _handleFeatureRequest(report, options);
      }
    } catch (err) {
      report.status = 'failed';
      report.error = err.message;
      report.processedAt = new Date().toISOString();
    }

    await writeQueue(queuePath, queue);
    results.push({ id: report.id, type: report.type, status: report.status });
  }

  return { processed: results.length, results };
}

/**
 * Handle a bug report by invoking Morgan with a diagnostic prompt.
 * Runs on the current branch (session branch). Test-gated: if npm test
 * fails after Morgan's fix, changes are discarded.
 */
async function _handleBugReport(report, options) {
  const { AgentSession } = require('../agents/agent-session');
  const {
    projectDir, templatesDir, techStack, conventions,
    logger, agentRunner, templateEngine, gitOps, onEvent
  } = options;

  const session = new AgentSession(agentRunner, templateEngine, {
    templatesDir,
    projectDir,
    pmModel: 'claude-sonnet-4-20250514',
    pmBudgetUsd: 3,
    pmTimeoutMs: 300000,
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']
  });

  const result = await session.chat(
    `A developer reported this bug:\n\n${report.description}\n\nDiagnose and fix this issue. Follow the mission in your system prompt.`,
    {
      systemPromptTemplate: 'principal-engineer',
      promptFile: 'report-fix-prompt.md',
      templateVars: {
        PROJECT_DIR: projectDir,
        TECH_STACK: techStack || 'Not specified',
        BUG_DESCRIPTION: report.description
      },
      onEvent
    }
  );

  // Verify fix with tests
  try {
    await execFileAsync('npm', ['test'], {
      cwd: projectDir,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch {
    // Tests failed — discard Morgan's changes
    if (gitOps) {
      await gitOps._git(projectDir, ['checkout', '.']);
      await gitOps._git(projectDir, ['clean', '-fd']);
    }
    report.status = 'failed';
    report.error = 'fix broke existing tests';
    report.processedAt = new Date().toISOString();
    return;
  }

  // Check if Morgan made any changes
  let hasChanges = false;
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
    hasChanges = stdout.trim().length > 0;
  } catch {}

  if (!hasChanges) {
    report.status = 'failed';
    report.error = 'no fix produced';
    report.processedAt = new Date().toISOString();
    return;
  }

  // Commit the fix
  const desc = report.description.slice(0, 60).replace(/\n/g, ' ');
  if (gitOps) {
    await gitOps.commitAll(projectDir, `fix: report ${report.id} — ${desc}`);
  }

  report.status = 'completed';
  report.outcome = 'fixed';
  report.processedAt = new Date().toISOString();
}

/**
 * Handle a feature request by invoking Riley to create/modify specs
 * and update the roadmap with items in future phases.
 */
async function _handleFeatureRequest(report, options) {
  const { AgentSession } = require('../agents/agent-session');
  const {
    projectDir, templatesDir, techStack, conventions,
    logger, agentRunner, templateEngine, gitOps, onEvent,
    roadmapContext
  } = options;

  const session = new AgentSession(agentRunner, templateEngine, {
    templatesDir,
    projectDir,
    pmModel: 'claude-sonnet-4-20250514',
    pmBudgetUsd: 2,
    pmTimeoutMs: 180000,
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']
  });

  const result = await session.chat(
    `A developer requested this feature:\n\n${report.description}\n\nCreate or update specs and add this to the roadmap. Follow the instructions in your system prompt.`,
    {
      systemPromptTemplate: 'pm-agent',
      promptFile: 'report-feature-prompt.md',
      templateVars: {
        PROJECT_DIR: projectDir,
        TECH_STACK: techStack || 'Not specified',
        FEATURE_DESCRIPTION: report.description,
        ROADMAP_CONTEXT: roadmapContext || 'No roadmap context available.'
      },
      onEvent
    }
  );

  // Commit Riley's spec/roadmap changes
  let hasChanges = false;
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectDir });
    hasChanges = stdout.trim().length > 0;
  } catch {}

  if (hasChanges && gitOps) {
    const desc = report.description.slice(0, 60).replace(/\n/g, ' ');
    await gitOps.commitAll(projectDir, `feat: report ${report.id} — ${desc}`);
  }

  report.status = 'completed';
  report.outcome = hasChanges ? 'spec-created' : 'no-changes';
  report.processedAt = new Date().toISOString();
}

module.exports = { readQueue, writeQueue, appendReport, processReports, _handleBugReport, _handleFeatureRequest };
