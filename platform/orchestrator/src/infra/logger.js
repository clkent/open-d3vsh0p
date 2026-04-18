const fs = require('fs/promises');
const path = require('path');
const { ReviewParser } = require('../quality/review-parser');

class Logger {
  constructor(sessionId, logDir) {
    this.sessionId = sessionId;
    this.logDir = logDir;
    this.logFile = path.join(logDir, `${sessionId}.jsonl`);
    this.initialized = false;
    this.broadcastFn = null;
  }

  setBroadcast(fn) {
    this.broadcastFn = fn;
  }

  async init() {
    await fs.mkdir(this.logDir, { recursive: true });
    this.initialized = true;
  }

  async log(level, event, data = {}) {
    if (!this.initialized) await this.init();

    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data
    };

    await fs.appendFile(this.logFile, JSON.stringify(entry) + '\n');

    // Broadcast event (fire-and-forget)
    if (this.broadcastFn) {
      try {
        this.broadcastFn({ level, eventType: event, data });
      } catch {
        // Broadcast errors are non-fatal
      }
    }

    // Console output for real-time monitoring
    if (event === 'microcycle_progress') {
      console.log(`  ${data.persona}: "${data.thought}"`);
    } else if (event === 'milestone') {
      const icon = data.result === 'parked' ? '~' : '*';
      console.log(`  ${icon} [milestone] ${data.requirementId} ${data.result}`);
    } else if (event === 'progress') {
      const used = data.budgetUsedUsd?.toFixed(2) ?? '0.00';
      const limit = data.budgetLimitUsd?.toFixed(2) ?? '0.00';
      console.log(`  [progress] ${data.phase} | ${data.completed}/${data.total} | $${used}/$${limit} | ${data.elapsedMinutes}m`);
    } else if (event === 'go_look') {
      console.log(`  >>> ${data.message}`);
    } else {
      const icon = level === 'error' ? '!' : level === 'warn' ? '~' : '-';
      const context = [data.persona || data.agent, data.requirementId, data.reason]
        .filter(Boolean)
        .join(' | ');
      console.log(`  ${icon} [${event}]${context ? ' ' + context : ''}`);
    }
  }

  async logStateTransition(from, to, requirement) {
    await this.log('info', 'state_transition', {
      from,
      to,
      requirementId: requirement || undefined
    });
  }

  async logAgentRun(agentType, result, extra = {}) {
    await this.log(result.success ? 'info' : 'warn', 'agent_completed', {
      agent: agentType,
      success: result.success,
      costUsd: result.cost,
      durationMs: result.duration,
      error: result.error || undefined,
      ...extra
    });
  }

  async logTestRun(testResult) {
    await this.log(testResult.passed ? 'info' : 'warn', 'tests_completed', {
      passed: testResult.passed,
      summary: testResult.summary,
      exitCode: testResult.exitCode
    });
  }

  async logCommit(sha, message) {
    await this.log('info', 'commit_created', { sha, message });
  }

  async logMerge(requirementId, branch) {
    await this.log('info', 'merged', { requirementId, branch });
  }

  async logParked(requirementId, reason) {
    await this.log('warn', 'requirement_parked', { requirementId, reason });
  }

  async logConsumptionWarning(snapshot) {
    await this.log('warn', 'consumption_warning', snapshot);
  }

  async logMilestone(data) {
    const level = data.result === 'parked' ? 'warn' : 'info';
    await this.log(level, 'milestone', data);
  }

  async logProgress(data) {
    await this.log('info', 'progress', data);
  }

  async logGoLook(data) {
    await this.log('info', 'go_look', data);
  }

  async logPreviewCheck(result) {
    let level = 'debug';
    if (result.transition) {
      level = result.available ? 'info' : 'warn';
    }
    await this.log(level, 'preview_check', {
      available: result.available,
      responseTimeMs: result.responseTimeMs,
      reason: result.reason,
      transition: result.transition
    });
  }

  async writeSummary(state, { humanItems } = {}) {
    if (!this.initialized) await this.init();

    // Extract interventions from parked items
    const interventions = (state.requirements.parked || [])
      .filter(p => p.intervention)
      .map(p => ({
        requirementId: p.id,
        ...p.intervention
      }));

    const summaryPath = path.join(this.logDir, `${this.sessionId}-summary.json`);
    const summary = {
      sessionId: state.sessionId,
      projectId: state.projectId,
      startedAt: state.startedAt,
      completedAt: new Date().toISOString(),
      stopReason: this._determineStopReason(state),
      totalCostUsd: state.consumption.totalCostUsd,
      totalDurationMs: state.consumption.totalDurationMs,
      agentInvocations: state.consumption.agentInvocations,
      sessionBranch: state.sessionBranch,
      results: {
        completed: state.requirements.completed,
        parked: state.requirements.parked,
        remaining: state.requirements.pending
      },
      completedMicrocycles: state.completedMicrocycles,
      reviewMetrics: this._aggregateReviewScores(state.completedMicrocycles),
      humanItems: humanItems || [],
      interventions,
      preview: state.preview || undefined
    };

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    return summaryPath;
  }

  _aggregateReviewScores(microcycles) {
    if (!microcycles || microcycles.length === 0) return null;

    const reviews = microcycles
      .filter(mc => mc.reviewScores)
      .map(mc => ({
        structured: true,
        scores: mc.reviewScores,
        issues: []
      }));

    if (reviews.length === 0) return null;
    return ReviewParser.aggregate(reviews);
  }

  _determineStopReason(state) {
    if (state.requirements.pending.length === 0 && !state.requirements.inProgress) {
      return 'all_requirements_processed';
    }
    return 'session_ended';
  }
}

module.exports = { Logger };
