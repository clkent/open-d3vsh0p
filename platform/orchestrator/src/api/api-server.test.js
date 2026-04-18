const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ApiServer, ApiError, patternToRegex } = require('./api-server');

const TEST_TOKEN = 'test-token-abc123';

function makeRequest(port, method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('patternToRegex', () => {
  it('matches static paths', () => {
    const regex = patternToRegex('/api/health');
    assert.ok(regex.test('/api/health'));
    assert.ok(!regex.test('/api/healthz'));
    assert.ok(!regex.test('/api/health/extra'));
  });

  it('captures named parameters', () => {
    const regex = patternToRegex('/api/projects/:id');
    const match = '/api/projects/proj-001-garden'.match(regex);
    assert.ok(match);
    assert.equal(match.groups.id, 'proj-001-garden');
  });

  it('captures multiple parameters', () => {
    const regex = patternToRegex('/api/projects/:id/sessions/:sessionId');
    const match = '/api/projects/proj-001/sessions/ses-123'.match(regex);
    assert.ok(match);
    assert.equal(match.groups.id, 'proj-001');
    assert.equal(match.groups.sessionId, 'ses-123');
  });

  it('does not match partial paths', () => {
    const regex = patternToRegex('/api/projects/:id');
    assert.ok(!regex.test('/api/projects/123/extra'));
  });
});

describe('ApiServer', () => {
  let server;

  afterEach(async () => {
    if (server && server.isRunning) {
      await server.stop();
      server = null;
    }
  });

  it('starts and responds to health check (no auth needed)', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        { method: 'GET', pattern: '/api/health', handler: async () => ({ status: 200, data: { ok: true } }) }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19200);
    assert.equal(server.isRunning, true);

    const res = await makeRequest(19200, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { ok: true });
  });

  it('rejects unauthenticated requests to non-health endpoints', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        { method: 'GET', pattern: '/api/projects', handler: async () => ({ status: 200, data: [] }) }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19201);

    const res = await makeRequest(19201, 'GET', '/api/projects');
    assert.equal(res.status, 401);
    assert.equal(res.data.error.code, 'UNAUTHORIZED');
  });

  it('accepts requests with valid Bearer token', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        { method: 'GET', pattern: '/api/projects', handler: async () => ({ status: 200, data: [{ id: 'test' }] }) }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19202);

    const res = await makeRequest(19202, 'GET', '/api/projects', { token: TEST_TOKEN });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, [{ id: 'test' }]);
  });

  it('rejects requests with wrong token', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        { method: 'GET', pattern: '/api/projects', handler: async () => ({ status: 200, data: [] }) }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19203);

    const res = await makeRequest(19203, 'GET', '/api/projects', { token: 'wrong-token' });
    assert.equal(res.status, 401);
    assert.equal(res.data.error.code, 'UNAUTHORIZED');
  });

  it('returns 404 for unmatched routes', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        { method: 'GET', pattern: '/api/health', handler: async () => ({ status: 200, data: {} }) }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19204);

    const res = await makeRequest(19204, 'GET', '/api/nonexistent', { token: TEST_TOKEN });
    assert.equal(res.status, 404);
    assert.equal(res.data.error.code, 'NOT_FOUND');
  });

  it('passes route params to handler', async () => {
    let capturedParams;
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        {
          method: 'GET',
          pattern: '/api/projects/:id',
          handler: async (params) => {
            capturedParams = params;
            return { status: 200, data: { id: params.id } };
          }
        }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19205);

    const res = await makeRequest(19205, 'GET', '/api/projects/proj-001', { token: TEST_TOKEN });
    assert.equal(res.status, 200);
    assert.equal(capturedParams.id, 'proj-001');
  });

  it('parses JSON body for POST requests', async () => {
    let capturedBody;
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        {
          method: 'POST',
          pattern: '/api/projects',
          handler: async (_params, body) => {
            capturedBody = body;
            return { status: 201, data: { created: true } };
          }
        }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19206);

    const res = await makeRequest(19206, 'POST', '/api/projects', {
      token: TEST_TOKEN,
      body: { name: 'test-project' }
    });
    assert.equal(res.status, 201);
    assert.deepEqual(capturedBody, { name: 'test-project' });
  });

  it('returns 400 for malformed JSON body', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        {
          method: 'POST',
          pattern: '/api/projects',
          handler: async () => ({ status: 201, data: {} })
        }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19207);

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 19207,
        path: '/api/projects',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on('error', reject);
      req.write('not-json{{{');
      req.end();
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'BAD_REQUEST');
  });

  it('handles handler errors gracefully', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        {
          method: 'GET',
          pattern: '/api/projects',
          handler: async () => { throw new ApiError('CONFLICT', 'test conflict'); }
        }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19208);

    const res = await makeRequest(19208, 'GET', '/api/projects', { token: TEST_TOKEN });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'CONFLICT');
    assert.equal(res.data.error.message, 'test conflict');
  });

  it('stops cleanly and releases port', async () => {
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [],
      processManager: { activeCount: 0 }
    });
    await server.start(19209);
    assert.equal(server.isRunning, true);

    await server.stop();
    assert.equal(server.isRunning, false);

    // Port should be released — start again on same port
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [],
      processManager: { activeCount: 0 }
    });
    await server.start(19209);
    assert.equal(server.isRunning, true);
  });

  it('passes query params to handler', async () => {
    let capturedQuery;
    server = new ApiServer({
      token: TEST_TOKEN,
      routes: [
        {
          method: 'GET',
          pattern: '/api/projects/:id/sessions/:sessionId/logs',
          handler: async (_params, _body, query) => {
            capturedQuery = query;
            return { status: 200, data: {} };
          }
        }
      ],
      processManager: { activeCount: 0 }
    });
    await server.start(19210);

    await makeRequest(19210, 'GET', '/api/projects/proj-001/sessions/ses-1/logs?offset=10&limit=50', { token: TEST_TOKEN });
    assert.equal(capturedQuery.offset, '10');
    assert.equal(capturedQuery.limit, '50');
  });
});
