const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { BroadcastServer } = require('./broadcast-server');

// Helper: connect a WebSocket client and wait for open
function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Helper: wait for next message on a WebSocket
function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

describe('BroadcastServer', () => {
  let server;
  const clients = [];

  afterEach(async () => {
    for (const c of clients) {
      try { c.close(); } catch {}
    }
    clients.length = 0;
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts and accepts connections', async () => {
    server = new BroadcastServer();
    await server.start(19100);
    assert.equal(server.isRunning, true);

    const ws = await connectClient(19100);
    clients.push(ws);
    // Give server time to register the connection
    await new Promise(r => setTimeout(r, 50));
    assert.equal(server.clients.size, 1);
  });

  it('removes client on disconnect', async () => {
    server = new BroadcastServer();
    await server.start(19101);

    const ws = await connectClient(19101);
    clients.push(ws);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(server.clients.size, 1);

    ws.close();
    await new Promise(r => setTimeout(r, 100));
    assert.equal(server.clients.size, 0);
  });

  it('broadcasts event to all connected clients', async () => {
    server = new BroadcastServer();
    await server.start(19102);

    const ws1 = await connectClient(19102);
    const ws2 = await connectClient(19102);
    const ws3 = await connectClient(19102);
    clients.push(ws1, ws2, ws3);
    await new Promise(r => setTimeout(r, 50));

    const event = { source: 'test', data: 'hello' };
    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);
    const p3 = nextMessage(ws3);

    server.broadcast(event);

    const [m1, m2, m3] = await Promise.all([p1, p2, p3]);
    assert.deepEqual(m1, event);
    assert.deepEqual(m2, event);
    assert.deepEqual(m3, event);
  });

  it('removes client that errors on send', async () => {
    server = new BroadcastServer();
    await server.start(19103);

    const ws = await connectClient(19103);
    clients.push(ws);
    await new Promise(r => setTimeout(r, 50));

    // Simulate a broken client by overriding send on the server-side ws
    const serverWs = [...server.clients][0];
    serverWs.send = () => { throw new Error('broken'); };

    server.broadcast({ test: true });
    assert.equal(server.clients.size, 0);
  });

  it('stops cleanly and releases port', async () => {
    server = new BroadcastServer();
    await server.start(19104);
    assert.equal(server.isRunning, true);

    await server.stop();
    assert.equal(server.isRunning, false);

    // Port should be released — start again on same port
    server = new BroadcastServer();
    await server.start(19104);
    assert.equal(server.isRunning, true);
  });

  it('handles port-in-use gracefully (non-fatal)', async () => {
    server = new BroadcastServer();
    await server.start(19105);

    // Try to start another server on the same port
    const server2 = new BroadcastServer();
    await server2.start(19105);
    assert.equal(server2.isRunning, false, 'second server should not be running');
  });

  it('broadcast is no-op when server not running', () => {
    const noServer = new BroadcastServer();
    // Should not throw
    noServer.broadcast({ test: true });
    assert.equal(noServer.isRunning, false);
  });

  it('replays buffered events to new clients on connect', async () => {
    server = new BroadcastServer();
    await server.start(19106);

    // Broadcast events with no clients connected
    server.broadcast({ source: 'agent', persona: 'Jordan', msg: 'first' });
    server.broadcast({ source: 'agent', persona: 'Taylor', msg: 'second' });

    // Set up message listener BEFORE connection completes — replay arrives
    // in the same tick as 'open', so connectClient+nextMessage would miss it
    const ws = new WebSocket(`ws://127.0.0.1:${19106}`);
    clients.push(ws);
    const replayPromise = nextMessage(ws);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const replay = await replayPromise;
    assert.equal(replay.type, 'replay');
    assert.equal(replay.events.length, 2);
    assert.equal(replay.events[0].persona, 'Jordan');
    assert.equal(replay.events[1].persona, 'Taylor');
  });

  it('limits event buffer to max size', async () => {
    server = new BroadcastServer();
    server._maxBufferSize = 5;
    await server.start(19107);

    // Broadcast more events than the buffer holds
    for (let i = 0; i < 8; i++) {
      server.broadcast({ source: 'test', index: i });
    }

    assert.equal(server._eventBuffer.length, 5);
    // Should keep the most recent 5 (indices 3-7)
    assert.equal(server._eventBuffer[0].index, 3);
    assert.equal(server._eventBuffer[4].index, 7);
  });

  it('skips replay when buffer is empty', async () => {
    server = new BroadcastServer();
    await server.start(19108);

    const ws = await connectClient(19108);
    clients.push(ws);
    await new Promise(r => setTimeout(r, 50));

    // Broadcast a live event — client should get it directly (not wrapped in replay)
    const msgPromise = nextMessage(ws);
    server.broadcast({ source: 'test', data: 'live' });
    const received = await msgPromise;
    assert.equal(received.source, 'test');
    assert.equal(received.data, 'live');
    assert.equal(received.type, undefined); // not a replay wrapper
  });

  it('sends close code 1000 on stop', async () => {
    server = new BroadcastServer();
    await server.start(19109);

    const ws = await connectClient(19109);
    clients.push(ws);
    await new Promise(r => setTimeout(r, 50));

    const closePromise = new Promise(resolve => {
      ws.on('close', (code) => resolve(code));
    });

    await server.stop();
    server = null;

    const code = await closePromise;
    assert.equal(code, 1000);
  });

  it('strips sensitive fields from broadcast events', async () => {
    server = new BroadcastServer();
    await server.start(19110);

    const ws = await connectClient(19110);
    clients.push(ws);
    await new Promise(r => setTimeout(r, 50));

    const event = {
      source: 'agent',
      sessionId: 'orch-session-1',
      persona: 'Jordan',
      event: {
        type: 'result',
        session_id: 'claude-secret-id',
        claudeSessionId: 'another-secret',
        result: 'ok'
      }
    };

    const msgPromise = nextMessage(ws);
    server.broadcast(event);
    const received = await msgPromise;

    // Orchestrator sessionId preserved at top level
    assert.equal(received.sessionId, 'orch-session-1');
    // Claude session IDs stripped from nested event
    assert.equal(received.event.session_id, undefined);
    assert.equal(received.event.claudeSessionId, undefined);
    // Other fields preserved
    assert.equal(received.event.type, 'result');
    assert.equal(received.event.result, 'ok');
    assert.equal(received.source, 'agent');
  });
});
