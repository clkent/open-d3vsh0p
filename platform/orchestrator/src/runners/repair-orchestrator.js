const path = require('path');
const { execFile: execFileAsync } = require('../infra/exec-utils');
const { AgentSession } = require('../agents/agent-session');

class RepairOrchestrator {
  constructor(orchestrator) {
    this.o = orchestrator;
  }

  /**
   * Handle the blocking-park fix flow:
   * 1. Transition to BLOCKING_FIX
   * 2. Consolidate completed work to session branch
   * 3. Attempt Morgan auto-fix
   * 4. Auto-restart on success, pair-mode fallback on failure
   */
  async handleBlockingFix(blockingItem) {
    await this.o.stateMachine.transition('BLOCKING_FIX', {
      consumption: this.o.monitor.getStateForPersistence()
    });

    await this.o.logger.log('info', 'blocking_fix_started', { blockingItem });

    // Step 1: Consolidate completed work to main
    const state = this.o.stateMachine.getState();
    if (state.requirements.completed.length > 0) {
      try {
        await this.o.gitOps.consolidateToMain(
          this.o.cliOptions.projectDir,
          state.sessionBranch,
          {
            projectId: state.projectId,
            completed: state.requirements.completed,
            parked: state.requirements.parked || [],
          }
        );
        await this.o.logger.log('info', 'blocking_fix_consolidated', {
          completedCount: state.requirements.completed.length
        });
      } catch (err) {
        await this.o.logger.log('error', 'blocking_fix_consolidation_failed', {
          error: err.message
        });
        return this.blockingFixPairFallback(blockingItem);
      }
    }

    // Step 2: Attempt Morgan auto-fix
    const fixResult = await this.attemptMorganFix(blockingItem);

    if (fixResult.success) {
      await this.o.logger.log('info', 'blocking_fix_morgan_success', { blockingItem });
      return { restart: true };
    }

    // Step 3: Morgan failed — pair-mode fallback
    return this.blockingFixPairFallback(blockingItem);
  }

  /**
   * Attempt an automated fix via Morgan (principal engineer).
   */
  async attemptMorganFix(blockingItem) {
    const agentSession = AgentSession.createMorganSession(this.o);

    try {
      let requirementSpec = '';
      try {
        const req = await this.o.openspec.getRequirementById(blockingItem.id);
        if (req) {
          requirementSpec = `\n## Requirement Spec\n- ID: ${req.id}\n- Name: ${req.name}\n- Details: ${req.bullets ? req.bullets.join(', ') : 'N/A'}`;
        }
      } catch (err) { await this.o.logger.log('debug', 'requirement_spec_lookup_failed', { id: blockingItem.id, error: err.message }); }

      const fixPrompt = `A blocking issue was detected that is preventing other work from proceeding.

## Blocking Item
- ID: ${blockingItem.id}
- Error: ${blockingItem.error || 'Unknown error'}
${requirementSpec}

## Your Task
Diagnose and fix the root cause of this failure. The fix should allow this requirement (and dependent requirements) to succeed on the next attempt.

After making your fix, run the project's test suite to verify nothing is broken.`;

      const onEvent = this.o._createAgentOnEvent('Morgan', blockingItem.id, 'blocking-fix');

      const result = await agentSession.chat(fixPrompt, {
        systemPromptTemplate: 'principal-engineer',
        promptFile: 'blocking-fix-prompt.md',
        templateVars: {
          PROJECT_ID: this.o.cliOptions.projectId,
          PROJECT_DIR: this.o.cliOptions.projectDir,
          TECH_STACK: this.o._techStack || 'Not specified',
          GITHUB_REPO: this.o.cliOptions.githubRepo || '',
          BLOCKING_ITEM_ID: blockingItem.id,
          BLOCKING_ERROR: blockingItem.error || 'Unknown error'
        },
        onEvent
      });

      this.o.monitor.recordInvocation(result.cost || 0, 0);

      if (!result.success) {
        await this.o.logger.log('warn', 'morgan_fix_agent_failed', { error: result.error });
        return { success: false };
      }

      // Check if Morgan identified an environment issue (not fixable via code)
      const envMatch = result.response && result.response.match(/ENVIRONMENT_ISSUE:\s*(.+)/);
      if (envMatch) {
        const envIssue = envMatch[1].trim();
        await this.o.logger.log('warn', 'blocking_fix_environment_issue', { issue: envIssue });
        console.log('');
        console.log('  === Environment Issue Detected ===');
        console.log(`  Morgan identified a system-level issue (not fixable via code changes):`);
        console.log(`    ${envIssue}`);
        console.log('');
        // Revert any speculative changes
        try {
          await this.o.gitOps._git(this.o.cliOptions.projectDir, ['checkout', '.']);
          await this.o.gitOps._git(this.o.cliOptions.projectDir, ['clean', '-fd']);
        } catch (err) { await this.o.logger.log('debug', 'env_issue_revert_failed', { error: err.message }); }
        return { success: false, environmentIssue: envIssue };
      }

      // Run test suite to verify the fix
      try {
        await execFileAsync('npm', ['test'], {
          cwd: this.o.cliOptions.projectDir,
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024
        });
      } catch (testErr) {
        await this.o.logger.log('warn', 'morgan_fix_tests_failed', {
          error: testErr.message
        });
        // Discard Morgan's changes
        try {
          await this.o.gitOps._git(this.o.cliOptions.projectDir, ['checkout', '.']);
          await this.o.gitOps._git(this.o.cliOptions.projectDir, ['clean', '-fd']);
        } catch (err) { await this.o.logger.log('debug', 'morgan_fix_revert_failed', { error: err.message }); }
        return { success: false };
      }

      // Tests passed — commit Morgan's fix to the session branch
      await this.o.gitOps.commitAll(
        this.o.cliOptions.projectDir,
        `fix: Morgan auto-fix for blocking item ${blockingItem.id}`
      );

      return { success: true };
    } catch (err) {
      await this.o.logger.log('error', 'morgan_fix_error', { error: err.message });
      return { success: false };
    }
  }

  /**
   * Fall back to pair mode when Morgan can't auto-fix.
   */
  async blockingFixPairFallback(blockingItem) {
    await this.o.logger.log('info', 'blocking_fix_pair_fallback', { blockingItem });

    console.log('');
    console.log('  === Blocking Issue Detected ===');
    console.log(`  Item: ${blockingItem.id}`);
    console.log(`  Error: ${blockingItem.error || 'Unknown'}`);
    console.log('');
    console.log('  Morgan could not auto-fix this issue.');
    console.log('  Dropping into pair mode so you can fix it together.');
    console.log('');

    try {
      const { pairCommand } = require('../commands/pair');
      await pairCommand(
        { name: this.o.cliOptions.projectId, id: this.o.cliOptions.projectId },
        { ...this.o.cliOptions, resume: false }
      );
    } catch (err) {
      await this.o.logger.log('error', 'pair_fallback_error', { error: err.message });
    }

    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
      rl.question('\n  Fix applied. Restart orchestrator? (y/n) ', (answer) => {
        rl.close();
        if (answer.trim().toLowerCase() === 'y') {
          resolve({ restart: true });
        } else {
          resolve(undefined);
        }
      });
    });
  }

  /**
   * Lightweight diagnostic fix: Morgan fixes a specific issue on the session branch.
   */
  async runDiagnosticFix(failureContext) {
    const agentSession = AgentSession.createMorganSession(this.o);

    const onEvent = this.o._createAgentOnEvent('Morgan', 'integration-fix', 'diagnostic');

    const result = await agentSession.chat(
      `An integration test failure was detected:\n\n${failureContext}\n\nDiagnose and fix the root cause. Run the test suite after to verify.`,
      {
        systemPromptTemplate: 'principal-engineer',
        templateVars: {
          PROJECT_ID: this.o.cliOptions.projectId,
          PROJECT_DIR: this.o.cliOptions.projectDir,
          TECH_STACK: this.o._techStack || 'Not specified',
          GITHUB_REPO: this.o.cliOptions.githubRepo || ''
        },
        onEvent
      }
    );

    this.o.monitor.recordInvocation(result.cost || 0, 0);

    if (!result.success) {
      return { success: false };
    }

    // Commit the fix
    try {
      await this.o.gitOps.commitAll(
        this.o.cliOptions.projectDir,
        'fix: integration test regression (auto-diagnostic)'
      );
    } catch (err) {
      await this.o.logger.log('debug', 'diagnostic_fix_commit_skipped', { error: err.message });
    }

    return { success: true };
  }

  /**
   * Run project diagnostic for a stuck phase via Morgan.
   */
  async runProjectDiagnostic(phase) {
    const phaseKey = `Phase ${phase.number}`;

    if (this.o._diagnosticAttempted.has(phaseKey)) {
      return { success: false, skipped: true };
    }
    this.o._diagnosticAttempted.add(phaseKey);

    const state = this.o.stateMachine.getState();
    const failureReasons = state.requirements.parked
      .filter(p => p.reason)
      .map(p => `- ${p.id}: ${p.reason}`)
      .join('\n') || 'No specific failure reasons recorded.';

    await this.o.logger.log('info', 'diagnostic_started', {
      phase: phaseKey,
      failureReasons
    });

    const fs = require('fs/promises');
    const promptPath = path.join(
      this.o.cliOptions.templatesDir, 'principal-engineer', 'diagnostic-prompt.md'
    );
    let systemPrompt = await fs.readFile(promptPath, 'utf-8');

    systemPrompt = await this.o.templateEngine._resolvePartials(systemPrompt);

    systemPrompt = this.o.templateEngine.renderString(systemPrompt, {
      PROJECT_DIR: this.o.cliOptions.projectDir,
      TECH_STACK: this.o._techStack || 'Not specified',
      FAILURE_CONTEXT: failureReasons
    });

    const agentConfig = this.o.config.agents.diagnostic;

    const onEvent = this.o._createAgentOnEvent('Morgan', 'diagnostic', 'repair');

    const result = await this.o.agentRunner.runAgent({
      systemPrompt,
      userPrompt: 'Diagnose and fix the systemic issues blocking this project. Follow the mission outlined in your system prompt.',
      workingDir: this.o.cliOptions.projectDir,
      model: agentConfig.model,
      maxBudgetUsd: agentConfig.maxBudgetUsd,
      timeoutMs: agentConfig.timeoutMs,
      allowedTools: agentConfig.allowedTools,
      onEvent
    });

    this.o.monitor.recordInvocation(result.cost || 0, result.duration || 0);

    return result;
  }
}

module.exports = { RepairOrchestrator };
