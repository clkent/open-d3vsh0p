const path = require('path');
const { ReviewParser } = require('./quality/review-parser');
const { execFile: exec } = require('./infra/exec-utils');
const { ConventionChecker } = require('./quality/convention-checker');
const { ImportVerifier } = require('./quality/import-verifier');
/**
 * Microcycle: implement → import verify → test → commit → convention check → review → merge
 *
 * A single requirement lifecycle extracted from the orchestrator.
 * Operates in a given working directory (can be a worktree for parallel execution).
 */
class Microcycle {
  constructor({
    agentRunner,
    templateEngine,
    gitOps,
    openspec,
    logger,
    monitor,
    config,
    projectDir,
    workingDir,
    sessionBranch,
    projectId,
    techStack,
    conventions,
    gotchas,
    persona,
    personaName,
    failureHistory,
    priorWorkDiff,
    phaseContext,
    peerContext,
    onEvent
  }) {
    this.agentRunner = agentRunner;
    this.templateEngine = templateEngine;
    this.gitOps = gitOps;
    this.openspec = openspec;
    this.logger = logger;
    this.monitor = monitor;
    this.config = config;
    this.projectDir = projectDir;
    this.workingDir = workingDir;
    this.sessionBranch = sessionBranch;
    this.projectId = projectId;
    this.techStack = techStack || 'Not specified';
    this.conventions = conventions || null;
    this.gotchas = gotchas || null;
    this.persona = persona || 'implementation-agent';
    this.personaName = personaName || null;
    this.failureHistory = failureHistory || null;
    this.priorWorkDiff = priorWorkDiff || null;
    this.phaseContext = phaseContext || [];
    this.peerContext = peerContext || [];
    this.onEvent = onEvent || undefined;
  }

  /**
   * Run the full microcycle for a requirement.
   * Returns: { status: 'merged'|'parked', cost, attempts, commitSha, workBranch, error, salvaged?, workBranch? }
   */
  async run(requirementId, changeName, requirement) {
    const retryLimits = this.config.retryLimits || { implementation: 3, testFix: 3, reviewFix: 2 };

    // Cache design skills section for template rendering
    this._designSkillsSection = await this.openspec.getDesignSkillsSection();

    // Create work branch
    const workBranch = await this.gitOps.createWorkBranch(
      this.workingDir,
      this.sessionBranch,
      requirementId
    );

    const state = {
      attempt: 0,
      totalCost: 0,
      lastError: null,
      reviewFeedback: null,
      commitSha: null,
      implementRetries: 0,
      stallRetries: 0,
      testFixRetries: 0,
      reviewFixRetries: 0,
      lastReviewScores: null,
      didSalvage: false,
      attemptHistory: [],
    };

    while (true) {
      state.attempt++;

      // Check consumption limits
      const stopCheck = this.monitor.shouldStop();
      if (stopCheck.stop) {
        await this.logger.log('warn', 'microcycle_stopped', {
          requirementId,
          reason: stopCheck.reason
        });
        return { status: 'parked', cost: state.totalCost, attempts: state.attempt, error: stopCheck.reason, attemptHistory: state.attemptHistory };
      }

      // Implement
      const impl = await this._doImplement(state, requirementId, changeName, requirement, workBranch, retryLimits);
      if (impl.action === 'park') return impl.result;
      if (impl.action === 'continue') continue;

      // Import verification
      const imports = await this._doImportVerification(state, requirementId, workBranch, retryLimits);
      if (imports.action === 'park') return imports.result;
      if (imports.action === 'continue') continue;

      // Test
      const test = await this._doTest(state, requirementId, workBranch, retryLimits);
      if (test.action === 'park') return test.result;
      if (test.action === 'continue') continue;

      // Commit
      const commit = await this._doCommit(state, requirementId, requirement, workBranch, retryLimits);
      if (commit.action === 'park') return commit.result;
      if (commit.action === 'continue') continue;

      // Convention check
      const conv = await this._doConventionCheck(state, requirementId, workBranch, retryLimits);
      if (conv.action === 'park') return conv.result;
      if (conv.action === 'continue') continue;

      // Review
      const review = await this._doReview(state, requirementId, requirement, workBranch, retryLimits);
      if (review.action === 'park') return review.result;
      if (review.action === 'continue') continue;

      break; // All phases passed
    }

    // === MERGE ===
    // Merge happens externally (caller is responsible for serialization via merge lock)
    return {
      status: 'merged',
      cost: state.totalCost,
      attempts: state.attempt,
      commitSha: state.commitSha,
      workBranch,
      reviewScores: state.lastReviewScores ? state.lastReviewScores.scores : null,
      error: null
    };
  }

  // --- Phase methods ---

  async _doImplement(state, requirementId, changeName, requirement, workBranch, retryLimits) {
    const stallLimit = retryLimits.implementation || 3;
    const maxAttempts = retryLimits.implementationMaxAttempts || (stallLimit + 4);

    await this._emitProgress('implementing', requirementId, `Working on ${requirementId}...`);

    // Soft budget advisory — log warning but never block
    if (this.monitor.canAffordAgent) {
      const budgetCheck = this.monitor.canAffordAgent(this.config.agents['implementation'].maxBudgetUsd || 5);
      if (!budgetCheck.ok) {
        await this.logger.log('warn', 'budget_warning', {
          requirementId,
          phase: 'implementation',
          remainingUsd: budgetCheck.remainingUsd,
          estimatedCostUsd: budgetCheck.estimatedCostUsd
        });
      }
    }

    await this.gitOps.checkoutBranch(this.workingDir, workBranch);

    // Snapshot worktree before implementation attempt
    const snapshotBefore = await this._snapshotWorktree();

    const implResult = await this._implement(
      requirementId, changeName, requirement, state.lastError, state.reviewFeedback,
      state.attempt, state.attemptHistory
    );
    state.totalCost += implResult.cost || 0;
    this.monitor.recordInvocation(implResult.cost, implResult.duration);

    if (!implResult.success) {
      // Salvage check: agent may have completed work before failing (e.g. context overflow)
      let salvageResult = { salvaged: false };
      try {
        salvageResult = await this._trySalvage(requirementId);
      } catch (salvageErr) {
        await this.logger.log('warn', 'salvage_check_failed', {
          requirementId,
          error: salvageErr.message
        });
      }
      if (salvageResult.salvaged) {
        await this.logger.log('info', 'implementation_salvaged', {
          requirementId,
          persona: this.personaName,
          originalError: implResult.error
        });
        await this._emitProgress('salvaged', requirementId, `Agent errored but work looks complete, verifying...`);
        state.didSalvage = true;
        // Fall through to next phase
        return { action: 'proceed' };
      }

      // Snapshot worktree after failed attempt to detect progress
      const snapshotAfter = await this._snapshotWorktree();
      const madeProgress = this._didMakeProgress(snapshotBefore, snapshotAfter);

      state.implementRetries++;
      if (!madeProgress) state.stallRetries++;

      await this.logger.log('info', madeProgress ? 'implementation_progress_detected' : 'implementation_stalled', {
        requirementId,
        persona: this.personaName,
        attempt: state.attempt,
        implementRetries: state.implementRetries,
        stallRetries: state.stallRetries
      });

      if (state.stallRetries >= stallLimit || state.implementRetries >= maxAttempts) {
        await this._returnToSession();
        return {
          action: 'park',
          result: {
            status: 'parked', cost: state.totalCost, attempts: state.attempt,
            error: this._buildEnrichedParkingError(`Implementation retries exhausted. Last: ${implResult.error}`, state.attemptHistory),
            attemptHistory: state.attemptHistory
          }
        };
      }
      state.lastError = implResult.error;
      state.attemptHistory.push({ attempt: state.attempt, error: implResult.error, type: 'implementation', madeProgress });
      state.reviewFeedback = null;
      await this._emitProgress('retrying_implementation', requirementId, `That didn't work, trying again...`);
      return { action: 'continue' };
    }

    return { action: 'proceed' };
  }

  async _doImportVerification(state, requirementId, workBranch, retryLimits) {
    const maxImplementation = retryLimits.implementation || 3;

    try {
      const importResult = await this._verifyImports();
      if (!importResult.passed) {
        const importMsg = `Import verification failed. The following imports reference files that do not exist:\n${importResult.errors.map(e => `- ${e}`).join('\n')}\n\nEither create these files or fix the imports to point to existing modules.`;
        state.implementRetries++;
        if (state.implementRetries > maxImplementation) {
          await this._returnToSession();
          return {
            action: 'park',
            result: {
              status: 'parked', cost: state.totalCost, attempts: state.attempt,
              error: this._buildEnrichedParkingError(`Import verification failed after all retries. ${importMsg}`, state.attemptHistory),
              attemptHistory: state.attemptHistory,
              ...(state.didSalvage && { salvaged: true, workBranch })
            }
          };
        }
        state.lastError = importMsg;
        state.attemptHistory.push({ attempt: state.attempt, error: `Unresolved imports: ${importResult.errors[0]}`, type: 'implementation' });
        state.reviewFeedback = null;
        await this._emitProgress('retrying_imports', requirementId, `Found hallucinated imports, fixing...`);
        return { action: 'continue' };
      }
    } catch (err) {
      await this.logger.log('warn', 'import_verification_failed', {
        requirementId,
        error: err.message
      });
      // Non-fatal: proceed to tests if verification itself errors
    }

    return { action: 'proceed' };
  }

  async _doTest(state, requirementId, workBranch, retryLimits) {
    const maxTestFix = retryLimits.testFix || 3;

    await this._emitProgress('testing', requirementId, `Running tests...`);
    const testResult = await this._runTests();
    await this.logger.logTestRun(testResult);

    if (!testResult.passed) {
      state.testFixRetries++;
      if (state.testFixRetries > maxTestFix) {
        await this._returnToSession();
        return {
          action: 'park',
          result: {
            status: 'parked', cost: state.totalCost, attempts: state.attempt,
            error: this._buildEnrichedParkingError(`Test fix retries exhausted. Last output:\n${testResult.output}`, state.attemptHistory),
            attemptHistory: state.attemptHistory,
            ...(state.didSalvage && { salvaged: true, workBranch })
          }
        };
      }
      state.lastError = `Tests failed:\n${testResult.output}`;
      state.attemptHistory.push({ attempt: state.attempt, error: `Tests failed: ${testResult.summary || testResult.output.slice(0, 200)}`, type: 'test' });
      state.reviewFeedback = null;
      await this._emitProgress('retrying_tests', requirementId, `Tests failed, let me look at this...`);
      return { action: 'continue' };
    }

    return { action: 'proceed' };
  }

  async _doCommit(state, requirementId, requirement, workBranch, retryLimits) {
    const maxImplementation = retryLimits.implementation || 3;

    await this._emitProgress('committing', requirementId, `Tests look good, committing...`);
    const commitMessage = `${this.config.git.commitPrefix}: implement ${requirement.name}`;
    state.commitSha = await this.gitOps.commitAll(this.workingDir, commitMessage);

    if (!state.commitSha) {
      // Check if agent already committed
      const log = await this.gitOps.getLog(this.workingDir, this.sessionBranch);
      if (log.trim()) {
        state.commitSha = 'agent-committed';
      } else {
        state.implementRetries++;
        if (state.implementRetries > maxImplementation) {
          await this._returnToSession();
          return {
            action: 'park',
            result: {
              status: 'parked', cost: state.totalCost, attempts: state.attempt,
              error: this._buildEnrichedParkingError('No code changes produced after all retries', state.attemptHistory),
              attemptHistory: state.attemptHistory,
              ...(state.didSalvage && { salvaged: true, workBranch })
            }
          };
        }
        state.lastError = 'No code changes were produced. Please implement the requirements.';
        state.attemptHistory.push({ attempt: state.attempt, error: 'No code changes produced', type: 'implementation' });
        state.reviewFeedback = null;
        return { action: 'continue' };
      }
    }

    return { action: 'proceed' };
  }

  async _doConventionCheck(state, requirementId, workBranch, retryLimits) {
    if (!this.conventions) return { action: 'proceed' };
    const maxImplementation = retryLimits.implementation || 3;

    try {
      const conventionResult = await this._checkConventions();
      if (!conventionResult.passed) {
        const violationMsg = `Convention violations found:\n${conventionResult.violations.join('\n')}`;
        state.implementRetries++;
        if (state.implementRetries > maxImplementation) {
          await this._returnToSession();
          return {
            action: 'park',
            result: {
              status: 'parked', cost: state.totalCost, attempts: state.attempt,
              error: this._buildEnrichedParkingError(`Convention check failed after all retries. ${violationMsg}`, state.attemptHistory),
              attemptHistory: state.attemptHistory,
              ...(state.didSalvage && { salvaged: true, workBranch })
            }
          };
        }
        state.lastError = violationMsg;
        state.attemptHistory.push({ attempt: state.attempt, error: `Convention violation: ${conventionResult.violations[0]}`, type: 'implementation' });
        state.reviewFeedback = null;
        await this._emitProgress('retrying_conventions', requirementId, `Convention check failed, fixing...`);
        return { action: 'continue' };
      }
    } catch (err) {
      await this.logger.log('warn', 'convention_check_failed', {
        requirementId,
        error: err.message
      });
      // Non-fatal: proceed to review if convention check itself errors
    }

    return { action: 'proceed' };
  }

  async _doReview(state, requirementId, requirement, workBranch, retryLimits) {
    const maxReviewFix = retryLimits.reviewFix || 2;

    await this._emitProgress('reviewing', requirementId, `Submitting to Morgan for review...`);

    // Soft budget advisory — log warning but never block
    if (this.monitor.canAffordAgent) {
      const budgetCheck = this.monitor.canAffordAgent(this.config.agents['principal-engineer'].maxBudgetUsd || 2);
      if (!budgetCheck.ok) {
        await this.logger.log('warn', 'budget_warning', {
          requirementId,
          phase: 'review',
          remainingUsd: budgetCheck.remainingUsd,
          estimatedCostUsd: budgetCheck.estimatedCostUsd
        });
      }
    }

    const diff = await this.gitOps.getDiff(this.workingDir, this.sessionBranch);
    const diffStat = await this.gitOps.getDiffStat(this.workingDir, this.sessionBranch);

    if (!diff.trim()) {
      // Nothing to review — auto-approve
      return { action: 'break' };
    }

    let reviewResult = await this._review(requirementId, requirement, diff, diffStat);
    state.totalCost += reviewResult.cost || 0;
    this.monitor.recordInvocation(reviewResult.cost, reviewResult.duration);

    let reviewText = typeof reviewResult.output === 'string'
      ? reviewResult.output
      : JSON.stringify(reviewResult.output);

    let parsedReview = ReviewParser.parse(reviewText);

    // If review JSON was malformed, retry once with a format hint
    if (!parsedReview.structured) {
      await this.logger.log('warn', 'review_unstructured', {
        requirementId,
        fallbackDecision: parsedReview.decision
      });
      await this._emitProgress('reviewing', requirementId, `Review output was unstructured, retrying with format hint...`);

      reviewResult = await this._reviewRetry(requirementId, requirement, diff, diffStat);
      state.totalCost += reviewResult.cost || 0;
      this.monitor.recordInvocation(reviewResult.cost, reviewResult.duration);

      reviewText = typeof reviewResult.output === 'string'
        ? reviewResult.output
        : JSON.stringify(reviewResult.output);

      const retryParsed = ReviewParser.parse(reviewText);
      if (retryParsed.structured) {
        parsedReview = retryParsed;
      } else {
        await this.logger.log('warn', 'review_unstructured_after_retry', {
          requirementId,
          fallbackDecision: retryParsed.decision
        });
        // Use the retry result even if unstructured — it's still the latest review
        parsedReview = retryParsed;
      }
    }

    state.lastReviewScores = parsedReview;

    if (parsedReview.decision === 'APPROVE') {
      await this.logger.log('info', 'review_approved', {
        requirementId,
        reviewScores: parsedReview.scores,
        structured: parsedReview.structured
      });
      return { action: 'break' };
    }

    // Review requested changes — pass structured issues to retry
    state.reviewFixRetries++;
    if (state.reviewFixRetries > maxReviewFix) {
      await this._returnToSession();
      return {
        action: 'park',
        result: {
          status: 'parked', cost: state.totalCost, attempts: state.attempt,
          reviewScores: parsedReview.scores,
          error: this._buildEnrichedParkingError(`Review retries exhausted. Last feedback:\n${reviewText}`, state.attemptHistory),
          attemptHistory: state.attemptHistory,
          ...(state.didSalvage && { salvaged: true, workBranch })
        }
      };
    }
    // Include structured issues in feedback for implementation retry
    if (parsedReview.structured && parsedReview.issues.length > 0) {
      const issueText = parsedReview.issues
        .map(i => `[${i.severity}] ${i.description}`)
        .join('\n');
      state.reviewFeedback = `${parsedReview.summary || 'Changes requested'}\n\nIssues:\n${issueText}`;
    } else {
      state.reviewFeedback = reviewText;
    }
    state.lastError = null;
    state.attemptHistory.push({ attempt: state.attempt, error: `Review rejected: ${parsedReview.summary || 'changes requested'}`, type: 'review' });
    const reviewReason = parsedReview.summary || 'changes requested';
    await this._emitProgress('retrying_review', requirementId, `Morgan flagged: ${reviewReason}. Fixing...`);
    return { action: 'continue' };
  }

  async _implement(requirementId, changeName, requirement, lastError, reviewFeedback, attempt, attemptHistory) {
    let userPrompt;
    if (reviewFeedback) {
      userPrompt = this.openspec.buildRetryPrompt(
        requirement,
        `Morgan's review feedback:\n${reviewFeedback}`,
        attempt,
        attemptHistory
      );
    } else if (lastError) {
      // Enrich retry prompt when the previous attempt made progress (e.g. timed out while working)
      const lastAttempt = attemptHistory && attemptHistory[attemptHistory.length - 1];
      const progressHint = lastAttempt && lastAttempt.madeProgress
        ? '\n\nThe previous attempt made progress (modified files in the worktree) but ran out of time. Review what exists and continue from where it left off — do not start over.'
        : '';
      userPrompt = this.openspec.buildRetryPrompt(requirement, lastError + progressHint, attempt, attemptHistory);
    } else if (attempt === 1 && this.failureHistory) {
      // Cross-session retry: inject context from the previous session's failure
      let ctx = `Previous session failed this requirement after ${this.failureHistory.attempts} attempt(s) ($${this.failureHistory.costUsd} spent).\nFailure reason: ${this.failureHistory.reason}\n\nApproach this differently — do not repeat the same mistake.`;
      if (this.priorWorkDiff && this.priorWorkDiff.diff) {
        ctx += '\n\n## Prior Work From Previous Session\n'
          + 'The previous agent wrote this code before the session failed due to an '
          + 'infrastructure issue (not a code problem). Use this as your starting point '
          + '— do not rewrite from scratch.\n\n'
          + '### Files Changed\n' + this.priorWorkDiff.diffStat
          + '\n\n### Diff\n```\n' + this.priorWorkDiff.diff + '\n```';
      }
      userPrompt = this.openspec.buildRetryPrompt(requirement, ctx);
    } else {
      userPrompt = this.openspec.buildImplementationPrompt(requirement, null, this.peerContext, this.phaseContext);
    }

    const systemPrompt = await this.templateEngine.renderAgentPrompt(
      this.persona,
      {
        PROJECT_ID: this.projectId,
        PROJECT_DIR: this.workingDir,
        CHANGE_NAME: changeName,
        TECH_STACK: this.techStack,
        DESIGN_SKILLS_SECTION: this._designSkillsSection || ''
      }
    );

    const agentConfig = this.config.agents['implementation'];

    await this.logger.log('info', 'agent_started', {
      agent: this.persona,
      persona: this.personaName,
      requirementId,
      attempt
    });

    const result = await this.agentRunner.runAgent({
      systemPrompt,
      userPrompt,
      workingDir: this.workingDir,
      model: agentConfig.model,
      maxBudgetUsd: agentConfig.maxBudgetUsd,
      timeoutMs: agentConfig.timeoutMs,
      allowedTools: agentConfig.allowedTools,
      onEvent: this.onEvent
    });

    await this.logger.logAgentRun(this.persona, result);
    return result;
  }

  async _review(requirementId, requirement, diff, diffStat) {
    const systemPrompt = await this.templateEngine.renderAgentPrompt(
      'principal-engineer',
      {
        PROJECT_ID: this.projectId,
        PROJECT_DIR: this.workingDir,
        TECH_STACK: this.techStack,
        DESIGN_SKILLS_SECTION: this._designSkillsSection || ''
      }
    );

    const userPrompt = this.openspec.buildReviewPrompt(requirement, diff, diffStat, this.phaseContext, this._designSkillsSection);
    const agentConfig = this.config.agents['principal-engineer'];

    await this.logger.log('info', 'agent_started', {
      agent: 'principal-engineer',
      requirementId
    });

    const result = await this.agentRunner.runAgent({
      systemPrompt,
      userPrompt,
      workingDir: this.workingDir,
      model: agentConfig.model,
      maxBudgetUsd: agentConfig.maxBudgetUsd,
      timeoutMs: agentConfig.timeoutMs,
      allowedTools: agentConfig.allowedTools,
      onEvent: this.onEvent
    });

    // Parse review output for structured scores
    const reviewText = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output);
    const parsedReview = ReviewParser.parse(reviewText);

    await this.logger.logAgentRun('principal-engineer', result, {
      reviewScores: parsedReview.scores,
      reviewStructured: parsedReview.structured
    });

    return result;
  }

  async _reviewRetry(requirementId, requirement, diff, diffStat) {
    const systemPrompt = await this.templateEngine.renderAgentPrompt(
      'principal-engineer',
      {
        PROJECT_ID: this.projectId,
        PROJECT_DIR: this.workingDir,
        TECH_STACK: this.techStack,
        DESIGN_SKILLS_SECTION: this._designSkillsSection || ''
      }
    );

    const basePrompt = this.openspec.buildReviewPrompt(requirement, diff, diffStat, this.phaseContext, this._designSkillsSection);
    const formatHint = `\n\n## IMPORTANT: Structured Output Required\n` +
      `Your previous review did not include the required JSON scoring block. ` +
      `You MUST end your review with a JSON block in this exact format:\n\n` +
      '```json\n' +
      '{\n' +
      '  "decision": "APPROVE" or "REQUEST_CHANGES",\n' +
      '  "scores": {\n' +
      '    "spec_adherence": 1-5,\n' +
      '    "test_coverage": 1-5,\n' +
      '    "code_quality": 1-5,\n' +
      '    "security": 1-5,\n' +
      '    "simplicity": 1-5\n' +
      '  },\n' +
      '  "summary": "One-line summary",\n' +
      '  "issues": [{ "severity": "critical|major|minor", "description": "..." }]\n' +
      '}\n' +
      '```\n';

    const agentConfig = this.config.agents['principal-engineer'];

    await this.logger.log('info', 'agent_started', {
      agent: 'principal-engineer',
      requirementId,
      retry: true,
      reason: 'unstructured_review'
    });

    const result = await this.agentRunner.runAgent({
      systemPrompt,
      userPrompt: basePrompt + formatHint,
      workingDir: this.workingDir,
      model: agentConfig.model,
      maxBudgetUsd: agentConfig.maxBudgetUsd,
      timeoutMs: agentConfig.timeoutMs,
      allowedTools: agentConfig.allowedTools,
      onEvent: this.onEvent
    });

    const reviewText = typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output);
    const parsedReview = ReviewParser.parse(reviewText);

    await this.logger.logAgentRun('principal-engineer', result, {
      reviewScores: parsedReview.scores,
      reviewStructured: parsedReview.structured,
      retryReason: 'unstructured_review'
    });

    return result;
  }

  async _runTests() {
    try {
      const { stdout, stderr } = await exec('npm', ['test'], {
        cwd: this.workingDir,
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, CI: 'true' }
      });
      return {
        passed: true,
        exitCode: 0,
        output: stdout,
        summary: this._extractTestSummary(stdout)
      };
    } catch (err) {
      return {
        passed: false,
        exitCode: err.code || 1,
        output: (err.stdout || '') + '\n' + (err.stderr || ''),
        summary: this._extractTestSummary((err.stdout || '') + '\n' + (err.stderr || ''))
      };
    }
  }

  _extractTestSummary(output) {
    const lines = output.split('\n');
    const summaryLines = lines.filter(l =>
      l.includes('Tests:') || l.includes('Test Suites:') ||
      l.includes('passing') || l.includes('failing') ||
      l.includes('PASS') || l.includes('FAIL')
    );
    return summaryLines.join('\n') || output.slice(-500);
  }

  async _trySalvage(requirementId) {
    const log = await this.gitOps.getLog(this.workingDir, this.sessionBranch);
    if (!log.trim()) {
      return { salvaged: false };
    }

    const testResult = await this._runTests();
    if (!testResult.passed) {
      return { salvaged: false };
    }

    return { salvaged: true };
  }

  async _verifyImports() {
    const { stdout } = await exec('git', ['diff', '--name-only', this.sessionBranch], {
      cwd: this.workingDir,
      timeout: 10000
    });
    const changedFiles = stdout.trim().split('\n').filter(f => f.trim());
    if (changedFiles.length === 0) return { passed: true, errors: [] };

    return ImportVerifier.verify(changedFiles, this.workingDir);
  }

  async _checkConventions() {
    const fs = require('fs/promises');
    const rules = ConventionChecker.parseRules(this.conventions);
    if (rules.length === 0) return { passed: true, violations: [] };

    // Get changed files from diff
    const { stdout } = await exec('git', ['diff', '--name-only', this.sessionBranch], {
      cwd: this.workingDir,
      timeout: 10000
    });
    const changedFiles = stdout.trim().split('\n').filter(f => f.trim());
    if (changedFiles.length === 0) return { passed: true, violations: [] };

    // Read changed file contents
    const fileContents = new Map();
    for (const filePath of changedFiles) {
      try {
        const fullPath = path.join(this.workingDir, filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        fileContents.set(filePath, content);
      } catch {
        // File might have been deleted — skip
      }
    }

    return ConventionChecker.check(changedFiles, fileContents, rules);
  }

  _analyzeFailurePattern(attemptHistory) {
    if (!attemptHistory || attemptHistory.length === 0) return '';
    const types = attemptHistory.map(h => h.type);
    const uniqueTypes = [...new Set(types)];
    const errors = attemptHistory.map(h => {
      // Extract error "category" — first word that looks like an error type
      const match = h.error.match(/^(\w+Error|Tests failed|Review rejected|No code changes)/);
      return match ? match[1] : h.error.slice(0, 30);
    });
    const uniqueErrors = [...new Set(errors)];

    const n = attemptHistory.length;

    // Include stall vs progress breakdown when madeProgress data is available
    const withProgress = attemptHistory.filter(h => h.madeProgress !== undefined);
    let progressNote = '';
    if (withProgress.length > 0) {
      const progressCount = withProgress.filter(h => h.madeProgress).length;
      const stallCount = withProgress.filter(h => !h.madeProgress).length;
      if (progressCount > 0 && stallCount > 0) {
        progressNote = ` ${progressCount} of ${withProgress.length} attempts made progress but timed out; ${stallCount} stalled with no file changes.`;
      } else if (progressCount > 0) {
        progressNote = ` All ${progressCount} attempts made progress but timed out.`;
      } else {
        progressNote = ` All ${stallCount} attempts stalled with no file changes.`;
      }
    }

    if (uniqueErrors.length === 1) {
      return `All ${n} attempts failed with similar errors (${uniqueErrors[0]}).${progressNote} This likely indicates a systemic issue rather than an implementation bug.`;
    }
    return `Attempts showed different failure modes (${uniqueErrors.join(', ')}) -- no consistent pattern.${progressNote}`;
  }

  _buildEnrichedParkingError(baseError, attemptHistory) {
    const pattern = this._analyzeFailurePattern(attemptHistory);
    if (!pattern) return baseError;
    return `${baseError}\n\nFailure pattern: ${pattern}`;
  }

  async _emitProgress(phase, requirementId, thought) {
    await this.logger.log('info', 'microcycle_progress', {
      phase,
      requirementId,
      persona: this.personaName,
      thought
    });
  }

  async _snapshotWorktree() {
    try {
      const { stdout: head } = await this.gitOps._git(this.workingDir, ['rev-parse', 'HEAD']);
      const { stdout: status } = await this.gitOps._git(this.workingDir, ['status', '--porcelain']);
      const { stdout: diffStat } = await this.gitOps._git(this.workingDir, ['diff', '--stat']);
      return { head: head.trim(), status: status.trim(), diffStat: diffStat.trim() };
    } catch {
      return { head: '', status: '', diffStat: '' };
    }
  }

  _didMakeProgress(before, after) {
    return before.head !== after.head || before.status !== after.status || before.diffStat !== after.diffStat;
  }

  async _returnToSession() {
    try {
      await this.gitOps.checkoutBranch(this.workingDir, this.sessionBranch);
    } catch {
      // Best effort — worktree might be removed by caller
    }
  }
}

module.exports = { Microcycle };
