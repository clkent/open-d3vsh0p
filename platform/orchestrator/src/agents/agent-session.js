const fs = require('fs/promises');
const path = require('path');

class AgentSession {
  constructor(agentRunner, templateEngine, config) {
    this.agentRunner = agentRunner;
    this.templateEngine = templateEngine;
    this.config = config;
    this._sessionId = null;
    this._turnCount = 0;
    this._contextRefresh = config.contextRefresh || null;
  }

  get sessionId() {
    return this._sessionId;
  }

  /**
   * Build a context reminder string for injection into user messages.
   * Reinforces persona, project, and conventions during long sessions.
   */
  _buildContextReminder() {
    const cr = this._contextRefresh;
    if (!cr) return null;

    const parts = [];
    if (cr.persona) {
      parts.push(`You are ${cr.persona}.`);
    }
    if (cr.projectId) {
      parts.push(`Project: ${cr.projectId}.`);
    }
    if (cr.projectDir) {
      parts.push(`Working directory: ${cr.projectDir}.`);
    }
    parts.push('Stay focused on the current task.');

    return `[Context Reminder: ${parts.join(' ')}]`;
  }

  /**
   * Start or resume an agent conversation turn.
   * Returns: { response, sessionId, cost }
   */
  async chat(userMessage, options = {}) {
    const {
      systemPromptTemplate = 'pm-agent',
      promptFile = null,
      templateVars = {},
      resumeSessionId = null,
      onEvent = undefined
    } = options;

    // Track turns and inject context reminder when needed
    this._turnCount++;
    const interval = this._contextRefresh?.interval || 5;
    if (this._contextRefresh && this._turnCount > 1 && this._turnCount % interval === 0) {
      const reminder = this._buildContextReminder();
      if (reminder) {
        userMessage = `${reminder}\n\n${userMessage}`;
      }
    }

    // Use stored session ID for continuity, or provided one
    const activeSessionId = resumeSessionId || this._sessionId;

    // Build system prompt — only needed for first turn
    let systemPrompt = null;
    if (!activeSessionId) {
      if (promptFile) {
        // Use a specific prompt file (e.g., brain-dump-prompt.md)
        const promptPath = path.join(
          this.config.templatesDir,
          systemPromptTemplate,
          promptFile
        );
        const raw = await fs.readFile(promptPath, 'utf-8');
        const resolved = await this.templateEngine._resolvePartials(raw);
        systemPrompt = this.templateEngine.renderString(resolved, templateVars);
      } else {
        systemPrompt = await this.templateEngine.renderAgentPrompt(
          systemPromptTemplate,
          templateVars
        );
      }
    }

    const result = await this.agentRunner.runAgent({
      systemPrompt,
      userPrompt: userMessage,
      workingDir: this.config.projectDir,
      model: this.config.pmModel || 'claude-sonnet-4-20250514',
      maxBudgetUsd: this.config.pmBudgetUsd,
      timeoutMs: this.config.pmTimeoutMs,
      allowedTools: this.config.allowedTools || ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit'],
      resumeSessionId: activeSessionId,
      onEvent
    });

    // Store session ID for subsequent turns
    if (result.sessionId) {
      this._sessionId = result.sessionId;
    }

    return {
      response: result.output,
      sessionId: this._sessionId,
      cost: result.cost,
      success: result.success
    };
  }

  /**
   * Save session state for later resumption.
   */
  async saveSessionState(stateDir) {
    if (!this._sessionId) return;

    const statePath = path.join(stateDir, 'agent-session.json');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({
      sessionId: this._sessionId,
      savedAt: new Date().toISOString()
    }, null, 2));
  }

  /**
   * Load session state from disk.
   */
  async loadSessionState(stateDir) {
    const statePath = path.join(stateDir, 'agent-session.json');
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(raw);
      this._sessionId = state.sessionId;
      return state;
    } catch {
      return null;
    }
  }

  /**
   * Create a Morgan (principal-engineer) session from orchestrator context.
   */
  static createMorganSession(orchestrator) {
    const pairConfig = orchestrator.config.agents?.['pair'] || orchestrator.config.agents?.['principal-engineer'] || {};
    return new AgentSession(orchestrator.agentRunner, orchestrator.templateEngine, {
      templatesDir: orchestrator.cliOptions.templatesDir,
      projectDir: orchestrator.cliOptions.projectDir,
      pmModel: pairConfig.model || 'claude-sonnet-4-20250514',
      pmBudgetUsd: pairConfig.maxBudgetUsd || 5.00,
      pmTimeoutMs: pairConfig.timeoutMs || 600000,
      allowedTools: pairConfig.allowedTools || ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit']
    });
  }

  /**
   * Create a Riley (PM agent) session for report processing.
   */
  static createRileySession(agentRunner, templateEngine, config, cliOptions) {
    const pairConfig = config.agents?.['pair'] || config.agents?.['principal-engineer'] || {};
    return new AgentSession(agentRunner, templateEngine, {
      templatesDir: cliOptions.templatesDir,
      projectDir: cliOptions.projectDir,
      pmModel: pairConfig.model || 'claude-sonnet-4-20250514',
      pmBudgetUsd: pairConfig.maxBudgetUsd || 5.00,
      pmTimeoutMs: pairConfig.timeoutMs || 600000,
      allowedTools: pairConfig.allowedTools || ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit']
    });
  }

  /**
   * Resolve agent config with sensible defaults.
   * Centralizes the repeated pattern of merging agent-specific config with defaults.
   */
  static resolveAgentConfig(config, agentKey, defaults = {}) {
    return {
      model: 'claude-sonnet-4-20250514',
      maxBudgetUsd: 5.00,
      timeoutMs: 600000,
      allowedTools: ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit'],
      ...config.agents?.[agentKey] || {},
      ...defaults
    };
  }
}

module.exports = { AgentSession };
