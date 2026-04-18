const fs = require('fs/promises');
const path = require('path');
const { ApiError } = require('./api-server');
const { loadRegistry, saveRegistry, resolveProject, DEVSHOP_ROOT } = require('../infra/registry');

const ACTIVE_AGENTS_DIR = path.join(DEVSHOP_ROOT, 'active-agents');
const pkg = require('../../package.json');

/**
 * Build the full route table. Takes a SessionProcessManager instance.
 */
function buildRoutes(processManager) {
  return [
    { method: 'GET',    pattern: '/api/health',                                   handler: (p, b, q) => handleHealth(p, b, q, processManager) },
    { method: 'GET',    pattern: '/api/projects',                                 handler: handleListProjects },
    { method: 'GET',    pattern: '/api/projects/:id',                             handler: handleGetProject },
    { method: 'POST',   pattern: '/api/projects',                                 handler: handleCreateProject },
    { method: 'DELETE', pattern: '/api/projects/:id',                             handler: handleDeleteProject },
    { method: 'POST',   pattern: '/api/projects/:id/sessions',                    handler: (p, b, q) => handleStartSession(p, b, q, processManager) },
    { method: 'GET',    pattern: '/api/projects/:id/sessions/:sessionId',         handler: handleGetSession },
    { method: 'POST',   pattern: '/api/projects/:id/sessions/:sessionId/stop',    handler: (p, b, q) => handleStopSession(p, b, q, processManager) },
    { method: 'POST',   pattern: '/api/projects/:id/sessions/:sessionId/resume',  handler: (p, b, q) => handleResumeSession(p, b, q, processManager) },
    { method: 'POST',   pattern: '/api/projects/:id/agents/:role/invoke',         handler: handleInvokeAgent },
    { method: 'GET',    pattern: '/api/projects/:id/sessions/:sessionId/logs',    handler: handleGetLogs },
    { method: 'GET',    pattern: '/api/projects/:id/sessions/:sessionId/summary', handler: handleGetSummary },
  ];
}

// --- Health ---

async function handleHealth(_params, _body, _query, processManager) {
  return {
    status: 200,
    data: {
      status: 'ok',
      version: pkg.version,
      uptime: process.uptime(),
      activeSessions: processManager.activeCount
    }
  };
}

// --- Projects ---

async function handleListProjects() {
  const registry = await loadRegistry();
  return {
    status: 200,
    data: registry.projects.map(p => ({
      id: p.id,
      name: p.name,
      projectDir: p.projectDir,
      status: p.status || 'active',
      lastSessionId: p.lastSessionId || null
    }))
  };
}

async function handleGetProject(params) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  // Read current session state if available
  const stateDir = path.join(ACTIVE_AGENTS_DIR, project.id, 'orchestrator');
  let sessionState = null;
  try {
    const raw = await fs.readFile(path.join(stateDir, 'state.json'), 'utf-8');
    sessionState = JSON.parse(raw);
  } catch {
    // No active session state
  }

  return {
    status: 200,
    data: {
      ...project,
      sessionState
    }
  };
}

async function handleCreateProject(_params, body) {
  if (!body || !body.name) {
    throw new ApiError('BAD_REQUEST', 'Missing required field: name');
  }

  const registry = await loadRegistry();

  // Generate next ID
  const maxNum = registry.projects.reduce((max, p) => {
    const match = p.id.match(/^proj-(\d+)-/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, -1);

  const num = String(maxNum + 1).padStart(3, '0');
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = `proj-${num}-${slug}`;

  // Check for duplicate
  if (registry.projects.some(p => p.id === id)) {
    throw new ApiError('CONFLICT', `Project ${id} already exists`);
  }

  const projectDir = body.projectDir || path.join(path.dirname(DEVSHOP_ROOT), 'projects', slug);

  const project = {
    id,
    name: body.name,
    projectDir,
    githubRepo: body.githubRepo || null,
    registeredAt: new Date().toISOString(),
    status: 'active',
    schedule: { enabled: false }
  };

  registry.projects.push(project);
  await saveRegistry(registry);

  return { status: 201, data: project };
}

async function handleDeleteProject(params) {
  const registry = await loadRegistry();
  const idx = registry.projects.findIndex(p => p.id === params.id);
  if (idx === -1) {
    throw new ApiError('NOT_FOUND', `Project "${params.id}" not found`);
  }

  const removed = registry.projects.splice(idx, 1)[0];
  await saveRegistry(registry);

  return { status: 200, data: { deleted: removed.id } };
}

// --- Sessions ---

async function handleStartSession(params, body, _query, processManager) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  const opts = {};
  if (body) {
    if (body.budget) opts.budget = body.budget;
    if (body.timeLimit) opts.timeLimit = body.timeLimit;
    if (body.requirements) opts.requirements = body.requirements;
    if (body.window) opts.window = body.window;
    if (body.noConsolidate) opts.noConsolidate = true;
  }

  const result = processManager.start(project.id, opts);
  if (result.error === 'CONFLICT') {
    throw new ApiError('CONFLICT', `Session already running for ${project.id} (session: ${result.sessionId})`);
  }

  return {
    status: 202,
    data: {
      projectId: project.id,
      sessionId: result.sessionId,
      pid: result.pid
    }
  };
}

async function handleGetSession(params) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  const stateDir = path.join(ACTIVE_AGENTS_DIR, project.id, 'orchestrator');
  const statePath = path.join(stateDir, 'state.json');

  let state = null;
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    state = JSON.parse(raw);
  } catch {
    throw new ApiError('NOT_FOUND', `Session state not found for ${project.id}`);
  }

  return { status: 200, data: state };
}

async function handleStopSession(params, _body, _query, processManager) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  const stopped = processManager.stop(project.id);
  if (!stopped) {
    throw new ApiError('NOT_FOUND', `No running session for ${project.id}`);
  }

  return { status: 200, data: { stopped: true, projectId: project.id } };
}

async function handleResumeSession(params, body, _query, processManager) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  const opts = { resume: true };
  if (body) {
    if (body.budget) opts.budget = body.budget;
    if (body.timeLimit) opts.timeLimit = body.timeLimit;
  }

  const result = processManager.start(project.id, opts);
  if (result.error === 'CONFLICT') {
    throw new ApiError('CONFLICT', `Session already running for ${project.id} (session: ${result.sessionId})`);
  }

  return {
    status: 202,
    data: {
      projectId: project.id,
      sessionId: result.sessionId,
      pid: result.pid,
      resumed: true
    }
  };
}

// --- Agent Invocation ---

async function handleInvokeAgent(params, body) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  if (!body || !body.task) {
    throw new ApiError('BAD_REQUEST', 'Missing required field: task');
  }

  // Return 501 — agent invocation requires spawning a claude process
  // which is complex and better handled through the session lifecycle.
  // This is a placeholder for future direct agent invocation.
  return {
    status: 200,
    data: {
      projectId: project.id,
      role: params.role,
      status: 'queued',
      task: body.task,
      message: 'Direct agent invocation will spawn via session lifecycle'
    }
  };
}

// --- Logs & Summary ---

async function handleGetLogs(params, _body, query) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  const logsDir = path.join(ACTIVE_AGENTS_DIR, project.id, 'orchestrator', 'logs');
  const logFile = path.join(logsDir, `${params.sessionId}.jsonl`);

  let raw;
  try {
    raw = await fs.readFile(logFile, 'utf-8');
  } catch {
    throw new ApiError('NOT_FOUND', `Log file not found for session ${params.sessionId}`);
  }

  const lines = raw.trim().split('\n').filter(Boolean);
  let entries = lines.map(line => JSON.parse(line));

  // Pagination
  const offset = parseInt(query.offset, 10) || 0;
  const limit = parseInt(query.limit, 10) || 100;
  const total = entries.length;
  entries = entries.slice(offset, offset + limit);

  return {
    status: 200,
    data: {
      sessionId: params.sessionId,
      total,
      offset,
      limit,
      entries
    }
  };
}

async function handleGetSummary(params) {
  const registry = await loadRegistry();
  const project = findProject(registry, params.id);

  const logsDir = path.join(ACTIVE_AGENTS_DIR, project.id, 'orchestrator', 'logs');
  const summaryFile = path.join(logsDir, `${params.sessionId}-summary.json`);

  let raw;
  try {
    raw = await fs.readFile(summaryFile, 'utf-8');
  } catch {
    throw new ApiError('NOT_FOUND', `Summary not found for session ${params.sessionId}`);
  }

  return { status: 200, data: JSON.parse(raw) };
}

// --- Helpers ---

function findProject(registry, input) {
  const project = resolveProject(registry, input);
  if (!project) {
    throw new ApiError('NOT_FOUND', `Project "${input}" not found`);
  }
  return project;
}

module.exports = { buildRoutes };
