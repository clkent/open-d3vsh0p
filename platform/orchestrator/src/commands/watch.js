const WebSocket = require('ws');
const {
  formatEvent,
  formatAgentEvent,
  formatPairEvent,
  formatRileyEvent,
  formatOrchestratorEvent,
  formatMilestoneEvent,
  formatProgressEvent,
  formatGoLookEvent
} = require('../infra/format-events');

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;

async function watchCommand(project, config) {
  const port = config.broadcastPort || 3100;
  const projectId = project.id;
  const url = `ws://127.0.0.1:${port}`;

  console.log(`\n  Connecting to broadcast server on port ${port}...`);

  return new Promise((resolve) => {
    let backoff = INITIAL_BACKOFF_MS;
    let stopped = false;
    let hasConnected = false;
    let reconnectTimer = null;
    let ws = null;

    const onSignal = () => {
      console.log('\n  Watch stopped.');
      cleanup(0);
    };
    process.on('SIGINT', onSignal);

    function cleanup(code) {
      if (stopped) return;
      stopped = true;
      process.removeListener('SIGINT', onSignal);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) try { ws.close(); } catch {}
      resolve(code);
    }

    function scheduleReconnect() {
      if (stopped) return;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }

    function connect() {
      if (stopped) return;

      ws = new WebSocket(url);

      ws.on('open', () => {
        backoff = INITIAL_BACKOFF_MS;
        hasConnected = true;
        console.log(`  Connected. Watching ${projectId}...\n`);
      });

      ws.on('message', (data) => {
        try {
          const envelope = JSON.parse(data.toString());
          if (envelope.type === 'replay') {
            if (envelope.events && envelope.events.length > 0) {
              for (const event of envelope.events) {
                formatEvent(event);
              }
              console.log(`  --- ${envelope.events.length} recent events replayed ---\n`);
            }
            return;
          }
          formatEvent(envelope);
        } catch {
          // Skip unparseable messages
        }
      });

      ws.on('close', (code) => {
        if (stopped) return;
        if (code === 1000) {
          // Clean close — server ended the session
          console.log('\n  Session ended.');
          cleanup(0);
          return;
        }
        // Unexpected close — reconnect
        if (hasConnected) {
          console.log(`\n  Disconnected. Reconnecting in ${(backoff / 1000).toFixed(0)}s...`);
        }
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        if (stopped) return;
        if (err.code === 'ECONNREFUSED' && !hasConnected) {
          console.log(`  No active session yet. Retrying in ${(backoff / 1000).toFixed(0)}s...`);
        }
        // close event fires after error, reconnection happens there
      });
    }

    connect();
  });
}

module.exports = { watchCommand, formatEvent, formatAgentEvent, formatPairEvent, formatRileyEvent, formatOrchestratorEvent, formatMilestoneEvent, formatProgressEvent, formatGoLookEvent };
