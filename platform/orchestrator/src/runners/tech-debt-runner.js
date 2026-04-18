const fs = require('fs/promises');
const path = require('path');
const { AgentRunner } = require('../agents/agent-runner');
const { TemplateEngine } = require('../agents/template-engine');
const { Logger } = require('../infra/logger');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');
const { SecurityRunner } = require('./security-runner');

class TechDebtRunner {
  constructor(config) {
    this.config = config;
    this.projectId = config.projectId;
    this.projectDir = config.projectDir;
    this.templatesDir = config.templatesDir;
    this.activeAgentsDir = config.activeAgentsDir;
    const { logsDir } = getOrchestratorPaths(config);
    this.agentRunner = new AgentRunner(
      new Logger(generateSessionId('techdebt'), logsDir)
    );
  }

  /**
   * Run the full tech debt cycle: security scan + PE improvement pass.
   * Returns { securityResult, peResult, totalCost }.
   */
  async run() {
    console.log('');
    console.log('=== Tech Debt Window ===');
    console.log(`  Project: ${this.projectId}`);
    console.log('========================');
    console.log('');

    let totalCost = 0;

    // Phase 1: Security scan (Casey)
    console.log('  Phase 1: Security Scan (Casey)');
    const securityResult = await this._runSecurityScan();
    totalCost += securityResult.cost || 0;

    if (!securityResult.success) {
      console.log(`  ~ Security scan failed: ${securityResult.error}`);
    } else {
      console.log(`  - Security scan complete ($${(securityResult.cost || 0).toFixed(2)})`);
    }

    // Phase 2: PE improvement pass (Morgan)
    console.log('  Phase 2: PE Improvement Pass (Morgan)');
    const peResult = await this._runPEPass(securityResult.output);
    totalCost += peResult.cost || 0;

    if (!peResult.success) {
      console.log(`  ~ PE pass failed: ${peResult.error}`);
    } else {
      console.log(`  - PE pass complete ($${(peResult.cost || 0).toFixed(2)})`);
    }

    console.log('');
    console.log(`  Total tech debt cost: $${totalCost.toFixed(2)}`);

    return { securityResult, peResult, totalCost };
  }

  async _runSecurityScan() {
    const securityRunner = new SecurityRunner(this.config);
    return securityRunner.run();
  }

  async _runPEPass(securityFindings) {
    const techDebtPromptPath = path.join(
      this.templatesDir, 'principal-engineer', 'tech-debt-prompt.md'
    );

    let techDebtPrompt;
    try {
      techDebtPrompt = await fs.readFile(techDebtPromptPath, 'utf-8');
    } catch {
      // Fallback to standard system prompt if tech-debt-specific one doesn't exist
      const templateEngine = new TemplateEngine(this.templatesDir);
      techDebtPrompt = await templateEngine.render('principal-engineer', {
        PROJECT_ID: this.projectId,
        PROJECT_DIR: this.projectDir
      });
    }

    // Replace template variables
    techDebtPrompt = techDebtPrompt
      .replace(/\{\{PROJECT_ID\}\}/g, this.projectId)
      .replace(/\{\{PROJECT_DIR\}\}/g, this.projectDir);

    const securityContext = securityFindings
      ? `\n\n## Security Findings (from Casey)\n\n${securityFindings}`
      : '\n\nNo security findings from the scan.';

    const userPrompt = [
      'Run a full codebase tech debt improvement pass.',
      'Focus on: code quality, refactoring opportunities, test coverage gaps,',
      'and any patterns that could be improved.',
      '',
      `Project directory: ${this.projectDir}`,
      securityContext,
      '',
      'For each issue found, create a commit with the fix.',
      'Prioritize: critical issues first, then important, then minor.'
    ].join('\n');

    const agentConfig = this.config.agents?.['principal-engineer'] || {};

    return this.agentRunner.runAgent({
      systemPrompt: techDebtPrompt,
      userPrompt,
      workingDir: this.projectDir,
      model: agentConfig.model || 'claude-sonnet-4-20250514',
      maxBudgetUsd: agentConfig.maxBudgetUsd || 3,
      timeoutMs: agentConfig.timeoutMs || 600000,
      allowedTools: agentConfig.allowedTools || ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write']
    });
  }
}

module.exports = { TechDebtRunner };
