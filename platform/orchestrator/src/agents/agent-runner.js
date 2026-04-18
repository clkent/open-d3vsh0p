const sdk = require('@anthropic-ai/claude-agent-sdk');

class AgentRunner {
  constructor(logger) {
    this.logger = logger;
  }

  async runAgent({
    systemPrompt,
    userPrompt,
    workingDir,
    model,
    maxBudgetUsd,
    timeoutMs,
    allowedTools,
    resumeSessionId,
    onEvent,
    hooks
  }) {
    const startTime = Date.now();

    await this.logger.log('info', 'agent_started', {
      model,
      maxBudgetUsd,
      timeoutMs,
      workingDir,
      resumeSession: resumeSessionId || undefined
    });

    // Strip null bytes from prompts — template rendering or file reads can introduce them
    const safeUserPrompt = userPrompt ? userPrompt.replace(/\0/g, '') : userPrompt;
    const safeSystemPrompt = systemPrompt ? systemPrompt.replace(/\0/g, '') : systemPrompt;

    const options = {
      cwd: workingDir,
      model,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };

    // Only pass system prompt on first turn (no resume)
    if (safeSystemPrompt && !resumeSessionId) {
      options.systemPrompt = safeSystemPrompt;
    }

    // Resume an existing conversation
    if (resumeSessionId) {
      options.resume = resumeSessionId;
    }

    if (maxBudgetUsd) {
      options.maxBudgetUsd = maxBudgetUsd;
    }

    // Tool restrictions
    if (Array.isArray(allowedTools)) {
      if (allowedTools.length > 0) {
        options.allowedTools = allowedTools;
      } else {
        // Empty array = no tools. Use disallowedTools to block all.
        options.disallowedTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'];
      }
    }

    // SDK hooks pass-through
    if (hooks) {
      options.hooks = hooks;
    }

    // Timeout via AbortController
    const abortController = new AbortController();
    options.abortController = abortController;
    const timer = timeoutMs ? setTimeout(() => abortController.abort(), timeoutMs) : null;

    let lastAssistantText = '';
    let resultEvent = null;

    try {
      for await (const message of sdk.query({ prompt: safeUserPrompt, options })) {
        if (onEvent) onEvent(message);

        if (message.type === 'assistant' && message.message?.content) {
          const text = message.message.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('');
          if (text) lastAssistantText = text;
        }

        if (message.type === 'result') {
          resultEvent = message;
        }
      }
    } catch (err) {
      if (timer) clearTimeout(timer);

      if (abortController.signal.aborted) {
        return {
          success: false,
          output: lastAssistantText,
          result: null,
          cost: 0,
          duration: Date.now() - startTime,
          sessionId: null,
          error: `Agent timed out after ${timeoutMs}ms`
        };
      }

      return {
        success: false,
        output: '',
        result: null,
        cost: 0,
        duration: Date.now() - startTime,
        sessionId: null,
        error: `Agent error: ${err.message}`
      };
    }

    if (timer) clearTimeout(timer);

    if (resultEvent) {
      const cost = resultEvent.total_cost_usd || 0;
      const isError = resultEvent.subtype !== 'success';
      const output = resultEvent.result || lastAssistantText || '';

      return {
        success: !isError,
        output,
        result: resultEvent,
        cost,
        duration: resultEvent.duration_ms || (Date.now() - startTime),
        sessionId: resultEvent.session_id || null,
        error: isError ? (resultEvent.result || `Agent ended with: ${resultEvent.subtype}`) : null
      };
    }

    // Fallback (shouldn't happen with SDK)
    return {
      success: false,
      output: lastAssistantText,
      result: null,
      cost: 0,
      duration: Date.now() - startTime,
      sessionId: null,
      error: 'No result event received from SDK'
    };
  }
}

module.exports = { AgentRunner };
