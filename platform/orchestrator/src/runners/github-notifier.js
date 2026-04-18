const { execFile: exec } = require('../infra/exec-utils');

class GitHubNotifier {
  constructor(projectDir, projectName) {
    this.projectDir = projectDir;
    this.projectName = projectName;
    this.available = null;
  }

  /**
   * Check if gh CLI is available and authenticated.
   */
  async isAvailable() {
    if (this.available !== null) return this.available;

    try {
      await exec('gh', ['auth', 'status'], { cwd: this.projectDir });
      this.available = true;
    } catch {
      this.available = false;
    }

    return this.available;
  }

  /**
   * Post or update a rolling daily digest Issue.
   * Title format: [DevShop Daily] <project name> - <YYYY-MM-DD>
   */
  async postDailyDigest(sessionSummary) {
    if (!(await this.isAvailable())) {
      console.log('  ~ [github-notifier] gh CLI not available, skipping daily digest');
      return null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const title = `[DevShop Daily] ${this.projectName} - ${today}`;
    const body = this._formatDailyDigest(sessionSummary);

    try {
      // Search for today's issue
      const existingIssue = await this._findIssue(title);

      if (existingIssue) {
        // Append as comment
        await this._addComment(existingIssue.number, body);
        console.log(`  - [github-notifier] Updated daily digest Issue #${existingIssue.number}`);
        return existingIssue.number;
      } else {
        // Create new issue
        const issueNumber = await this._createIssue(title, body);
        console.log(`  - [github-notifier] Created daily digest Issue #${issueNumber}`);
        return issueNumber;
      }
    } catch (err) {
      console.log(`  ~ [github-notifier] Failed to post daily digest: ${err.message}`);
      return null;
    }
  }

  /**
   * Post a weekly cleanup report.
   * Title format: [DevShop Weekly] <project name> - <YYYY-Www>
   */
  async postWeeklyReport(report) {
    if (!(await this.isAvailable())) {
      console.log('  ~ [github-notifier] gh CLI not available, skipping weekly report');
      return null;
    }

    const weekId = this._getWeekId();
    const title = `[DevShop Weekly] ${this.projectName} - ${weekId}`;
    const body = this._formatWeeklyReport(report);

    try {
      const existingIssue = await this._findIssue(title);

      if (existingIssue) {
        await this._addComment(existingIssue.number, body);
        return existingIssue.number;
      } else {
        return await this._createIssue(title, body);
      }
    } catch (err) {
      console.log(`  ~ [github-notifier] Failed to post weekly report: ${err.message}`);
      return null;
    }
  }

  /**
   * Post a monthly cost review report.
   * Title format: [DevShop Monthly] <project name> - <YYYY-MM>
   */
  async postMonthlyReport(report) {
    if (!(await this.isAvailable())) {
      console.log('  ~ [github-notifier] gh CLI not available, skipping monthly report');
      return null;
    }

    const monthId = new Date().toISOString().slice(0, 7);
    const title = `[DevShop Monthly] ${this.projectName} - ${monthId}`;
    const body = this._formatMonthlyReport(report);

    try {
      return await this._createIssue(title, body);
    } catch (err) {
      console.log(`  ~ [github-notifier] Failed to post monthly report: ${err.message}`);
      return null;
    }
  }

  async _findIssue(title) {
    try {
      const { stdout } = await exec('gh', [
        'issue', 'list',
        '--search', title,
        '--state', 'open',
        '--json', 'number,title',
        '--limit', '5'
      ], { cwd: this.projectDir });

      const issues = JSON.parse(stdout);
      return issues.find(i => i.title === title) || null;
    } catch {
      return null;
    }
  }

  async _createIssue(title, body) {
    const { stdout } = await exec('gh', [
      'issue', 'create',
      '--title', title,
      '--body', body
    ], { cwd: this.projectDir });

    // gh outputs the URL of the created issue
    const match = stdout.match(/\/issues\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  async _addComment(issueNumber, body) {
    await exec('gh', [
      'issue', 'comment', String(issueNumber),
      '--body', body
    ], { cwd: this.projectDir });
  }

  _formatDailyDigest(summary) {
    const sections = [];
    const ts = new Date().toISOString();

    sections.push(`## Session: ${summary.sessionId || 'N/A'}`);
    sections.push(`_Updated at ${ts}_\n`);

    if (summary.window) {
      sections.push(`**Window:** ${summary.window}`);
    }

    sections.push(`**Cost:** $${(summary.totalCostUsd || 0).toFixed(2)}`);
    sections.push(`**Invocations:** ${summary.agentInvocations || 0}`);

    if (summary.sessionBranch) {
      sections.push(`**Branch:** \`${summary.sessionBranch}\``);
    }

    if (summary.results) {
      const { completed, parked, remaining } = summary.results;
      sections.push(`\n### Results`);
      sections.push(`- Completed: ${completed ? completed.length : 0}`);
      sections.push(`- Parked: ${parked ? parked.length : 0}`);
      sections.push(`- Remaining: ${remaining ? remaining.length : 0}`);

      if (completed && completed.length > 0) {
        sections.push(`\n**Completed:** ${completed.join(', ')}`);
      }
      if (parked && parked.length > 0) {
        // Show parked items with reasons if available (parked entries may be objects or strings)
        const parkedLines = parked.map(p => {
          if (typeof p === 'object' && p.id) {
            const reason = p.reason ? ` — ${p.reason.split('\n')[0].slice(0, 200)}` : '';
            return `\`${p.id}\`${reason}`;
          }
          return `\`${p}\``;
        });
        sections.push(`\n**Parked:**`);
        for (const line of parkedLines) {
          sections.push(`- ${line}`);
        }
      }
    }

    // Runtime-discovered interventions
    if (summary.interventions && summary.interventions.length > 0) {
      sections.push(`\n### Interventions Required`);
      for (const instr of summary.interventions) {
        sections.push(`\n**\`${instr.requirementId}\`** — ${instr.title} [${instr.category}]`);
        for (let i = 0; i < instr.steps.length; i++) {
          sections.push(`${i + 1}. ${instr.steps[i]}`);
        }
        if (instr.verifyCommand) {
          sections.push(`\n_Verify:_ \`${instr.verifyCommand}\``);
        }
      }
    }

    if (summary.preview && summary.preview.available) {
      sections.push(`\n**Preview available:** \`${summary.preview.command}\` on port ${summary.preview.port || 'default'}`);
    }

    if (summary.stopReason) {
      sections.push(`\n**Stop reason:** ${summary.stopReason}`);
    }

    return sections.join('\n');
  }

  _formatWeeklyReport(report) {
    const sections = [];
    sections.push(`## Weekly Cleanup Report`);
    sections.push(`_Generated ${new Date().toISOString()}_\n`);

    if (report.branches) {
      sections.push(`### Branch Cleanup`);
      sections.push(`- Merged branches removed: ${report.branches.merged || 0}`);
      sections.push(`- Abandoned branches removed: ${report.branches.abandoned || 0}`);
      if (report.branches.details && report.branches.details.length > 0) {
        sections.push(`\n<details><summary>Details</summary>\n`);
        for (const d of report.branches.details) {
          sections.push(`- \`${d.name}\` — ${d.reason}`);
        }
        sections.push(`\n</details>`);
      }
    }

    if (report.worktrees) {
      sections.push(`\n### Worktree Cleanup`);
      sections.push(`- Pruned: ${report.worktrees.pruned || 0}`);
    }

    return sections.join('\n');
  }

  _formatMonthlyReport(report) {
    const sections = [];
    sections.push(`## Monthly Review Report`);
    sections.push(`_Generated ${new Date().toISOString()}_\n`);

    if (report.cost) {
      sections.push(`### Cost Summary`);
      sections.push(`- Total cost: $${(report.cost.totalCost || 0).toFixed(2)}`);
      sections.push(`- Sessions: ${report.cost.sessionCount || 0}`);
      sections.push(`- Avg cost/session: $${(report.cost.avgCostPerSession || 0).toFixed(2)}`);
      sections.push(`- Total invocations: ${report.cost.totalInvocations || 0}`);

      if (report.cost.previousMonth) {
        const change = report.cost.monthOverMonthChange;
        const direction = change >= 0 ? 'increase' : 'decrease';
        sections.push(`\n**Month-over-month:** ${Math.abs(change).toFixed(1)}% ${direction}`);

        if (change > 50) {
          sections.push(`\n> **Warning:** Cost increase exceeds 50% threshold. Review recommended.`);
        }
      }
    }

    if (report.archived) {
      sections.push(`\n### Archived Items`);
      sections.push(`- Archived: ${report.archived.count || 0} parked items (inactive >30 days)`);
      if (report.archived.items && report.archived.items.length > 0) {
        for (const item of report.archived.items) {
          sections.push(`  - \`${item}\``);
        }
      }
    }

    return sections.join('\n');
  }

  _getWeekId() {
    const now = new Date();
    const year = now.getFullYear();
    // ISO week calculation
    const jan1 = new Date(year, 0, 1);
    const dayOfYear = Math.floor((now - jan1) / 86400000) + 1;
    const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
  }
}

module.exports = { GitHubNotifier };
