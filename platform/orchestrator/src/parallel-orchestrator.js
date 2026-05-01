const path = require('path');

const SALVAGE_TEST_TIMEOUT_MS = 120000;
const PROGRESS_INTERVAL_MS = 180000;
const MAX_CONSECUTIVE_FAILURES = 3;
const PROJECT_LISTING_LIMIT = 200;
const PROJECT_LISTING_TIMEOUT_MS = 10000;

const INFRA_FAILURE_PATTERNS = [
  /timed?\s*out/i,
  /timeout/i,
  /null bytes/i,
  /maxbuffer/i,
  /STDIO_MAXBUFFER/i,
  /process error/i,
  /process exited/i,
  /SIGTERM/i,
  /SIGKILL/i,
  /phase stuck/i,
  /consecutive failures/i
];

const { generateSessionId } = require('./session/session-utils');
const { getOrchestratorPaths } = require('./session/path-utils');
const { StateMachine } = require('./session/state-machine');
const { Logger } = require('./infra/logger');
const { AgentRunner } = require('./agents/agent-runner');
const { OpenSpecReader } = require('./roadmap/openspec-reader');
const { ConsumptionMonitor } = require('./session/consumption-monitor');
const { TemplateEngine } = require('./agents/template-engine');
const { GitOps } = require('./git/git-ops');
const { RoadmapReader } = require('./roadmap/roadmap-reader');
const { Microcycle } = require('./microcycle');
const { MergeLock } = require('./git/merge-lock');
const { AgentPool } = require('./agents/agent-pool');
const { loadConfig } = require('./infra/config');
const { RecoveryManager } = require('./git/recovery-manager');
const { CostEstimator } = require('./session/cost-estimator');
const { BroadcastServer } = require('./infra/broadcast-server');
const { reconcile } = require('./roadmap/roadmap-reconciler');
const { processReports } = require('./runners/report-processor');
const { HealthGate } = require('./quality/health-gate');
const { RepairOrchestrator } = require('./runners/repair-orchestrator');
const { ItemTriage } = require('./runners/item-triage');
const { RoadmapValidator } = require('./roadmap/roadmap-validator');

class ParallelOrchestrator {
  constructor(cliOptions) {
    this.cliOptions = cliOptions;
    this.config = null;
    this.stateMachine = null;
    this.logger = null;
    this.agentRunner = null;
    this.openspec = null;
    this.monitor = null;
    this.templateEngine = null;
    this.gitOps = null;
    this.roadmapReader = null;
    this.mergeLock = new MergeLock();
    this.agentPool = null;
    this._groupAssignments = new Map();
    this._architectureCheckDone = false;
    this._diagnosticAttempted = new Set();
    this._failureHistory = null;
    this._priorWorkDiffs = null;
    this.broadcastServer = null;
    this.healthGate = new HealthGate(this);
    this.repair = new RepairOrchestrator(this);
    this.triage = new ItemTriage(this);
    this._keypressHandler = null;
    this._ttyStream = null;
    this._ttyFd = null;
  }

  async run() {
    // Load config
    this.config = await loadConfig(this.cliOptions);

    // Initialize agent pool with configured personas
    this.agentPool = new AgentPool(this.config.personas || undefined);

    // Determine paths
    const { stateDir: orchestratorDir, logsDir } = getOrchestratorPaths(this.cliOptions);
    const stateFilePath = path.join(orchestratorDir, 'state.json');

    // Initialize state machine
    this.stateMachine = new StateMachine(stateFilePath);
    const existingState = await this.stateMachine.load();

    // Determine session ID
    let sessionId;
    if (this.cliOptions.resume && existingState && existingState.state !== 'SESSION_COMPLETE') {
      sessionId = existingState.sessionId;
      console.log(`  Resuming session: ${sessionId}`);
      console.log(`  State: ${existingState.state}`);
    } else {
      const now = new Date();
      sessionId = generateSessionId();
    }

    // Initialize modules
    this.logger = new Logger(sessionId, logsDir);
    await this.logger.init();
    this.agentRunner = new AgentRunner(this.logger);
    this.openspec = new OpenSpecReader(this.cliOptions.projectDir);
    this.templateEngine = new TemplateEngine(this.cliOptions.templatesDir);
    this.gitOps = new GitOps(this.logger);
    this.roadmapReader = new RoadmapReader(this.cliOptions.projectDir);

    // Extract diffs from stale work branches BEFORE recovery deletes them
    if (this.cliOptions.fresh && existingState) {
      await this._extractPriorWorkDiffs(existingState);
    }

    // Run recovery to clean up any orphaned resources from previous crashes
    await this._runRecovery(sessionId);

    // Initialize cost estimator from historical data
    this.costEstimator = new CostEstimator(logsDir);
    try {
      await this.costEstimator.init();
    } catch (err) {
      await this.logger.log('debug', 'cost_estimator_init_failed', { error: err.message });
    }

    // On fresh sessions, capture failure history before resetting parked items
    if (this.cliOptions.fresh && existingState && existingState.requirements) {
      const parkedEntries = existingState.requirements.parked || [];
      if (parkedEntries.length > 0) {
        this._failureHistory = new Map();
        for (const entry of parkedEntries) {
          this._failureHistory.set(entry.id, {
            reason: entry.reason || 'Unknown failure',
            attempts: entry.attempts || 1,
            costUsd: entry.costUsd || 0
          });
        }
      }

      const didReset = await this.roadmapReader.resetParkedItems();
      if (didReset) {
        await this.logger.log('info', 'parked_items_reset', {
          reason: '--fresh flag: parked items reset to pending',
          failureHistoryCount: this._failureHistory ? this._failureHistory.size : 0
        });
      }
    } else if (this.cliOptions.fresh) {
      const didReset = await this.roadmapReader.resetParkedItems();
      if (didReset) {
        await this.logger.log('info', 'parked_items_reset', {
          reason: '--fresh flag: parked items reset to pending'
        });
      }
    }

    // Parse roadmap
    let roadmap = await this.roadmapReader.parse();

    // Validate roadmap structure before proceeding
    const validation = RoadmapValidator.validate(roadmap);
    if (validation.warnings.length > 0) {
      for (const w of validation.warnings) {
        console.log(`  ⚠ ${w}`);
      }
    }
    if (!validation.valid) {
      for (const e of validation.errors) {
        console.error(`  ✗ ${e}`);
      }
      await this.logger.log('error', 'roadmap_validation_failed', {
        errors: validation.errors,
        warnings: validation.warnings
      });
      throw new Error(`Roadmap validation failed with ${validation.errors.length} error(s)`);
    }

    await this.logger.log('info', 'roadmap_loaded', {
      title: roadmap.title,
      phases: roadmap.phases.length,
      totalItems: this.roadmapReader.getAllItems(roadmap).length
    });

    // Early exit if all roadmap items are already complete
    if (this.roadmapReader.isComplete(roadmap)) {
      console.log('\n  No pending work — all roadmap items are complete.\n');
      return {
        stopReason: 'no_pending_work',
        completed: [],
        parked: [],
        remaining: [],
        totalCostUsd: 0,
        sessionBranch: null,
        logFile: null
      };
    }

    // Initialize or resume state
    if (!this.cliOptions.resume || !existingState || existingState.state === 'SESSION_COMPLETE') {
      await this.stateMachine.initialize(
        this.cliOptions.projectId,
        this.cliOptions.projectDir,
        sessionId,
        this.config
      );

      // Transition to LOADING_ROADMAP
      const allItems = this.roadmapReader.getAllItems(roadmap);
      const pendingIds = allItems.filter(i => i.status === 'pending').map(i => i.id);

      await this.stateMachine.transition('SELECTING_REQUIREMENT', {
        requirements: { pending: pendingIds, inProgress: null, completed: [], parked: [] },
        targetRequirements: this.cliOptions.requirements || null,
        currentPhase: null,
        activeAgents: []
      });

      await this.logger.log('info', 'session_started', {
        sessionId,
        projectId: this.cliOptions.projectId,
        mode: 'parallel',
        totalRequirements: pendingIds.length
      });

      // Create session branch
      await this.gitOps.createSessionBranch(
        this.cliOptions.projectDir,
        this.stateMachine.getState().sessionBranch
      );

      // Reset parked items AFTER session branch creation, because createSessionBranch
      // does git checkout main && git pull which overwrites any prior file changes.
      if (this.cliOptions.fresh) {
        const didReset = await this.roadmapReader.resetParkedItems();
        if (didReset) {
          // Re-parse roadmap and update state with newly pending items
          const freshRoadmap = await this.roadmapReader.parse();
          const freshItems = this.roadmapReader.getAllItems(freshRoadmap);
          const freshPendingIds = freshItems.filter(i => i.status === 'pending').map(i => i.id);
          await this.stateMachine.update({
            requirements: { pending: freshPendingIds, inProgress: null, completed: [], parked: [] }
          });
          // Commit the roadmap reset to the session branch
          await this.gitOps.commitAll(
            this.cliOptions.projectDir,
            'chore: reset parked items to pending for fresh session'
          );
          await this.logger.log('info', 'parked_items_reset_post_checkout', {
            pendingCount: freshPendingIds.length
          });
        }
      }
    }

    // Ensure tech stack is loaded
    let techStack = 'Not specified';
    try {
      techStack = await this.openspec.parseTechStack();
    } catch (err) {
      await this.logger.log('debug', 'tech_stack_parse_skipped', { error: err.message });
    }
    this._techStack = techStack;

    // Load project conventions (used for mechanical convention checking, not prompt injection)
    let conventions = null;
    try {
      conventions = await this.openspec.parseConventions();
    } catch (err) {
      await this.logger.log('debug', 'conventions_parse_skipped', { error: err.message });
    }
    this._conventions = conventions;

    // Start broadcast server
    const broadcastPort = this.cliOptions.broadcastPort || this.config.broadcastPort || 3100;
    this.broadcastServer = new BroadcastServer();
    try {
      await this.broadcastServer.start(broadcastPort);
      if (this.broadcastServer.isRunning) {
        await this.logger.log('info', 'broadcast_started', { port: broadcastPort });

        // Wire logger → broadcast server (orchestrator events)
        const bsRef = this.broadcastServer;
        const bsSessionId = sessionId;
        this.logger.setBroadcast(({ level, eventType, data }) => {
          bsRef.broadcast({
            source: 'orchestrator',
            sessionId: bsSessionId,
            timestamp: new Date().toISOString(),
            level,
            eventType,
            event: data
          });
        });
      } else {
        await this.logger.log('warn', 'broadcast_port_in_use', { port: broadcastPort });
      }
    } catch (err) {
      await this.logger.log('warn', 'broadcast_start_error', { error: err.message });
    }

    // Initialize consumption monitor
    const state = this.stateMachine.getState();
    this.monitor = new ConsumptionMonitor(this.config, {
      ...state.consumption,
      sessionStartTime: new Date(state.startedAt).getTime()
    });

    // Install signal handlers for graceful pause (Ctrl+C)
    this.monitor.installSignalHandlers();

    // Install keypress listener for pair mode interrupt
    this._installKeypressListener();

    // Health check gate (fresh sessions only)
    if (!this.cliOptions.resume) {
      const healthCheckOk = await this.healthGate.runHealthCheckGate();
      if (!healthCheckOk) {
        // Health check failed and could not be repaired — session ends
        this._removeKeypressListener();
        this.monitor.removeSignalHandlers();
        const failState = this.stateMachine.getState();
        await this._pushSessionBranch('health_check_failed');
        const summaryPath = await this.logger.writeSummary(failState, { humanItems: [] });
        return {
          stopReason: 'health_check_failed',
          completed: failState.requirements.completed,
          parked: failState.requirements.parked,
          remaining: failState.requirements.pending,
          totalCostUsd: this.monitor.totalCostUsd,
          sessionBranch: failState.sessionBranch,
          logFile: summaryPath
        };
      }
    }

    // Session-start reconciliation (fresh sessions only)
    if (!this.cliOptions.resume) {
      try {
        const reconcileResult = await reconcile({
          gitOps: this.gitOps,
          roadmapReader: this.roadmapReader,
          stateMachine: this.stateMachine,
          projectDir: this.cliOptions.projectDir,
          logger: this.logger
        });
        if (reconcileResult.reconciled > 0) {
          await this.logger.log('info', 'roadmap_reconciled', {
            count: reconcileResult.reconciled,
            items: reconcileResult.items
          });
          // Re-parse roadmap since items were marked complete
          roadmap = await this.roadmapReader.parse();
        }
      } catch (err) {
        await this.logger.log('warn', 'roadmap_reconciliation_failed', { error: err.message });
      }
    }

    // On resume, check for resolved interventions (user ran ./devshop action)
    if (this.cliOptions.resume) {
      await this._checkResolvedInterventions();
    }

    // Main phase loop
    const phaseResult = await this._runPhases(roadmap);

    // Remove signal handlers before cleanup
    this.monitor.removeSignalHandlers();

    // If blocking fix triggered a restart, propagate immediately
    if (phaseResult && phaseResult.restart) {
      return { restart: true };
    }

    // Push session branch to GitHub if any work was completed
    const finalState = this.stateMachine.getState();
    await this._pushSessionBranch('session_end');

    // Collect incomplete HUMAN items for surfacing
    const latestRoadmap = await this.roadmapReader.parse();
    const humanItems = this.roadmapReader.getAllItems(latestRoadmap)
      .filter(i => i.isHuman && i.status !== 'complete')
      .map(i => ({ id: i.id, description: i.description, phase: i.phaseNumber, status: i.status }));

    // Write summary
    const summaryPath = await this.logger.writeSummary(finalState, { humanItems });

    await this.logger.log('info', 'session_complete', {
      stopReason: this._getStopReason(finalState),
      ...this.monitor.getSnapshot()
    });

    return {
      stopReason: this._getStopReason(finalState),
      completed: finalState.requirements.completed,
      parked: finalState.requirements.parked,
      remaining: finalState.requirements.pending,
      totalCostUsd: this.monitor.totalCostUsd,
      sessionBranch: finalState.sessionBranch,
      logFile: summaryPath,
      preview: finalState.preview || undefined
    };
  }

  async _runPhases(roadmap) {
    let lastPhaseNumber = null;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = MAX_CONSECUTIVE_FAILURES;

    while (true) {
      // Re-parse roadmap to get latest status
      const current = await this.roadmapReader.parse();

      // Check if all done
      if (this.roadmapReader.isComplete(current)) {
        await this.logger.log('info', 'all_phases_complete');
        await this._completeSession();
        break;
      }

      // Check consumption
      const stopCheck = this.monitor.shouldStop();
      if (stopCheck.stop) {
        await this.logger.log('warn', 'graceful_shutdown', { reason: stopCheck.reason });
        await this._completeSession();
        break;
      }

      // Get next ready phase, considering blocking parked items
      const blockingIds = this._getBlockingIdsFromState();
      const nextPhase = this.roadmapReader.getNextPhase(current, blockingIds);
      if (!nextPhase) {
        if (blockingIds.size > 0) {
          await this.logger.log('info', 'no_ready_phases_blocked', {
            blockingIds: [...blockingIds],
            message: 'All dependent phases blocked by parked items classified as blocking'
          });
        } else {
          await this.logger.log('info', 'no_ready_phases');
        }
        await this._completeSession();
        break;
      }

      // Track consecutive failures on the same phase to prevent infinite loops
      if (nextPhase.number === lastPhaseNumber) {
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          // Try diagnostic before parking
          try {
            const diagResult = await this.repair.runProjectDiagnostic(nextPhase);
            if (diagResult.success) {
              // Commit Morgan's fixes to the session branch
              const state = this.stateMachine.getState();
              await this.gitOps.commitAll(
                this.cliOptions.projectDir,
                `fix: Morgan diagnostic for Phase ${nextPhase.number}`
              );
              await this.logger.log('info', 'diagnostic_fixed', {
                phase: `Phase ${nextPhase.number}: ${nextPhase.label}`
              });
              consecutiveFailures = 0;
              continue;
            }
            if (!diagResult.skipped) {
              await this.logger.log('warn', 'diagnostic_failed', {
                phase: `Phase ${nextPhase.number}: ${nextPhase.label}`,
                error: diagResult.error || 'Diagnostic agent returned unsuccessful result'
              });
            }
          } catch (err) {
            await this.logger.log('warn', 'diagnostic_failed', {
              phase: `Phase ${nextPhase.number}: ${nextPhase.label}`,
              error: err.message
            });
          }

          await this.logger.log('error', 'phase_stuck', {
            phase: `Phase ${nextPhase.number}: ${nextPhase.label}`,
            consecutiveFailures
          });
          // Park all pending items in this phase
          for (const group of nextPhase.groups) {
            for (const item of group.items) {
              if (item.status === 'pending') {
                await this.triage.parkItem(item.id, {
                  reason: `Phase stuck after ${maxConsecutiveFailures} consecutive failures`
                });
              }
            }
          }
          lastPhaseNumber = null;
          consecutiveFailures = 0;
          continue;
        }
      } else {
        lastPhaseNumber = nextPhase.number;
        consecutiveFailures = 0;
      }

      await this.logger.log('info', 'phase_started', {
        phase: `Phase ${nextPhase.number}: ${nextPhase.label}`
      });

      await this.stateMachine.update({
        currentPhase: `Phase ${nextPhase.number}: ${nextPhase.label}`
      });

      // Pre-phase budget check
      await this._checkPhaseBudget(nextPhase);

      // Execute all groups in this phase in parallel
      await this._executePhase(nextPhase);

      // Check if this was a spike-only phase — auto-pause for human review
      const latestForSpikeCheck = await this.roadmapReader.parse();
      const spikeCheckPhase = latestForSpikeCheck.phases.find(p => p.number === nextPhase.number);
      if (spikeCheckPhase && this.roadmapReader.isSpikePhase(spikeCheckPhase)) {
        await this.logger.log('info', 'spike_phase_complete', {
          phase: `Phase ${nextPhase.number}: ${nextPhase.label}`
        });

        // Push session branch so findings are visible on GitHub
        await this._pushSessionBranch('spike_phase');

        // Print spike findings paths to console
        const spikeFindings = spikeCheckPhase.groups
          .flatMap(g => g.items)
          .filter(i => i.isSpike && i.status === 'complete')
          .map(i => `  openspec/spikes/${i.id}/findings.md`);
        if (spikeFindings.length > 0) {
          console.log('\n  === Spike Phase Complete ===');
          console.log('  Review findings before continuing:\n');
          for (const f of spikeFindings) console.log(f);
          console.log('\n  Resume with: ./devshop run ' + this.cliOptions.projectId + ' --resume\n');
        }

        this._spikeReviewPending = true;
        await this._completeSession();
        break;
      }

      // Check if a blocking park triggered a stop
      const stopAfterPhase = this.monitor.shouldStop();
      if (stopAfterPhase.stop && stopAfterPhase.reason === 'blocking_park') {
        await this.logger.log('warn', 'blocking_park_entering_fix', {
          blockingItem: stopAfterPhase.blockingItem
        });

        // Clean up keypress listener before pair fallback may spawn
        this._removeKeypressListener();

        // Push completed work before entering fix flow
        await this._pushSessionBranch('blocking_park');

        // Enter blocking-fix flow
        const fixResult = await this.repair.handleBlockingFix(stopAfterPhase.blockingItem);
        if (fixResult && fixResult.restart) {
          return fixResult; // propagate restart signal
        }
        // If no restart, session ends
        await this._completeSession();
        return;
      }

      // Check if user requested pair mode
      if (stopAfterPhase.stop && stopAfterPhase.reason === 'pause_for_pair') {
        await this._handlePairInterrupt();
        continue; // Re-enter phase loop — roadmap re-read happens at top
      }

      // Phase gate: run integration health check if any items merged in this phase
      const phaseState = this.stateMachine.getState();
      const phaseItemIds = new Set();
      for (const g of nextPhase.groups) {
        for (const it of g.items) phaseItemIds.add(it.id);
      }
      const mergedInPhase = (phaseState.requirements.completed || [])
        .some(id => phaseItemIds.has(id));
      if (mergedInPhase) {
        await this.healthGate.runPhaseGate(nextPhase);
      }

      await this.logger.log('info', 'phase_complete', {
        phase: `Phase ${nextPhase.number}: ${nextPhase.label}`
      });

      // Push session branch after each phase so progress is visible on GitHub
      await this._pushSessionBranch('phase_end');

      // Process user-reported issues between phases (safe point — no agents running)
      await this._processReportQueue();

      // Triage parked items if any exist and dependent phases remain
      const parkedInPhase = this.roadmapReader.getParkedItemsInPhase(
        (await this.roadmapReader.parse()).phases.find(p => p.number === nextPhase.number) || nextPhase
      );
      if (parkedInPhase.length > 0) {
        // Check if there are downstream phases that depend on this one
        const latestRoadmap = await this.roadmapReader.parse();
        const dependentPhases = latestRoadmap.phases.filter(
          p => p.depends && p.depends.includes(nextPhase.number)
        );
        if (dependentPhases.length > 0) {
          // Gather all items from dependent phases for triage context
          const nextPhaseItems = [];
          for (const dep of dependentPhases) {
            for (const group of dep.groups) {
              for (const item of group.items) {
                nextPhaseItems.push(item);
              }
            }
          }
          await this.triage.triageParkedItems(
            latestRoadmap.phases.find(p => p.number === nextPhase.number) || nextPhase,
            nextPhaseItems
          );
        }
      }
    }
  }

  async _executePhase(phase) {
    // Ensure .worktrees is in .gitignore before creating any worktrees
    await this.gitOps.ensureWorktreeIgnored(this.cliOptions.projectDir);

    // Auto-park [HUMAN] items before running groups — no agent budget wasted
    // Group Z items (user testing checkpoints) are non_blocking — orchestrator continues past them
    // All other HUMAN items are blocking — orchestrator waits for human completion
    for (const group of phase.groups) {
      for (const item of group.items) {
        if (item.status === 'pending' && item.isHuman) {
          const isGroupZ = group.letter === 'Z';
          const classification = isGroupZ ? 'non_blocking' : 'blocking';
          await this.triage.parkItem(item.id, {
            reason: '[HUMAN] tagged — requires manual intervention',
            triageClassification: classification,
            triageReason: isGroupZ
              ? '[HUMAN] checkpoint in Group Z — non-blocking'
              : '[HUMAN] prerequisite — blocks dependent phases until completed'
          });
          item.status = 'parked';

          await this.logger.log('info', 'human_item_auto_parked', {
            requirementId: item.id,
            description: item.description,
            classification
          });
        }
      }
    }

    // Check if this phase has only blocking HUMAN items and no agent-executable work
    const hasPendingAgentWork = phase.groups.some(g =>
      g.items.some(i => i.status === 'pending')
    );
    const blockingHumanIds = [];
    for (const group of phase.groups) {
      for (const item of group.items) {
        if (item.status === 'parked' && item.isHuman && group.letter !== 'Z') {
          blockingHumanIds.push(item.id);
        }
      }
    }
    if (!hasPendingAgentWork && blockingHumanIds.length > 0) {
      const itemList = blockingHumanIds.map(id => `  - ${id}`).join('\n');
      await this.logger.log('warn', 'human_prerequisite_phase_blocked', {
        phaseNumber: phase.number,
        phaseLabel: phase.label,
        blockingItems: blockingHumanIds
      });
      console.log('');
      console.log('  ⏸  Human action required before agents can continue:');
      console.log('');
      for (const id of blockingHumanIds) {
        const item = phase.groups.flatMap(g => g.items).find(i => i.id === id);
        console.log(`    - ${id} — ${item ? item.description : '(unknown)'}`);
      }
      console.log('');
      console.log('  Complete these items, then run: ./devshop action ' + this.cliOptions.projectId);
      console.log('  Restart with: ./devshop run ' + this.cliOptions.projectId);
      console.log('');
      this.monitor.requestPause({
        reason: 'blocking_park',
        blockingItem: { id: blockingHumanIds[0], error: 'Human prerequisite items must be completed before agent work can proceed' }
      });
      return;
    }

    // Execute [SPIKE] items before normal group execution
    const spikeItems = [];
    for (const group of phase.groups) {
      for (const item of group.items) {
        if (item.status === 'pending' && item.isSpike) {
          spikeItems.push(item);
        }
      }
    }
    if (spikeItems.length > 0) {
      await this._executeSpikeItems(phase, spikeItems);
      // Filter out spike items so they don't also go through the microcycle
      for (const group of phase.groups) {
        group.items = group.items.filter(i => !i.isSpike || i.status !== 'pending');
      }
    }

    const pendingGroups = this.roadmapReader.getPendingGroups(phase);
    if (pendingGroups.length === 0) return;

    // Assign personas to groups (stable across retries of the same phase)
    const phaseKey = `Phase ${phase.number}`;
    const uncachedGroups = pendingGroups.filter(
      g => !this._groupAssignments.has(`${phaseKey}-${g.letter}`)
    );
    if (uncachedGroups.length > 0) {
      const fresh = this.agentPool.assignMany(uncachedGroups.length);
      uncachedGroups.forEach((g, i) => {
        this._groupAssignments.set(`${phaseKey}-${g.letter}`, fresh[i]);
      });
    }
    const assignments = pendingGroups.map(
      g => this._groupAssignments.get(`${phaseKey}-${g.letter}`)
    );

    await this.logger.log('info', 'groups_assigned', {
      groups: pendingGroups.map((g, i) => ({
        group: `Group ${g.letter}: ${g.label}`,
        persona: assignments[i].name,
        items: g.items.filter(item => item.status === 'pending').map(item => item.id)
      }))
    });

    // Build peer groups context for parallel coordination
    const peerGroups = await Promise.all(pendingGroups.map(async (group, i) => {
      const pendingItems = group.items.filter(item => item.status === 'pending');
      const itemDetails = await Promise.all(pendingItems.map(async (item) => {
        const req = await this.openspec.getRequirementById(item.id);
        return {
          id: item.id,
          name: req ? req.name : item.description,
          bullets: req ? req.bullets : [item.description]
        };
      }));
      return {
        groupLetter: group.letter,
        persona: assignments[i],
        items: itemDetails
      };
    }));

    // Start progress timer
    const phaseLabel = `Phase ${phase.number}: ${phase.label}`;
    this._progressTimer = setInterval(async () => {
      try {
        await this._emitProgressSnapshot(phaseLabel, phase);
      } catch (err) { await this.logger.log('debug', 'progress_emission_error', { error: err.message }); }
    }, PROGRESS_INTERVAL_MS);

    // Run all groups concurrently
    const groupPromises = pendingGroups.map((group, i) =>
      this._executeGroup(phase, group, assignments[i], peerGroups)
    );

    const results = await Promise.allSettled(groupPromises);

    // Clear progress timer
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }

    // Log group results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const group = pendingGroups[i];
      const persona = assignments[i];
      if (result.status === 'fulfilled') {
        await this.logger.log('info', 'group_complete', {
          group: `Group ${group.letter}: ${group.label}`,
          persona: persona.name,
          agentType: persona.agentType,
          results: result.value
        });
      } else {
        await this.logger.log('error', 'group_failed', {
          group: `Group ${group.letter}: ${group.label}`,
          persona: persona.name,
          agentType: persona.agentType,
          error: result.reason?.message || 'Unknown error'
        });
      }
    }
  }

  async _executeSpikeItems(phase, spikeItems) {
    const state = this.stateMachine.getState();
    const agentConfig = this.config.agents.spike;

    for (const item of spikeItems) {
      // Check consumption before each spike
      const stopCheck = this.monitor.shouldStop();
      if (stopCheck.stop) {
        await this.logger.log('warn', 'spike_stopped', {
          reason: stopCheck.reason
        });
        break;
      }

      await this.logger.log('info', 'spike_started', {
        spikeId: item.id,
        description: item.description
      });

      try {
        // Render spike agent system prompt
        const systemPrompt = await this.templateEngine.renderAgentPrompt('spike-agent', {
          PROJECT_ID: this.cliOptions.projectId,
          PROJECT_DIR: this.cliOptions.projectDir,
          TECH_STACK: this._techStack || 'Not specified',
          SPIKE_ID: item.id,
          SPIKE_DESCRIPTION: item.description.replace('[SPIKE]', '').trim()
        });

        const onEvent = this._createAgentOnEvent('Morgan', item.id, 'spike');

        const result = await this.agentRunner.runAgent({
          systemPrompt,
          userPrompt: `Investigate the spike: ${item.description.replace('[SPIKE]', '').trim()}. Follow the mission outlined in your system prompt.`,
          workingDir: this.cliOptions.projectDir,
          model: agentConfig.model,
          maxBudgetUsd: agentConfig.maxBudgetUsd,
          timeoutMs: agentConfig.timeoutMs,
          allowedTools: agentConfig.allowedTools,
          onEvent
        });

        this.monitor.recordInvocation(result.cost || 0, result.duration || 0);

        if (result.success) {
          // Commit findings to session branch
          await this.gitOps.commitAll(
            this.cliOptions.projectDir,
            `spike: ${item.id} investigation findings`
          );

          // Mark item complete in roadmap
          await this.roadmapReader.markItemComplete(item.id);
          await this.gitOps.commitAll(
            this.cliOptions.projectDir,
            `chore: mark ${item.id} complete in roadmap`
          );

          // Update state
          const currentState = this.stateMachine.getState();
          const newCompleted = [...currentState.requirements.completed, item.id];
          const newPending = currentState.requirements.pending.filter(id => id !== item.id);
          await this.stateMachine.update({
            requirements: {
              ...currentState.requirements,
              completed: newCompleted,
              pending: newPending
            }
          });

          await this.logger.log('info', 'spike_complete', {
            spikeId: item.id,
            cost: result.cost
          });
        } else {
          // Park the spike item on failure
          await this.triage.parkItem(item.id, {
            reason: result.error || 'Spike investigation failed',
            persona: 'Morgan',
            attempts: 1,
            costUsd: Math.round((result.cost || 0) * 100) / 100
          });

          await this.logger.log('warn', 'spike_failed', {
            spikeId: item.id,
            error: result.error
          });
        }
      } catch (err) {
        await this.triage.parkItem(item.id, {
          reason: err.message,
          persona: 'Morgan',
          attempts: 1,
          costUsd: 0
        });

        await this.logger.log('error', 'spike_error', {
          spikeId: item.id,
          error: err.message
        });
      }
    }
  }

  async _executeGroup(phase, group, persona, peerGroups = []) {
    const state = this.stateMachine.getState();
    const worktreeDir = path.join(this.cliOptions.projectDir, '.worktrees', `group-${group.letter.toLowerCase()}`);

    // Create worktree for this group
    const worktreeBranch = `devshop/worktree-${state.sessionId}/group-${group.letter.toLowerCase()}`;

    // Clean up stale worktree branch from a previous failed attempt
    if (await this.gitOps.branchExists(this.cliOptions.projectDir, worktreeBranch)) {
      await this.gitOps._git(this.cliOptions.projectDir, ['branch', '-D', worktreeBranch]);
      await this.logger.log('info', 'stale_branch_deleted', { branch: worktreeBranch });
    }

    // Clean up stale worktree directory from a previous failed attempt
    // (git worktree remove may fail, leaving the dir behind; git doesn't track it)
    const fs = require('fs/promises');
    try {
      await fs.access(worktreeDir);
      await fs.rm(worktreeDir, { recursive: true, force: true });
      await this.gitOps._git(this.cliOptions.projectDir, ['worktree', 'prune']);
      await this.logger.log('info', 'stale_worktree_dir_removed', { path: worktreeDir });
    } catch {
      // Directory doesn't exist — expected normal case (no log needed)
    }

    await this.gitOps.createWorktreeWithNewBranch(
      this.cliOptions.projectDir,
      worktreeDir,
      worktreeBranch,
      state.sessionBranch
    );

    const results = [];
    const workBranchesCreated = [];

    try {
      // Process each pending item in the group sequentially
      const pendingItems = group.items.filter(item => item.status === 'pending');

      for (const item of pendingItems) {
        // Check consumption before each item
        const stopCheck = this.monitor.shouldStop();
        if (stopCheck.stop) {
          await this.logger.log('warn', 'group_stopped', {
            group: `Group ${group.letter}`,
            reason: stopCheck.reason
          });
          break;
        }

        // Update active agents
        await this.stateMachine.update({
          activeAgents: [
            ...(this.stateMachine.getState().activeAgents || []),
            {
              persona: persona.name,
              groupLetter: group.letter,
              groupLabel: group.label,
              requirementId: item.id
            }
          ]
        });

        // Get requirement details from openspec
        let requirement = await this.openspec.getRequirementById(item.id);
        if (!requirement) {
          // Synthesize from roadmap item
          requirement = {
            id: item.id,
            name: item.description,
            changeName: `add-${item.id}`,
            bullets: [item.description]
          };
        }

        await this.logger.log('info', 'microcycle_started', {
          requirementId: item.id,
          persona: persona.name,
          group: `Group ${group.letter}`
        });

        this.monitor.resetCycleCost();

        // Run microcycle
        const onEvent = this._createAgentOnEvent(persona.name, item.id, `Group ${group.letter}`);

        // Build phase context: items already merged in this phase for review enrichment
        const currentState = this.stateMachine.getState();
        const phaseItemIds = new Set();
        for (const g of phase.groups) {
          for (const it of g.items) phaseItemIds.add(it.id);
        }
        const phaseContext = (currentState.completedMicrocycles || [])
          .filter(m => phaseItemIds.has(m.requirementId) && m.requirementId !== item.id)
          .filter(m => m.result === 'merged' || m.result === 'salvage-merged')
          .map(m => ({ id: m.requirementId, description: m.requirementId }));

        // Enrich descriptions from roadmap items if available
        for (const ctx of phaseContext) {
          for (const g of phase.groups) {
            const roadmapItem = g.items.find(it => it.id === ctx.id);
            if (roadmapItem) {
              ctx.description = roadmapItem.description;
              break;
            }
          }
        }

        // Build peer context from other groups' requirements
        const peerContext = peerGroups
          .filter(pg => pg.groupLetter !== group.letter)
          .flatMap(pg => pg.items.map(peerItem => ({
            personaName: pg.persona.name,
            requirementName: peerItem.name,
            bullets: peerItem.bullets
          })));

        const microcycle = new Microcycle({
          agentRunner: this.agentRunner,
          templateEngine: this.templateEngine,
          gitOps: this.gitOps,
          openspec: this.openspec,
          logger: this.logger,
          monitor: this.monitor,
          config: this.config,
          projectDir: this.cliOptions.projectDir,
          workingDir: worktreeDir,
          sessionBranch: worktreeBranch,
          projectId: this.cliOptions.projectId,
          techStack: this._techStack,
          conventions: this._conventions,
          persona: persona.agentType,
          personaName: persona.name,
          failureHistory: this._failureHistory?.get(item.id) || null,
          priorWorkDiff: this._priorWorkDiffs?.get(item.id) || null,
          phaseContext,
          peerContext,
          onEvent
        });

        const result = await microcycle.run(
          item.id,
          requirement.changeName || `add-${item.id}`,
          requirement
        );

        results.push({ requirementId: item.id, ...result });
        if (result.workBranch) {
          workBranchesCreated.push(result.workBranch);
        }

        // Microcycle paused for pair — item stays pending, break out
        if (result.status === 'pause_for_pair') {
          break;
        }

        // Dispatch to the appropriate handler based on result
        let shouldBreak = false;
        if (result.status === 'merged') {
          shouldBreak = await this._handleMergedItem(item, result, state, worktreeDir, worktreeBranch, persona, group, phase);
        } else if (result.salvaged && result.workBranch) {
          shouldBreak = await this._handleSalvagedItem(item, result, state, worktreeDir, worktreeBranch, persona, group, phase);
        } else {
          shouldBreak = await this._handleParkedItem(item, result, persona, group, phase);
        }

        if (shouldBreak) break;

        // Remove from active agents
        const afterState = this.stateMachine.getState();
        await this.stateMachine.update({
          activeAgents: (afterState.activeAgents || []).filter(a => a.requirementId !== item.id)
        });

        await this.logger.log('info', 'microcycle_complete', {
          requirementId: item.id,
          result: result.status,
          cost: result.cost,
          attempts: result.attempts
        });
      }
    } finally {
      // Clean up worktree
      try {
        await this.gitOps.removeWorktree(this.cliOptions.projectDir, worktreeDir);
      } catch (err) {
        await this.logger.log('debug', 'worktree_cleanup_failed', { worktreeDir, error: err.message });
      }
      // Clean up the worktree branch
      try {
        await this.gitOps._git(this.cliOptions.projectDir, ['branch', '-D', worktreeBranch]);
      } catch (err) {
        await this.logger.log('debug', 'branch_cleanup_skipped', { branch: worktreeBranch, error: err.message });
      }
      // Clean up any work branches created during this group
      for (const wb of workBranchesCreated) {
        try {
          await this.gitOps._git(this.cliOptions.projectDir, ['branch', '-D', wb]);
        } catch (err) {
          await this.logger.log('debug', 'branch_cleanup_skipped', { branch: wb, error: err.message });
        }
      }
    }

    return results;
  }

  /**
   * Log a milestone event and emit a progress snapshot.
   */
  async _logMilestoneAndProgress(item, milestoneResult, persona, group, phase, { diffStat = null, reviewSummary = null } = {}) {
    const state = this.stateMachine.getState();
    const totalReqs = (state.requirements.completed || []).length
      + (state.requirements.pending || []).length
      + (state.requirements.parked || []).length;

    await this.logger.logMilestone({
      requirementId: item.id,
      result: milestoneResult,
      persona: persona.name,
      group: group.letter,
      attempts: item._attempts,
      costUsd: item._costUsd,
      diffStat,
      reviewSummary,
      previewAvailable: state.preview?.available || false,
      progress: {
        completed: (state.requirements.completed || []).length,
        total: totalReqs,
        parked: (state.requirements.parked || []).length
      }
    });

    await this._emitProgressSnapshot(`Phase ${phase.number}: ${phase.label}`, phase);
  }

  /**
   * Handle a successfully merged microcycle result.
   * Returns true if the group loop should break (blocking park from smoke test failure).
   */
  async _handleMergedItem(item, result, state, worktreeDir, worktreeBranch, persona, group, phase) {
    const costUsd = Math.round(result.cost * 100) / 100;

    // Merge with lock: work branch → worktree branch → session branch
    await this.mergeLock.withLock(async () => {
      await this.gitOps._git(worktreeDir, ['checkout', worktreeBranch]);
      await this.gitOps._git(worktreeDir, [
        'merge', '--no-ff', result.workBranch,
        '-m', `merge: ${item.id} work into worktree`
      ]);
      await this.gitOps.mergeToSession(
        this.cliOptions.projectDir,
        state.sessionBranch,
        worktreeBranch,
        `merge: ${item.id} (${persona.name}, Group ${group.letter})`
      );
      await this.gitOps.checkoutBranch(worktreeDir, worktreeBranch);
      try {
        await this.gitOps._git(worktreeDir, ['merge', state.sessionBranch]);
      } catch (err) {
        await this.logger.log('debug', 'worktree_session_merge_skipped', { error: err.message });
      }
    });

    // Post-merge smoke test: run tests on session branch to catch regressions
    const smokeResult = await this.healthGate.runPostMergeSmokeTest(item.id);
    if (!smokeResult.passed) {
      const parkResult = await this.triage.parkItem(item.id, {
        reason: smokeResult.error,
        persona: persona.name,
        attempts: result.attempts,
        costUsd,
        attemptHistory: result.attemptHistory || [],
        description: item.description,
        phaseNumber: phase.number,
        groupLetter: group.letter
      });

      await this._logMilestoneAndProgress(
        { id: item.id, _attempts: result.attempts, _costUsd: costUsd },
        'parked', persona, group, phase,
        { reviewSummary: 'Post-merge smoke test failed' }
      );

      if (parkResult.classification === 'blocking') {
        this.monitor.requestPause({
          reason: 'blocking_park',
          blockingItem: { id: item.id, error: smokeResult.error }
        });
      }
      return false; // continue, not break (was `continue` in original)
    }

    await this.roadmapReader.markItemComplete(item.id);
    await this.gitOps.commitAll(
      this.cliOptions.projectDir,
      `chore: mark ${item.id} complete in roadmap`
    );

    // Post-merge preview smoke check
    this._lastMergedRequirementId = item.id;
    await this.healthGate.runPreviewCheck();

    // One-time architecture validation after first merge
    await this.healthGate.runArchitectureCheck();

    // Update state
    const currentState = this.stateMachine.getState();
    const newCompleted = [...currentState.requirements.completed, item.id];
    const newPending = currentState.requirements.pending.filter(id => id !== item.id);
    await this.stateMachine.update({
      requirements: {
        ...currentState.requirements,
        completed: newCompleted,
        pending: newPending
      },
      completedMicrocycles: [
        ...currentState.completedMicrocycles,
        {
          requirementId: item.id,
          result: 'merged',
          persona: persona.name,
          group: `Group ${group.letter}`,
          attempts: result.attempts,
          costUsd,
          commitSha: result.commitSha,
          completedAt: new Date().toISOString(),
          reviewScores: result.reviewScores || null
        }
      ]
    });

    // Emit milestone event
    let diffStat = null;
    try {
      diffStat = await this.gitOps.getDiffStat(this.cliOptions.projectDir, 'main');
    } catch (err) { await this.logger.log('debug', 'diff_stat_failed', { error: err.message }); }
    const reviewSummary = result.reviewScores
      ? `Approved — correctness: ${result.reviewScores.correctness}/5, completeness: ${result.reviewScores.completeness}/5`
      : null;

    await this._logMilestoneAndProgress(
      { id: item.id, _attempts: result.attempts, _costUsd: costUsd },
      'merged', persona, group, phase,
      { diffStat, reviewSummary }
    );

    return false;
  }

  /**
   * Handle a salvaged microcycle result — attempt merge, fall back to parking.
   * Returns true if the group loop should break (blocking park).
   */
  async _handleSalvagedItem(item, result, state, worktreeDir, worktreeBranch, persona, group, phase) {
    const costUsd = Math.round(result.cost * 100) / 100;

    let salvageMerged = false;
    try {
      await this.mergeLock.withLock(async () => {
        await this.gitOps._git(worktreeDir, ['checkout', worktreeBranch]);
        await this.gitOps._git(worktreeDir, [
          'merge', '--no-ff', result.workBranch,
          '-m', `merge: ${item.id} work into worktree (salvage)`
        ]);
        await this.gitOps.mergeToSession(
          this.cliOptions.projectDir,
          state.sessionBranch,
          worktreeBranch,
          `merge: ${item.id} (${persona.name}, Group ${group.letter})`
        );
        await this.gitOps.checkoutBranch(worktreeDir, worktreeBranch);
        try {
          await this.gitOps._git(worktreeDir, ['merge', state.sessionBranch]);
        } catch (err) {
          await this.logger.log('debug', 'salvage_worktree_merge_skipped', { error: err.message });
        }
      });

      // Run tests on session branch to verify salvaged work
      const { exec: execAsync } = require('./infra/exec-utils');
      await execAsync('npm test', {
        cwd: this.cliOptions.projectDir,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      });
      salvageMerged = true;
    } catch (mergeErr) {
      // Merge or tests failed — revert and fall through to normal parking
      await this.logger.log('warn', 'salvage_merge_failed', {
        requirementId: item.id,
        error: mergeErr.message
      });
      try {
        await this.gitOps._git(worktreeDir, ['checkout', worktreeBranch]);
        await this.gitOps._git(worktreeDir, ['reset', '--hard', state.sessionBranch]);
        await this.gitOps._git(this.cliOptions.projectDir, ['checkout', state.sessionBranch]);
        await this.gitOps._git(this.cliOptions.projectDir, ['reset', '--hard', 'HEAD~1']);
      } catch (err) {
        await this.logger.log('debug', 'salvage_revert_failed', { error: err.message });
      }
    }

    if (salvageMerged) {
      await this.roadmapReader.markItemComplete(item.id);
      await this.gitOps.commitAll(
        this.cliOptions.projectDir,
        `chore: mark ${item.id} complete in roadmap (salvage-merge)`
      );

      await this.logger.log('warn', 'salvage_merged_without_review', {
        requirementId: item.id,
        persona: persona.name,
        group: `Group ${group.letter}`
      });

      // Update state
      const currentState = this.stateMachine.getState();
      const newCompleted = [...currentState.requirements.completed, item.id];
      const newPending = currentState.requirements.pending.filter(id => id !== item.id);
      await this.stateMachine.update({
        requirements: {
          ...currentState.requirements,
          completed: newCompleted,
          pending: newPending
        },
        completedMicrocycles: [
          ...currentState.completedMicrocycles,
          {
            requirementId: item.id,
            result: 'salvage-merged',
            persona: persona.name,
            group: `Group ${group.letter}`,
            attempts: result.attempts,
            costUsd,
            completedAt: new Date().toISOString(),
            reviewScores: null
          }
        ]
      });

      // Emit salvage-merged milestone
      let diffStat = null;
      try {
        diffStat = await this.gitOps.getDiffStat(this.cliOptions.projectDir, 'main');
      } catch (err) { await this.logger.log('debug', 'diff_stat_failed', { error: err.message }); }

      await this._logMilestoneAndProgress(
        { id: item.id, _attempts: result.attempts, _costUsd: costUsd },
        'salvage-merged', persona, group, phase,
        { diffStat, reviewSummary: 'Salvage-merged without review' }
      );

      return false;
    }

    // Salvage-merge failed — park the item
    const parkResult = await this.triage.parkItem(item.id, {
      reason: result.error,
      persona: persona.name,
      attempts: result.attempts,
      costUsd,
      attemptHistory: result.attemptHistory || [],
      description: item.description,
      phaseNumber: phase.number,
      groupLetter: group.letter
    });

    await this._logMilestoneAndProgress(
      { id: item.id, _attempts: result.attempts, _costUsd: costUsd },
      'parked', persona, group, phase
    );

    if (parkResult.classification === 'blocking') {
      this.monitor.requestPause({
        reason: 'blocking_park',
        blockingItem: { id: item.id, error: result.error }
      });
      await this.logger.log('warn', 'blocking_park_detected', {
        requirementId: item.id,
        group: `Group ${group.letter}`,
        error: result.error
      });
      return true;
    }
    return false;
  }

  /**
   * Handle a failed microcycle result — park the item.
   * Returns true if the group loop should break (blocking park).
   */
  async _handleParkedItem(item, result, persona, group, phase) {
    const costUsd = Math.round(result.cost * 100) / 100;

    const parkResult = await this.triage.parkItem(item.id, {
      reason: result.error,
      persona: persona.name,
      attempts: result.attempts,
      costUsd,
      attemptHistory: result.attemptHistory || [],
      description: item.description,
      phaseNumber: phase.number,
      groupLetter: group.letter
    });

    await this._logMilestoneAndProgress(
      { id: item.id, _attempts: result.attempts, _costUsd: costUsd },
      'parked', persona, group, phase
    );

    if (parkResult.classification === 'blocking') {
      this.monitor.requestPause({
        reason: 'blocking_park',
        blockingItem: { id: item.id, error: result.error }
      });
      await this.logger.log('warn', 'blocking_park_detected', {
        requirementId: item.id,
        group: `Group ${group.letter}`,
        error: result.error
      });
      return true;
    }
    return false;
  }

  async _pushSessionBranch(context) {
    const state = this.stateMachine.getState();
    if (state.requirements.completed.length === 0) return;

    try {
      await this.gitOps.pushBranch(this.cliOptions.projectDir, state.sessionBranch);
    } catch (err) {
      await this.logger.log('warn', 'push_failed', {
        context,
        branch: state.sessionBranch,
        error: err.message
      });
    }
  }

  _installKeypressListener() {
    if (!process.stdin.isTTY) return;
    try {
      const fs = require('fs');
      const tty = require('tty');
      this._ttyFd = fs.openSync('/dev/tty', 'r');
      this._ttyStream = new tty.ReadStream(this._ttyFd);
      this._ttyStream.setRawMode(true);
      this._keypressHandler = (data) => {
        const key = data.toString();
        if (key === 'p' || key === 'P') {
          this.monitor.requestPause({ reason: 'pause_for_pair' });
          console.log('\n  Pausing for pair mode — finishing current work...');
        }
      };
      this._ttyStream.on('data', this._keypressHandler);
      this._ttyStream.unref(); // Don't keep event loop alive just for this
    } catch {
      // /dev/tty not available (CI, piped) — skip silently
      this._ttyStream = null;
      this._ttyFd = null;
      this._keypressHandler = null;
    }
  }

  _removeKeypressListener() {
    if (!this._ttyStream) return;
    try {
      this._ttyStream.setRawMode(false);
      this._ttyStream.removeAllListeners('data');
      this._ttyStream.destroy();
    } catch {}
    try {
      if (this._ttyFd !== null) {
        require('fs').closeSync(this._ttyFd);
      }
    } catch {}
    this._ttyStream = null;
    this._ttyFd = null;
    this._keypressHandler = null;
  }

  async _handlePairInterrupt() {
    this._removeKeypressListener();
    this.monitor.removeSignalHandlers();

    await this.logger.log('info', 'pair_interrupt_started', {
      message: 'User requested pair mode'
    });

    console.log('');
    console.log('  === Entering Pair Mode ===');
    console.log('  Morgan has context about your current session.');
    console.log('  Use /exit or Ctrl+C to return to the orchestrator.');
    console.log('');

    // Build context for Morgan
    const state = this.stateMachine.getState();
    const { buildPairContext, spawnClaudeTerminal } = require('./commands/pair');
    const { getOrchestratorPaths } = require('./session/path-utils');
    const { TemplateEngine } = require('./agents/template-engine');
    const fs = require('fs/promises');

    const { logsDir } = getOrchestratorPaths(this.cliOptions);
    const stateDir = path.join(this.cliOptions.activeAgentsDir, 'orchestrator');
    const progressContext = await buildPairContext({
      stateDir,
      logsDir,
      roadmapReader: this.roadmapReader
    });

    const templateEngine = new TemplateEngine(this.cliOptions.templatesDir);
    let techStack = 'Not specified';
    try { techStack = await this.openspec.parseTechStack(); } catch {}

    const templateVars = {
      PROJECT_ID: this.cliOptions.projectId,
      PROJECT_DIR: this.cliOptions.projectDir,
      TECH_STACK: techStack,
      GITHUB_REPO: this.cliOptions.githubRepo || '',
      REQUIREMENTS: progressContext
        ? `Here is the current project state:\n${progressContext}`
        : ''
    };

    const promptPath = path.join(this.cliOptions.templatesDir, 'principal-engineer', 'pair-prompt.md');
    const promptTemplate = await fs.readFile(promptPath, 'utf-8');
    const renderedPrompt = templateEngine.renderString(promptTemplate, templateVars);

    const pairAgentConfig = this.config.agents?.['pair'] || this.config.agents?.['principal-engineer'];

    await spawnClaudeTerminal({
      projectDir: this.cliOptions.projectDir,
      appendSystemPrompt: renderedPrompt,
      model: pairAgentConfig?.model,
      name: `Morgan — ${this.cliOptions.projectId}`
    });

    console.log('');
    console.log('  === Resuming Orchestrator ===');
    console.log('');

    await this.logger.log('info', 'pair_interrupt_ended', {
      message: 'Pair session ended, resuming orchestration'
    });

    // Restore orchestrator state
    this.monitor.clearPause();
    this.monitor.installSignalHandlers();
    this._installKeypressListener();
  }

  async _completeSession() {
    // Remove keypress listener
    this._removeKeypressListener();

    // Clear progress timer
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }

    // Stop broadcast server
    if (this.broadcastServer && this.broadcastServer.isRunning) {
      try {
        await this.broadcastServer.stop();
      } catch (err) {
        await this.logger.log('debug', 'broadcast_server_stop_failed', { error: err.message });
      }
    }

    await this.stateMachine.transition('SESSION_COMPLETE', {
      consumption: this.monitor.getStateForPersistence()
    });
  }

  _createAgentOnEvent(persona, requirementId, group) {
    const watchEnabled = this.cliOptions.watch;
    const hasBroadcast = this.broadcastServer && this.broadcastServer.isRunning;

    if (!hasBroadcast && !watchEnabled) return undefined;

    const bsRef = this.broadcastServer;
    const sessionId = this.stateMachine.getState().sessionId;

    // Lazy-load shared formatter only when watch is enabled
    const formatAgentEvent = watchEnabled
      ? require('./infra/format-events').formatAgentEvent
      : null;

    return (event) => {
      const envelope = {
        source: 'agent',
        sessionId,
        timestamp: new Date().toISOString(),
        persona,
        requirementId,
        group,
        event
      };

      if (hasBroadcast) {
        bsRef.broadcast(envelope);
      }

      if (formatAgentEvent) {
        formatAgentEvent(envelope);
      }
    };
  }

  _getBlockingIdsFromState() {
    const state = this.stateMachine.getState();
    const blocking = new Set();
    for (const entry of state.requirements.parked) {
      if (entry.triageClassification === 'blocking') {
        blocking.add(entry.id);
      }
    }
    return blocking;
  }

  async _emitProgressSnapshot(phaseLabel, phase) {
    const state = this.stateMachine.getState();
    const elapsedMs = Date.now() - new Date(state.startedAt).getTime();
    const elapsedMinutes = Math.round(elapsedMs / 60000);
    const activeAgents = (state.activeAgents || []).map(a => ({
      persona: a.persona,
      requirementId: a.requirementId
    }));

    // Count progress scoped to the current phase
    let completed = 0;
    let parked = 0;
    let total = 0;

    if (phase) {
      const completedSet = new Set(state.requirements.completed || []);
      const parkedSet = new Set(state.requirements.parked || []);
      for (const group of phase.groups) {
        for (const item of group.items) {
          total++;
          if (completedSet.has(item.id)) completed++;
          else if (parkedSet.has(item.id)) parked++;
        }
      }
    } else {
      // Fallback to global counts if no phase provided
      const reqs = state.requirements;
      completed = (reqs.completed || []).length;
      parked = (reqs.parked || []).length;
      total = completed + parked + (reqs.pending || []).length;
    }

    await this.logger.logProgress({
      phase: phaseLabel,
      completed,
      total,
      parked,
      budgetUsedUsd: this.monitor.totalCostUsd,
      budgetLimitUsd: this.config.budgetLimitUsd || 0,
      elapsedMinutes,
      activeAgents
    });
  }

  _getProjectListing() {
    const { execFileSync } = require('child_process');
    const output = execFileSync('find', [
      '.', '-type', 'f',
      '-not', '-path', './.git/*',
      '-not', '-path', './node_modules/*',
      '-not', '-path', './.worktrees/*'
    ], {
      cwd: this.cliOptions.projectDir,
      encoding: 'utf-8',
      timeout: PROJECT_LISTING_TIMEOUT_MS
    });
    const lines = output.trim().split('\n');
    return lines.slice(0, PROJECT_LISTING_LIMIT).join('\n');
  }

  /**
   * Process user-reported issues (bugs and feature requests) between phases.
   * This is the safe point — no agents running, no worktrees, session branch is pushed.
   */
  async _processReportQueue() {
    const queuePath = path.join(this.cliOptions.activeAgentsDir, 'orchestrator', 'reported-issues.json');

    // Build roadmap context for Riley (feature requests)
    let roadmapContext = '';
    try {
      const roadmap = await this.roadmapReader.parse();
      roadmapContext = `Roadmap: ${roadmap.title}\n`;
      for (const phase of roadmap.phases) {
        const items = phase.groups.flatMap(g => g.items);
        const done = items.filter(i => i.status === 'complete').length;
        roadmapContext += `- Phase ${phase.number} (${phase.label}): ${done}/${items.length} complete\n`;
      }
    } catch (err) {
      await this.logger.log('debug', 'report_roadmap_context_failed', { error: err.message });
    }

    try {
      const result = await processReports(queuePath, {
        projectDir: this.cliOptions.projectDir,
        templatesDir: this.cliOptions.templatesDir,
        techStack: this._techStack,
        logger: this.logger,
        agentRunner: this.agentRunner,
        templateEngine: this.templateEngine,
        gitOps: this.gitOps,
        roadmapContext,
        onEvent: this._createAgentOnEvent('Morgan', 'report', 'report-fix')
      });

      if (result.processed > 0) {
        await this.logger.log('info', 'reports_processing_started', {
          count: result.processed
        });

        for (const r of result.results) {
          this.monitor.recordInvocation(0, 0); // budget tracked inside processReports
        }

        await this.logger.log('info', 'reports_processing_complete', {
          results: result.results
        });
      }
    } catch (err) {
      await this.logger.log('warn', 'reports_processing_error', {
        error: err.message
      });
    }
  }

  async _checkPhaseBudget(phase) {
    if (!this.costEstimator) return;

    const snapshot = this.monitor.getSnapshot();
    const remainingBudget = snapshot.budgetRemainingUsd;
    const budgetUsedPct = parseFloat(snapshot.budgetUsedPct);

    let pendingCount = 0;
    for (const group of phase.groups) {
      for (const item of group.items) {
        if (item.status === 'pending') pendingCount++;
      }
    }

    if (pendingCount === 0) return;

    const prediction = this.costEstimator.predictSufficiency(remainingBudget, pendingCount);

    if (!prediction.sufficient && budgetUsedPct > 90) {
      await this.logger.log('warn', 'budget_may_be_insufficient', {
        phase: `Phase ${phase.number}: ${phase.label}`,
        estimatedCost: prediction.estimatedCost,
        remainingBudget: prediction.remainingBudget,
        pendingItems: pendingCount,
        confidence: prediction.confidence
      });
    }
  }

  async _extractPriorWorkDiffs(existingState) {
    const parked = existingState?.requirements?.parked;
    if (!parked || parked.length === 0) return;

    // Find stale work branches
    let branches;
    try {
      const { stdout } = await this.gitOps._git(this.cliOptions.projectDir, [
        'branch', '--list', 'devshop/work-*'
      ]);
      branches = stdout.split('\n')
        .map(line => line.replace(/^\*?\s+/, '').trim())
        .filter(b => b.length > 0);
    } catch {
      return;
    }

    if (branches.length === 0) return;

    const diffs = new Map();

    for (const entry of parked) {
      const reqId = typeof entry === 'string' ? entry : entry.id;
      const reason = typeof entry === 'string' ? '' : (entry.reason || '');

      // Only salvage diffs for infrastructure failures
      const isInfra = INFRA_FAILURE_PATTERNS.some(p => p.test(reason));
      if (!isInfra) continue;

      // Find matching branch (ends with /<reqId>)
      const matchingBranch = branches.find(b => b.endsWith(`/${reqId}`));
      if (!matchingBranch) continue;

      try {
        const result = await this.gitOps.getBranchDiff(this.cliOptions.projectDir, matchingBranch);
        if (result.diff && result.diff.trim()) {
          diffs.set(reqId, result);
        }
      } catch (err) {
        await this.logger.log('debug', 'prior_work_diff_failed', {
          requirementId: reqId,
          branch: matchingBranch,
          error: err.message
        });
      }
    }

    if (diffs.size > 0) {
      this._priorWorkDiffs = diffs;
      await this.logger.log('info', 'prior_work_diffs_extracted', {
        count: diffs.size,
        requirementIds: [...diffs.keys()]
      });
    }
  }

  async _runRecovery(sessionId) {
    const orchestratorDir = path.join(this.cliOptions.activeAgentsDir, 'orchestrator');
    const stateFilePath = path.join(orchestratorDir, 'state.json');

    const recovery = new RecoveryManager({
      gitOps: this.gitOps,
      logger: this.logger,
      projectDir: this.cliOptions.projectDir,
      stateFilePath
    });

    try {
      const plan = await recovery.analyze(sessionId);

      if (recovery.isEmpty(plan)) {
        await this.logger.log('info', 'recovery_clean');
      } else {
        await recovery.execute(plan);
      }
    } catch (err) {
      await this.logger.log('warn', 'recovery_error', { error: err.message });
    }
  }

  /**
   * Check if any parked items with interventions have been resolved
   * (roadmap status changed from [!] to [x] via ./devshop action).
   * Move resolved items back to pending for retry.
   */
  async _checkResolvedInterventions() {
    const state = this.stateMachine.getState();
    const interventionItems = state.requirements.parked.filter(p => p.intervention);
    if (interventionItems.length === 0) return;

    const roadmap = await this.roadmapReader.parse();
    const allItems = this.roadmapReader.getAllItems(roadmap);
    const roadmapStatus = new Map(allItems.map(i => [i.id, i.status]));

    const resolved = [];
    for (const entry of interventionItems) {
      const status = roadmapStatus.get(entry.id);
      // If the user ran ./devshop action and marked it complete, status is 'complete'
      // If they manually reset it to pending, status is 'pending'
      if (status === 'complete' || status === 'pending') {
        resolved.push(entry.id);
      }
    }

    if (resolved.length === 0) return;

    // Reset resolved items: mark as pending in roadmap and state
    for (const id of resolved) {
      await this.roadmapReader._updateItemStatus(id, ' ');
    }
    await this.gitOps.commitAll(
      this.cliOptions.projectDir,
      `chore: reset ${resolved.length} resolved intervention(s) to pending`
    );

    const currentState = this.stateMachine.getState();
    const resolvedSet = new Set(resolved);
    await this.stateMachine.update({
      requirements: {
        ...currentState.requirements,
        parked: currentState.requirements.parked.filter(p => !resolvedSet.has(p.id)),
        pending: [...currentState.requirements.pending, ...resolved]
      }
    });

    await this.logger.log('info', 'interventions_resolved', {
      count: resolved.length,
      items: resolved
    });
  }

  _getStopReason(state) {
    if (this._spikeReviewPending) {
      return 'spike_review_pending';
    }
    if (state.requirements.pending.length === 0 && !state.requirements.inProgress) {
      return 'all_requirements_processed';
    }
    const stopCheck = this.monitor.shouldStop();
    if (stopCheck.stop) return stopCheck.reason;
    return 'session_ended';
  }

}

module.exports = { ParallelOrchestrator };
