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

module.exports = {
  formatEvent,
  formatAgentEvent,
  formatPairEvent,
  formatRileyEvent,
  formatOrchestratorEvent,
  formatMilestoneEvent,
  formatProgressEvent,
  formatGoLookEvent,
  extractAssistantText,
  formatEventContext
};
