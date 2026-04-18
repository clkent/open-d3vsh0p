const fs = require('fs/promises');
const path = require('path');
const { AgentRunner } = require('../agents/agent-runner');
const { TemplateEngine } = require('../agents/template-engine');
const { Logger } = require('../infra/logger');
const { generateSessionId } = require('../session/session-utils');
const { getOrchestratorPaths } = require('../session/path-utils');

const FOCUS_LABELS = {
  secrets: 'hardcoded secrets, API keys, tokens, and credentials',
  deps: 'insecure or outdated dependencies',
  injection: 'injection vulnerabilities (SQL, command, XSS, template)',
  auth: 'authentication and authorization issues',
  config: 'insecure configuration and exposed sensitive settings'
};

class SecurityRunner {
  constructor(config) {
    this.config = config;
    this.projectId = config.projectId;
    this.projectDir = config.projectDir;
    this.templatesDir = config.templatesDir;
    this.focusAreas = config.focusAreas || null;
    this.maxBudgetUsd = config.maxBudgetUsd || config.agents?.security?.maxBudgetUsd || 2;
    this.timeoutMs = config.timeoutMs || config.agents?.security?.timeoutMs || 300000;
    const { logsDir } = getOrchestratorPaths(config);
    this.agentRunner = new AgentRunner(
      new Logger(generateSessionId('security'), logsDir)
    );
  }

  /**
   * Run a standalone Casey security scan.
   * Returns { success, output, cost, error }.
   */
  async run() {
    const templateEngine = new TemplateEngine(this.templatesDir);
    const systemPrompt = await templateEngine.render('security-agent', {
      PROJECT_ID: this.projectId,
      PROJECT_DIR: this.projectDir
    });

    const userPrompt = this._buildUserPrompt();
    const agentConfig = this.config.agents?.security || {};

    const result = await this.agentRunner.runAgent({
      systemPrompt,
      userPrompt,
      workingDir: this.projectDir,
      model: agentConfig.model || 'claude-sonnet-4-20250514',
      maxBudgetUsd: this.maxBudgetUsd,
      timeoutMs: this.timeoutMs,
      allowedTools: agentConfig.allowedTools || ['Read', 'Glob', 'Grep']
    });

    return result;
  }

  _buildUserPrompt() {
    const parts = [
      'Run a full codebase security audit.',
      'Scan the entire project — not just recent changes.'
    ];

    if (this.focusAreas && this.focusAreas.length > 0) {
      const labels = this.focusAreas
        .map(a => FOCUS_LABELS[a] || a)
        .join(', ');
      parts.push(`Focus your scan on: ${labels}.`);
    } else {
      parts.push(
        'Check for: hardcoded secrets, injection vulnerabilities, auth issues,',
        'insecure dependencies, and any patterns of insecurity.'
      );
    }

    parts.push('', `Project directory: ${this.projectDir}`, '', 'Produce your standard security audit report.');
    return parts.join('\n');
  }

  /**
   * Write findings to openspec/scans/<date>-security.md.
   * Returns the report file path.
   */
  async writeReport(output) {
    const scansDir = path.join(this.projectDir, 'openspec', 'scans');
    await fs.mkdir(scansDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const reportPath = await this._resolveReportPath(scansDir, date);

    await fs.writeFile(reportPath, output);
    return reportPath;
  }

  async _resolveReportPath(scansDir, date) {
    const base = path.join(scansDir, `${date}-security.md`);
    try {
      await fs.access(base);
    } catch {
      return base;
    }

    // File exists — find next available suffix
    let suffix = 2;
    while (true) {
      const candidate = path.join(scansDir, `${date}-security-${suffix}.md`);
      try {
        await fs.access(candidate);
        suffix++;
      } catch {
        return candidate;
      }
    }
  }

  /**
   * Parse findings output for severity counts.
   * Returns { critical, high, medium, low, total }.
   */
  parseSeverityCounts(output) {
    if (!output) return { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

    const lower = output.toLowerCase();
    const critical = (lower.match(/\bcritical\b/g) || []).length;
    const high = (lower.match(/\bhigh\b/g) || []).length;
    const medium = (lower.match(/\bmedium\b/g) || []).length;
    const low = (lower.match(/\blow\b/g) || []).length;
    const total = critical + high + medium + low;

    return { critical, high, medium, low, total };
  }

  /**
   * Print a summary of findings to stdout.
   */
  printSummary(counts, reportPath) {
    if (counts.total === 0) {
      console.log('  No security issues found.');
    } else {
      const parts = [];
      if (counts.critical > 0) parts.push(`${counts.critical} critical`);
      if (counts.high > 0) parts.push(`${counts.high} high`);
      if (counts.medium > 0) parts.push(`${counts.medium} medium`);
      if (counts.low > 0) parts.push(`${counts.low} low`);
      console.log(`  Found ${parts.join(', ')} issues.`);
    }
    console.log(`  Report: ${reportPath}`);
  }
}

module.exports = { SecurityRunner, FOCUS_LABELS };
