const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let AgentRunner;
let queryCalls;
let mockMessages;
let mockError;

/**
 * Set up mock messages that the fake query() async generator will yield.
 */
function setMockMessages(messages, error = null) {
  mockMessages = messages;
  mockError = error;
}

describe('AgentRunner', () => {
  const sdkCacheKey = require.resolve('@anthropic-ai/claude-agent-sdk');
  let savedSdkCache;

  beforeEach(() => {
    queryCalls = [];
    mockMessages = [];
    mockError = null;

    // Save and replace the SDK module cache entry so agent-runner gets our mock
    savedSdkCache = require.cache[sdkCacheKey];
    require.cache[sdkCacheKey] = {
      id: sdkCacheKey,
      filename: sdkCacheKey,
      loaded: true,
      exports: {
        query: (params) => {
          queryCalls.push(params);
          return (async function* () {
            for (const msg of mockMessages) {
              yield msg;
            }
            if (mockError) {
              throw mockError;
            }
          })();
        }
      }
    };

    // Re-require agent-runner so it picks up the mock SDK
    delete require.cache[require.resolve('./agent-runner')];
    ({ AgentRunner } = require('./agent-runner'));
  });

  afterEach(() => {
    // Restore original SDK cache entry
    if (savedSdkCache) {
      require.cache[sdkCacheKey] = savedSdkCache;
    } else {
      delete require.cache[sdkCacheKey];
    }
  });

  function noopLogger() {
    return { log: async () => {} };
  }

  describe('SDK options mapping', () => {
    it('passes model, cwd, permissionMode, and allowDangerouslySkipPermissions', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(queryCalls.length, 1);
      const { prompt, options } = queryCalls[0];
      assert.equal(prompt, 'hello');
      assert.equal(options.model, 'claude-sonnet-4-20250514');
      assert.equal(options.cwd, '/tmp');
      assert.equal(options.permissionMode, 'bypassPermissions');
      assert.equal(options.allowDangerouslySkipPermissions, true);
    });

    it('passes systemPrompt on first turn (no resume)', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      const { options } = queryCalls[0];
      assert.equal(options.systemPrompt, 'You are a helpful assistant');
    });

    it('does NOT pass systemPrompt on resume', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        resumeSessionId: 'existing-session'
      });

      const { options } = queryCalls[0];
      assert.equal(options.systemPrompt, undefined);
      assert.equal(options.resume, 'existing-session');
    });

    it('passes resume when resumeSessionId is set', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        resumeSessionId: 'sess-abc'
      });

      const { options } = queryCalls[0];
      assert.equal(options.resume, 'sess-abc');
    });

    it('does NOT pass resume when resumeSessionId is not set', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      const { options } = queryCalls[0];
      assert.equal(options.resume, undefined);
    });

    it('passes maxBudgetUsd when set', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        maxBudgetUsd: 5.00
      });

      const { options } = queryCalls[0];
      assert.equal(options.maxBudgetUsd, 5.00);
    });

    it('does NOT pass maxBudgetUsd when not set', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      const { options } = queryCalls[0];
      assert.equal(options.maxBudgetUsd, undefined);
    });
  });

  describe('allowedTools mapping', () => {
    it('passes allowedTools when array has values', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        allowedTools: ['Bash', 'Read']
      });

      const { options } = queryCalls[0];
      assert.deepEqual(options.allowedTools, ['Bash', 'Read']);
      assert.equal(options.disallowedTools, undefined);
    });

    it('passes disallowedTools when allowedTools is empty array', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        allowedTools: []
      });

      const { options } = queryCalls[0];
      assert.equal(options.allowedTools, undefined);
      assert.deepEqual(options.disallowedTools, ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit']);
    });

    it('passes neither when allowedTools is undefined', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        allowedTools: undefined
      });

      const { options } = queryCalls[0];
      assert.equal(options.allowedTools, undefined);
      assert.equal(options.disallowedTools, undefined);
    });
  });

  describe('result parsing', () => {
    it('extracts result from SDK result message', async () => {
      setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'sess-123' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }] } },
        { type: 'result', subtype: 'success', result: 'Hello world', session_id: 'sess-123', total_cost_usd: 0.05, duration_ms: 1500, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.success, true);
      assert.equal(result.output, 'Hello world');
      assert.equal(result.sessionId, 'sess-123');
      assert.equal(result.cost, 0.05);
      assert.equal(result.duration, 1500);
      assert.equal(result.error, null);
    });

    it('returns failure when subtype is not success', async () => {
      setMockMessages([
        { type: 'result', subtype: 'error_during_execution', result: 'something failed', is_error: true, session_id: 'sess-err', total_cost_usd: 0.01 }
      ]);
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.success, false);
      assert.equal(result.error, 'something failed');
    });

    it('uses subtype in error message when result field is empty', async () => {
      setMockMessages([
        { type: 'result', subtype: 'error_max_budget_usd', result: '', is_error: true, session_id: 'sess-err', total_cost_usd: 5.00 }
      ]);
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.success, false);
      assert.equal(result.error, 'Agent ended with: error_max_budget_usd');
    });

    it('falls back to last assistant text when result field is empty', async () => {
      setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'sess-123' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me fix that for you.' }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: {} }] } },
        { type: 'result', subtype: 'success', result: '', session_id: 'sess-123', total_cost_usd: 0.05, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'fix the bug',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.success, true);
      assert.equal(result.output, 'Let me fix that for you.');
    });

    it('uses result field when present even if assistant text exists', async () => {
      setMockMessages([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it...' }] } },
        { type: 'result', subtype: 'success', result: 'Done! I fixed the bug.', session_id: 'sess-123', total_cost_usd: 0.05, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'fix the bug',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.output, 'Done! I fixed the bug.');
    });

    it('returns error when no result event is received', async () => {
      setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'sess-123' }
      ]);
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.success, false);
      assert.equal(result.error, 'No result event received from SDK');
    });
  });

  describe('onEvent callback', () => {
    it('calls onEvent for each SDK message', async () => {
      const events = [];
      const messages = [
        { type: 'system', subtype: 'init', session_id: 's1' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
        { type: 'result', subtype: 'success', result: 'done', session_id: 's1', total_cost_usd: 0, is_error: false }
      ];
      setMockMessages(messages);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        onEvent: (evt) => events.push(evt)
      });

      assert.equal(events.length, 3);
      assert.equal(events[0].type, 'system');
      assert.equal(events[1].type, 'assistant');
      assert.equal(events[2].type, 'result');
    });

    it('does not throw when onEvent is not provided', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.success, true);
    });
  });

  describe('error handling', () => {
    it('returns error when SDK throws', async () => {
      setMockMessages([], new Error('Connection refused'));
      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      assert.equal(result.success, false);
      assert.equal(result.error, 'Agent error: Connection refused');
      assert.equal(result.output, '');
    });

    it('returns timeout error when aborted', async () => {
      // Override the mock query to simulate abort behavior
      const sdkCacheKey2 = require.resolve('@anthropic-ai/claude-agent-sdk');
      require.cache[sdkCacheKey2].exports.query = (params) => {
        queryCalls.push(params);
        return (async function* () {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Working...' }] } };
          // Simulate abort
          params.options.abortController.abort();
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        })();
      };

      // Re-require to pick up updated mock
      delete require.cache[require.resolve('./agent-runner')];
      ({ AgentRunner } = require('./agent-runner'));

      const runner = new AgentRunner(noopLogger());

      const result = await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        timeoutMs: 100
      });

      assert.equal(result.success, false);
      assert.match(result.error, /timed out after 100ms/);
      assert.equal(result.output, 'Working...');
    });
  });

  describe('null byte stripping', () => {
    it('strips null bytes from prompts', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'sys\0tem',
        userPrompt: 'hel\0lo',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      const { prompt, options } = queryCalls[0];
      assert.equal(prompt, 'hello');
      assert.equal(options.systemPrompt, 'system');
    });
  });

  describe('hooks pass-through', () => {
    it('passes hooks to SDK options when provided', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());
      const myHooks = { postToolUse: () => {} };

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        hooks: myHooks
      });

      const { options } = queryCalls[0];
      assert.equal(options.hooks, myHooks);
    });

    it('does not set hooks when not provided', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514'
      });

      const { options } = queryCalls[0];
      assert.equal(options.hooks, undefined);
    });
  });

  describe('timeout cleanup', () => {
    it('provides abortController in options', async () => {
      setMockMessages([
        { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', total_cost_usd: 0, is_error: false }
      ]);
      const runner = new AgentRunner(noopLogger());

      await runner.runAgent({
        systemPrompt: 'test',
        userPrompt: 'hello',
        workingDir: '/tmp',
        model: 'claude-sonnet-4-20250514',
        timeoutMs: 30000
      });

      const { options } = queryCalls[0];
      assert.ok(options.abortController instanceof AbortController);
    });
  });
});
