const fs = require('fs/promises');
const path = require('path');
const { loadDevShopContext } = require('./devshop-context');
const { createWriteSandbox } = require('./sandbox-hooks');

const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATES_DIR = path.join(DEVSHOP_ROOT, 'templates', 'agents');

class PmRunner {
  /**
   * Create a kickoff session with DevShop context and write sandboxing.
   *
   * Returns an object with the same .chat() interface as AgentSession,
   * so kickoff.js can swap it in with minimal changes.
   *
   * @param {object} agentRunner - AgentRunner instance
   * @param {object} templateEngine - TemplateEngine instance
   * @param {object} options
   * @param {string} options.projectDir - Project directory (write sandbox target)
   * @param {string} options.projectId - Project ID
   * @param {string} options.githubRepo - GitHub repo URL
   * @param {object} options.config - Loaded config object
   * @param {function} [options.warn] - Warning logger
   * @returns {Promise<PmSession>}
   */
  static async createKickoffSession(agentRunner, templateEngine, options) {
    const {
      projectDir,
      projectId,
      githubRepo,
      config = {},
      warn
    } = options;

    // Load DevShop context for the system prompt
    const devshopContext = await loadDevShopContext({ warn });

    // Create write sandbox hooks
    const sandboxHooks = createWriteSandbox(projectDir);

    const pmModel = config.agents?.pm?.model || 'claude-sonnet-4-20250514';

    return new PmSession(agentRunner, templateEngine, {
      templatesDir: TEMPLATES_DIR,
      projectDir,
      projectId,
      githubRepo,
      pmModel,
      devshopContext,
      sandboxHooks,
      // Start read-only for Q&A phase
      allowedTools: ['Read', 'Glob', 'Grep']
    });
  }
}

class PmSession {
  constructor(agentRunner, templateEngine, config) {
    this.agentRunner = agentRunner;
    this.templateEngine = templateEngine;
    this.config = config;
    this._sessionId = null;
    this._turnCount = 0;
  }

  get sessionId() {
    return this._sessionId;
  }

  /**
   * Chat with Riley. Returns { response, sessionId, cost, success }.
   * Compatible with AgentSession.chat() interface.
   */
  async chat(userMessage, options = {}) {
    const {
      systemPromptTemplate = 'pm-agent',
      promptFile = null,
      templateVars = {},
      onEvent = undefined
    } = options;

    this._turnCount++;

    const activeSessionId = this._sessionId;

    // Build system prompt only on first turn
    let systemPrompt = null;
    if (!activeSessionId) {
      // Inject DevShop context into template vars
      const vars = {
        ...templateVars,
        DEVSHOP_CONTEXT: this.config.devshopContext || ''
      };

      if (promptFile) {
        const promptPath = path.join(
          this.config.templatesDir,
          systemPromptTemplate,
          promptFile
        );
        const raw = await fs.readFile(promptPath, 'utf-8');
        const resolved = await this.templateEngine._resolvePartials(raw);
        systemPrompt = this.templateEngine.renderString(resolved, vars);
      } else {
        systemPrompt = await this.templateEngine.renderAgentPrompt(
          systemPromptTemplate,
          vars
        );
      }
    }

    const result = await this.agentRunner.runAgent({
      systemPrompt,
      userPrompt: userMessage,
      workingDir: this.config.projectDir,
      model: this.config.pmModel,
      allowedTools: this.config.allowedTools || ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'Edit'],
      resumeSessionId: activeSessionId,
      onEvent,
      hooks: this.config.sandboxHooks
    });

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
}

module.exports = { PmRunner, PmSession };
