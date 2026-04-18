const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { ApiServer } = require('./api-server');
const { buildRoutes } = require('./api-routes');

const TEST_TOKEN = 'test-routes-token';

function makeRequest(port, method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Mock process manager for route tests
function createMockProcessManager() {
  return {
    activeCount: 0,
    _store: new Map(),
    start(projectId, opts) {
      if (this._store.has(projectId) && this._store.get(projectId).running) {
        return { error: 'CONFLICT', sessionId: this._store.get(projectId).sessionId };
      }
      const sessionId = `mock-${Date.now()}`;
      this._store.set(projectId, { sessionId, pid: 12345, running: true, opts });
      this.activeCount++;
      return { sessionId, pid: 12345 };
    },
    stop(projectId) {
      const entry = this._store.get(projectId);
      if (!entry || !entry.running) return false;
      entry.running = false;
      this.activeCount--;
      return true;
    },
    isRunning(projectId) {
      const entry = this._store.get(projectId);
      return entry ? entry.running : false;
    },
    getInfo(projectId) {
      return this._store.get(projectId) || null;
    },
    stopAll() {
      for (const [, entry] of this._store) entry.running = false;
      this.activeCount = 0;
    }
  };
}

describe('API Routes', () => {
  let server;
  const processManager = createMockProcessManager();
  const PORT = 19220;

  before(async () => {
    const routes = buildRoutes(processManager);
    server = new ApiServer({ token: TEST_TOKEN, routes, processManager });
    await server.start(PORT);
  });

  after(async () => {
    if (server && server.isRunning) {
      await server.stop();
    }
  });

  it('GET /api/health returns version and uptime', async () => {
    const res = await makeRequest(PORT, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'ok');
    assert.equal(typeof res.data.version, 'string');
    assert.equal(typeof res.data.uptime, 'number');
    assert.equal(res.data.activeSessions, 0);
  });

  it('GET /api/projects lists projects from registry', async () => {
    const res = await makeRequest(PORT, 'GET', '/api/projects', { token: TEST_TOKEN });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
  });

  it('GET /api/projects/:id returns project details for a created project', async () => {
    // Create a project so we have a known ID to query
    const createRes = await makeRequest(PORT, 'POST', '/api/projects', {
      token: TEST_TOKEN,
      body: { name: 'detail-test' }
    });
    const projectId = createRes.data.id;

    try {
      const res = await makeRequest(PORT, 'GET', `/api/projects/${projectId}`, { token: TEST_TOKEN });
      assert.equal(res.status, 200);
      assert.equal(res.data.id, projectId);
      assert.equal(res.data.name, 'detail-test');
    } finally {
      await makeRequest(PORT, 'DELETE', `/api/projects/${projectId}`, { token: TEST_TOKEN });
    }
  });

  it('GET /api/projects/:id returns 404 for unknown project', async () => {
    const res = await makeRequest(PORT, 'GET', '/api/projects/nonexistent-project-xyz', { token: TEST_TOKEN });
    assert.equal(res.status, 404);
    assert.equal(res.data.error.code, 'NOT_FOUND');
  });

  it('POST /api/projects creates a new project', async () => {
    const res = await makeRequest(PORT, 'POST', '/api/projects', {
      token: TEST_TOKEN,
      body: { name: 'api-test-project' }
    });
    assert.equal(res.status, 201);
    assert.equal(typeof res.data.id, 'string');
    assert.match(res.data.id, /^proj-/);
    assert.equal(res.data.name, 'api-test-project');
    assert.equal(res.data.status, 'active');

    // Clean up: delete the project we just created
    await makeRequest(PORT, 'DELETE', `/api/projects/${res.data.id}`, { token: TEST_TOKEN });
  });

  it('POST /api/projects returns 400 without name', async () => {
    const res = await makeRequest(PORT, 'POST', '/api/projects', {
      token: TEST_TOKEN,
      body: {}
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'BAD_REQUEST');
  });

  it('DELETE /api/projects/:id removes project', async () => {
    const createRes = await makeRequest(PORT, 'POST', '/api/projects', {
      token: TEST_TOKEN,
      body: { name: 'delete-me' }
    });
    const id = createRes.data.id;

    const res = await makeRequest(PORT, 'DELETE', `/api/projects/${id}`, { token: TEST_TOKEN });
    assert.equal(res.status, 200);
    assert.equal(res.data.deleted, id);
  });

  it('DELETE /api/projects/:id returns 404 for unknown', async () => {
    const res = await makeRequest(PORT, 'DELETE', '/api/projects/nonexistent-xyz', { token: TEST_TOKEN });
    assert.equal(res.status, 404);
  });
});

describe('API Routes - Logs and Summary', () => {
  let server;
  const PORT = 19221;

  before(async () => {
    const processManager = createMockProcessManager();
    const routes = buildRoutes(processManager);
    server = new ApiServer({ token: TEST_TOKEN, routes, processManager });
    await server.start(PORT);
  });

  after(async () => {
    if (server && server.isRunning) {
      await server.stop();
    }
  });

  it('GET /api/projects/:id/sessions/:sessionId/logs returns 404 for missing log', async () => {
    // Create a project so we have a known ID
    const createRes = await makeRequest(PORT, 'POST', '/api/projects', {
      token: TEST_TOKEN,
      body: { name: 'logs-404-test' }
    });
    const projectId = createRes.data.id;

    try {
      const res = await makeRequest(PORT, 'GET', `/api/projects/${projectId}/sessions/nonexistent-session/logs`, { token: TEST_TOKEN });
      assert.equal(res.status, 404);
      assert.equal(res.data.error.code, 'NOT_FOUND');
    } finally {
      await makeRequest(PORT, 'DELETE', `/api/projects/${projectId}`, { token: TEST_TOKEN });
    }
  });

  it('GET /api/projects/:id/sessions/:sessionId/summary returns 404 for missing summary', async () => {
    const createRes = await makeRequest(PORT, 'POST', '/api/projects', {
      token: TEST_TOKEN,
      body: { name: 'summary-404-test' }
    });
    const projectId = createRes.data.id;

    try {
      const res = await makeRequest(PORT, 'GET', `/api/projects/${projectId}/sessions/nonexistent-session/summary`, { token: TEST_TOKEN });
      assert.equal(res.status, 404);
    } finally {
      await makeRequest(PORT, 'DELETE', `/api/projects/${projectId}`, { token: TEST_TOKEN });
    }
  });
});
