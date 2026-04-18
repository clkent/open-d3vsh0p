const WebSocket = require('ws');

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

function formatEvent(envelope) {
  if (envelope.source === 'agent') {
    formatAgentEvent(envelope);
  } else if (envelope.source === 'pair') {
    formatPairEvent(envelope);
  } else if (envelope.source === 'riley') {
    formatRileyEvent(envelope);
  } else if (envelope.source === 'orchestrator') {
    formatOrchestratorEvent(envelope);
  }
}

function formatAgentEvent(envelope) {
  const { persona, requirementId, event } = envelope;

  if (!event) return;

  if (event.type === 'assistant') {
    const content = extractAssistantText(event);
    if (content) {
      console.log(`  [${persona}] (${requirementId}) ${content}`);
    }
  } else if (event.type === 'result') {
    const status = event.is_error ? 'ERROR' : 'DONE';
    console.log(`  [${persona}] (${requirementId}) ${status}`);
  }
}

function formatPairEvent(envelope) {
  const { persona, event } = envelope;

  if (!event) return;

  if (event.type === 'assistant') {
    const content = extractAssistantText(event);
    if (content) {
      console.log(`  [${persona}] ${content}`);
    }
  } else if (event.type === 'result') {
    const status = event.is_error ? 'ERROR' : 'DONE';
    console.log(`  [${persona}] ${status}`);
  }
}

function formatRileyEvent(envelope) {
  const { persona, event } = envelope;

  if (!event) return;

  if (event.type === 'assistant') {
    const content = extractAssistantText(event);
    if (content) {
      console.log(`  [${persona}] ${content}`);
    }
  } else if (event.type === 'result') {
    const status = event.is_error ? 'ERROR' : 'DONE';
    console.log(`  [${persona}] ${status}`);
  }
}

function formatOrchestratorEvent(envelope) {
  const { eventType } = envelope;

  if (eventType === 'milestone') {
    formatMilestoneEvent(envelope);
  } else if (eventType === 'progress') {
    formatProgressEvent(envelope);
  } else if (eventType === 'go_look') {
    formatGoLookEvent(envelope);
  } else {
    const { level, event } = envelope;
    const indicator = level === 'error' ? '!' : level === 'warn' ? '~' : '-';
    const context = formatEventContext(eventType, event);
    console.log(`  ${indicator} [${eventType}]${context ? ' ' + context : ''}`);
  }
}

function formatMilestoneEvent(envelope) {
  const e = envelope.event || {};
  const separator = '\u2500'.repeat(42);
  const resultLabel = (e.result || 'unknown').toUpperCase();

  console.log(`  ${separator}`);
  console.log(`  ${resultLabel}  ${e.requirementId || 'unknown'}`);

  const details = [e.persona, e.attempts ? `${e.attempts} attempts` : null, e.costUsd != null ? `$${e.costUsd.toFixed(2)}` : null]
    .filter(Boolean).join(' | ');
  if (details) console.log(`  ${details}`);
  if (e.diffStat) console.log(`  ${e.diffStat}`);
  if (e.reviewSummary) console.log(`  Review: ${e.reviewSummary}`);
  if (e.previewAvailable != null) {
    console.log(`  Preview: ${e.previewAvailable ? 'available' : 'unavailable'}`);
  }
  if (e.progress) {
    const parked = e.progress.parked ? ` (${e.progress.parked} parked)` : '';
    console.log(`  Progress: ${e.progress.completed}/${e.progress.total} complete${parked}`);
  }
  console.log(`  ${separator}`);
}

function formatProgressEvent(envelope) {
  const e = envelope.event || {};
  const completed = e.completed || 0;
  const total = e.total || 0;
  const parked = e.parked ? ` (${e.parked} parked)` : '';
  const used = (e.budgetUsedUsd || 0).toFixed(2);
  const limit = (e.budgetLimitUsd || 0).toFixed(2);
  const elapsed = e.elapsedMinutes || 0;

  let line = `  [progress] ${e.phase || ''} | ${completed}/${total} complete${parked} | $${used}/$${limit} | ${elapsed}m elapsed`;

  if (e.activeAgents && e.activeAgents.length > 0) {
    const agents = e.activeAgents.map(a => `${a.persona}(${a.requirementId})`).join(', ');
    console.log(line);
    console.log(`  Active: ${agents}`);
  } else {
    console.log(line);
  }
}

function formatGoLookEvent(envelope) {
  const e = envelope.event || {};
  console.log(`  >>> ${e.message || 'Preview available'}`);
}

function extractAssistantText(event) {
  if (event.message && event.message.content) {
    const textBlocks = event.message.content
      .filter(b => b.type === 'text' || typeof b === 'string' || b.text)
      .map(b => b.text || b)
      .join('');
    // Truncate long messages for readability
    if (textBlocks.length > 200) {
      return textBlocks.slice(0, 200) + '...';
    }
    return textBlocks || null;
  }
  return null;
}

function formatEventContext(eventType, event) {
  if (!event) return '';

  const parts = [];
  if (event.persona) parts.push(event.persona);
  if (event.requirementId) parts.push(event.requirementId);
  if (event.phase) parts.push(event.phase);
  if (event.reason) parts.push(event.reason);

  return parts.join(' | ');
}

module.exports = { watchCommand, formatEvent, formatAgentEvent, formatPairEvent, formatRileyEvent, formatOrchestratorEvent, formatMilestoneEvent, formatProgressEvent, formatGoLookEvent };
