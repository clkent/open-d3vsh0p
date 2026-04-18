const path = require('path');
const healthChecker = require('./health-checker');
const { AgentSession } = require('../agents/agent-session');

const STDERR_TRUNCATE_LIMIT = 2000;
const SMOKE_TEST_TIMEOUT_MS = 120000;
const HEALTH_OUTPUT_TRUNCATE_LIMIT = 5000;
const FAILURE_OUTPUT_TRUNCATE_LIMIT = 3000;

class HealthGate {
  constructor(orchestrator) {
    this.o = orchestrator;
  }

  /**
   * Run the health check gate. Returns true if healthy, false if repair failed.
   */
  async runHealthCheckGate() {
    const hcConfig = await healthChecker.resolveHealthCheckConfig(
      this.o.cliOptions.projectDir,
      this.o.config
    );

    if (hcConfig.commands.length === 0) {
      await this.o.logger.log('info', 'health_check_skipped', {
        reason: 'No health check commands configured or detected'
      });
      return true;
    }

    await this.o.logger.log('info', 'health_check_started', {
      commands: hcConfig.commands
    });

    const result = await healthChecker.runHealthCheck(this.o.cliOptions.projectDir, hcConfig);

    if (result.passed) {
      await this.o.logger.log('info', 'health_check_passed', {
        commandCount: result.results.length
      });
      return true;
    }

    await this.o.logger.log('warn', 'health_check_failed', {
      results: result.results.map(r => ({
        command: r.command,
        exitCode: r.exitCode,
        stderr: r.stderr.slice(0, STDERR_TRUNCATE_LIMIT)
      }))
    });

    // Transition to PROJECT_REPAIR and attempt repair
    await this.o.stateMachine.transition('PROJECT_REPAIR', {
      consumption: this.o.monitor.getStateForPersistence()
    });

    return this.handleProjectRepair(result);
  }

  /**
   * Attempt to repair a failing project baseline via Morgan.
   */
  async handleProjectRepair(healthCheckResult) {
    await this.o.logger.log('info', 'project_repair_started');

    const agentSession = AgentSession.createMorganSession(this.o);

    const healthCheckOutput = healthCheckResult.results
      .filter(r => r.exitCode !== 0)
      .map(r => {
        const output = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
        return `### \`${r.command}\` (exit code ${r.exitCode})\n\`\`\`\n${output.slice(0, HEALTH_OUTPUT_TRUNCATE_LIMIT)}\n\`\`\``;
      })
      .join('\n\n');

    const conventionsText = this.o._conventions
      || 'No project conventions file found. Follow patterns in existing code.';

    try {
      const onEvent = this.o._createAgentOnEvent('Morgan', 'project-repair', 'repair');

      const result = await agentSession.chat(
        'Diagnose and fix the baseline failures described in your system prompt. The orchestrator will re-run the health checks after you finish.',
        {
          systemPromptTemplate: 'principal-engineer',
          promptFile: 'project-repair-prompt.md',
          templateVars: {
            PROJECT_ID: this.o.cliOptions.projectId,
            PROJECT_DIR: this.o.cliOptions.projectDir,
            TECH_STACK: this.o._techStack || 'Not specified',
            HEALTH_CHECK_OUTPUT: healthCheckOutput,
            PROJECT_CONVENTIONS: conventionsText
          },
          onEvent
        }
      );

      this.o.monitor.recordInvocation(result.cost || 0, 0);

      if (!result.success) {
        await this.o.logger.log('warn', 'project_repair_agent_failed', {
          error: result.error || 'Agent returned unsuccessful result'
        });
        return this.projectRepairPairFallback(healthCheckResult);
      }

      // Check if Morgan identified an environment issue (not fixable via code)
      const envIssue = this._parseEnvironmentIssue(result.response);
      if (envIssue) {
        await this.o.logger.log('warn', 'project_repair_environment_issue', {
          issue: envIssue
        });
        // Revert any speculative changes Morgan may have made
        try {
          await this.o.gitOps._git(this.o.cliOptions.projectDir, ['checkout', '.']);
          await this.o.gitOps._git(this.o.cliOptions.projectDir, ['clean', '-fd']);
        } catch (err) { await this.o.logger.log('debug', 'repair_revert_failed', { error: err.message }); }

        return this._environmentIssueFallback(envIssue, healthCheckResult);
      }

      // Re-run health check to verify Morgan's fix
      const hcConfig = await healthChecker.resolveHealthCheckConfig(
        this.o.cliOptions.projectDir,
        this.o.config
      );
      const recheck = await healthChecker.runHealthCheck(this.o.cliOptions.projectDir, hcConfig);

      if (recheck.passed) {
        await this.o.gitOps.commitAll(
          this.o.cliOptions.projectDir,
          'fix: Morgan project repair — baseline health check restored'
        );

        await this.o.logger.log('info', 'project_repair_succeeded');

        await this.o.stateMachine.transition('SELECTING_REQUIREMENT', {
          consumption: this.o.monitor.getStateForPersistence()
        });
        return true;
      }

      await this.o.logger.log('warn', 'project_repair_recheck_failed', {
        results: recheck.results.map(r => ({
          command: r.command,
          exitCode: r.exitCode,
          stderr: r.stderr.slice(0, STDERR_TRUNCATE_LIMIT)
        }))
      });

      try {
        await this.o.gitOps._git(this.o.cliOptions.projectDir, ['checkout', '.']);
        await this.o.gitOps._git(this.o.cliOptions.projectDir, ['clean', '-fd']);
      } catch (err) { await this.o.logger.log('debug', 'repair_revert_failed', { error: err.message }); }

      return this.projectRepairPairFallback(recheck);
    } catch (err) {
      await this.o.logger.log('error', 'project_repair_error', { error: err.message });
      return this.projectRepairPairFallback(healthCheckResult);
    }
  }

  /**
   * Fall back to pair mode when Morgan can't repair the project baseline.
   */
  async projectRepairPairFallback(healthCheckResult) {
    await this.o.logger.log('info', 'project_repair_pair_fallback');

    console.log('');
    console.log('  === Project Health Check Failed ===');
    console.log('');
    for (const r of healthCheckResult.results) {
      if (r.exitCode !== 0) {
        console.log(`  Command: ${r.command}`);
        console.log(`  Exit code: ${r.exitCode}`);
        if (r.stderr) {
          console.log(`  Error output (last 500 chars):`);
          console.log(`    ${r.stderr.slice(-500).replace(/\n/g, '\n    ')}`);
        }
        console.log('');
      }
    }
    console.log('  Morgan could not auto-fix these baseline failures.');
    console.log('  Dropping into pair mode so you can fix them together.');
    console.log('');

    try {
      const { pairCommand } = require('../commands/pair');
      await pairCommand(
        { name: this.o.cliOptions.projectId, id: this.o.cliOptions.projectId },
        { ...this.o.cliOptions, resume: false }
      );
    } catch (err) {
      await this.o.logger.log('error', 'project_repair_pair_error', { error: err.message });
    }

    // Re-run health check after pair session
    const hcConfig = await healthChecker.resolveHealthCheckConfig(
      this.o.cliOptions.projectDir,
      this.o.config
    );
    const recheck = await healthChecker.runHealthCheck(this.o.cliOptions.projectDir, hcConfig);

    if (recheck.passed) {
      await this.o.logger.log('info', 'project_repair_succeeded', {
        method: 'pair_mode'
      });
      await this.o.stateMachine.transition('SELECTING_REQUIREMENT', {
        consumption: this.o.monitor.getStateForPersistence()
      });
      return true;
    }

    await this.o.logger.log('error', 'project_repair_failed', {
      message: 'Health check still failing after pair mode'
    });
    await this.o._completeSession();
    return false;
  }

  /**
   * Parse Morgan's response for an ENVIRONMENT_ISSUE marker.
   * Returns the issue description string if found, or null.
   */
  _parseEnvironmentIssue(response) {
    if (!response) return null;
    const match = response.match(/ENVIRONMENT_ISSUE:\s*(.+)/);
    return match ? match[1].trim() : null;
  }

  /**
   * Handle an environment issue that Morgan identified but cannot fix via code.
   * Surfaces the diagnosis clearly to the user before dropping into pair mode.
   */
  async _environmentIssueFallback(envIssue, healthCheckResult) {
    console.log('');
    console.log('  === Environment Issue Detected ===');
    console.log('');
    console.log(`  Morgan identified a system-level issue (not fixable via code changes):`);
    console.log('');
    console.log(`    ${envIssue}`);
    console.log('');
    console.log('  Dropping into pair mode so you can resolve this together.');
    console.log('');

    return this.projectRepairPairFallback(healthCheckResult);
  }

  /**
   * Phase gate: full health check after all groups complete. Non-blocking.
   */
  async runPhaseGate(phase) {
    const projectDir = this.o.cliOptions.projectDir;
    const hcConfig = await healthChecker.resolveHealthCheckConfig(projectDir, this.o.config);

    if (hcConfig.commands.length === 0) {
      return { passed: true };
    }

    await this.o.logger.log('info', 'phase_gate_started', {
      phase: `Phase ${phase.number}: ${phase.label}`,
      commands: hcConfig.commands
    });

    const result = await healthChecker.runHealthCheck(projectDir, hcConfig);

    if (result.passed) {
      await this.o.logger.log('info', 'phase_gate_passed', {
        phase: `Phase ${phase.number}: ${phase.label}`
      });
      return { passed: true };
    }

    await this.o.logger.log('warn', 'phase_gate_failed', {
      phase: `Phase ${phase.number}: ${phase.label}`,
      results: result.results.map(r => ({
        command: r.command,
        exitCode: r.exitCode,
        stderr: r.stderr.slice(0, STDERR_TRUNCATE_LIMIT)
      }))
    });

    // Attempt diagnostic fix
    const diagResult = await this.o.repair.runProjectDiagnostic(phase);
    if (diagResult.success) {
      const retryResult = await healthChecker.runHealthCheck(projectDir, hcConfig);
      if (retryResult.passed) {
        await this.o.logger.log('info', 'phase_gate_fixed', {
          phase: `Phase ${phase.number}: ${phase.label}`
        });
        return { passed: true };
      }
    }

    await this.o.logger.log('warn', 'phase_gate_proceeding', {
      phase: `Phase ${phase.number}: ${phase.label}`,
      message: 'Phase gate failed but proceeding — triage system will handle blocking analysis'
    });
    return { passed: false };
  }

  /**
   * Post-merge smoke test: run tests on the session branch after a merge.
   */
  async runPostMergeSmokeTest(itemId) {
    const projectDir = this.o.cliOptions.projectDir;

    const detected = await healthChecker.detectHealthCheckCommands(projectDir);
    const testCommands = detected.filter(c => !c.includes('build'));
    if (testCommands.length === 0) {
      return { passed: true };
    }

    await this.o.logger.log('info', 'post_merge_smoke_started', {
      requirementId: itemId,
      commands: testCommands
    });

    const result = await healthChecker.runHealthCheck(projectDir, {
      commands: testCommands,
      timeoutMs: SMOKE_TEST_TIMEOUT_MS
    });

    if (result.passed) {
      await this.o.logger.log('info', 'post_merge_smoke_passed', { requirementId: itemId });
      return { passed: true };
    }

    await this.o.logger.log('warn', 'post_merge_smoke_failed', {
      requirementId: itemId,
      results: result.results.map(r => ({
        command: r.command,
        exitCode: r.exitCode,
        stderr: r.stderr.slice(0, STDERR_TRUNCATE_LIMIT)
      }))
    });

    // Attempt Morgan diagnostic fix
    try {
      const failureOutput = result.results
        .filter(r => r.exitCode !== 0)
        .map(r => `$ ${r.command}\n${r.stderr || r.stdout}`)
        .join('\n\n')
        .slice(0, FAILURE_OUTPUT_TRUNCATE_LIMIT);

      const diagnosticResult = await this.o.repair.runDiagnosticFix(
        `Post-merge smoke test failed after merging "${itemId}". Test output:\n\n${failureOutput}`
      );

      if (diagnosticResult.success) {
        const retryResult = await healthChecker.runHealthCheck(projectDir, {
          commands: testCommands,
          timeoutMs: SMOKE_TEST_TIMEOUT_MS
        });
        if (retryResult.passed) {
          await this.o.logger.log('info', 'post_merge_smoke_fixed', { requirementId: itemId });
          return { passed: true };
        }
      }
    } catch (err) {
      await this.o.logger.log('warn', 'post_merge_smoke_fix_error', { error: err.message });
    }

    return {
      passed: false,
      error: `post-merge regression: tests failed after merging ${itemId}`
    };
  }

  /**
   * Architecture validation check.
   */
  async runArchitectureCheck() {
    if (this.o._architectureCheckDone) return;
    this.o._architectureCheckDone = true;

    if (!this.o._techStack || this.o._techStack === 'Not specified') return;

    try {
      const dirListing = this.o._getProjectListing();

      const conventionsText = this.o._conventions
        || 'No project conventions file found. Follow patterns in existing code.';

      const systemPrompt = await this.o.templateEngine.renderAgentPrompt(
        'principal-engineer',
        {
          PROJECT_ID: this.o.cliOptions.projectId,
          PROJECT_DIR: this.o.cliOptions.projectDir,
          TECH_STACK: this.o._techStack,
          PROJECT_CONVENTIONS: conventionsText
        }
      );

      const userPrompt = `## Architecture Validation Check

You are performing a one-time architecture validation. Verify that the project's file structure and setup match the specified tech stack.

**Tech Stack:** ${this.o._techStack}

**Project Files:**
\`\`\`
${dirListing}
\`\`\`

Check whether the project is using the correct frameworks and libraries as specified in the tech stack. Focus on:
- Are the right framework files present (e.g., next.config.js for Next.js, manage.py for Django)?
- Does package.json/requirements.txt reference the correct framework?
- Is the directory structure consistent with the specified framework?

Respond with your standard JSON review format. Use APPROVE if the architecture matches, or REQUEST_CHANGES if there is a framework/architecture mismatch.`;

      const agentConfig = this.o.config.agents['principal-engineer'];

      const result = await this.o.agentRunner.runAgent({
        systemPrompt,
        userPrompt,
        workingDir: this.o.cliOptions.projectDir,
        model: agentConfig.model,
        maxBudgetUsd: Math.min(agentConfig.maxBudgetUsd, 1.00),
        timeoutMs: agentConfig.timeoutMs,
        allowedTools: agentConfig.allowedTools
      });

      this.o.monitor.recordInvocation(result.cost || 0, result.duration || 0);

      if (!result.success) {
        await this.o.logger.log('warn', 'architecture_check_failed', {
          error: result.error || 'Agent returned unsuccessful result'
        });
        return;
      }

      const { ReviewParser } = require('./review-parser');
      const parsed = ReviewParser.parse(result.output);

      if (parsed.decision === 'APPROVE') {
        await this.o.logger.log('info', 'architecture_validated', {
          summary: parsed.summary || 'Architecture matches tech stack'
        });
      } else {
        await this.o.logger.log('warn', 'architecture_mismatch', {
          summary: parsed.summary || 'Architecture may not match tech stack',
          issues: parsed.issues || []
        });
      }
    } catch (err) {
      await this.o.logger.log('warn', 'architecture_check_error', {
        error: err.message
      });
    }
  }

  /**
   * Preview check.
   */
  async runPreviewCheck() {
    const { checkPreview } = require('./preview-checker');
    const previewConfig = this.o.cliOptions.preview;
    if (!previewConfig) return;

    try {
      const result = await checkPreview({
        command: previewConfig.command,
        port: previewConfig.port,
        timeoutSeconds: previewConfig.timeoutSeconds,
        workingDir: this.o.cliOptions.projectDir
      });

      const state = this.o.stateMachine.getState();
      const wasAvailable = state.preview?.available || false;
      const transition = result.available !== wasAvailable;

      await this.o.logger.logPreviewCheck({ ...result, transition });

      if (result.available && !wasAvailable) {
        await this.o.stateMachine.update({
          preview: { available: true, since: new Date().toISOString(), command: previewConfig.command }
        });

        const reqId = this.o._lastMergedRequirementId || 'unknown';
        await this.o.logger.logGoLook({
          requirementId: reqId,
          previewCommand: previewConfig.command,
          previewPort: previewConfig.port,
          message: `${reqId} merged — refresh localhost:${previewConfig.port}`
        });
      } else if (!result.available && wasAvailable) {
        await this.o.stateMachine.update({
          preview: { ...state.preview, available: false }
        });
      }
    } catch (err) {
      await this.o.logger.log('debug', 'preview_check_error', { error: err.message });
    }
  }
}

module.exports = { HealthGate };
