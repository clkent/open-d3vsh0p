const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { HealthGate } = require('./health-gate');

function createMockOrchestrator(overrides = {}) {
  const logEntries = [];

  const o = {
    cliOptions: {
      projectDir: '/tmp/test-project',
      projectId: 'proj-001',
      preview: overrides.preview || null,
      ...overrides.cliOptions
    },
    config: {
      agents: {
        'principal-engineer': {
          model: 'test',
          maxBudgetUsd: 2,
          timeoutMs: 60000,
          allowedTools: ['Read']
        }
      },
      ...overrides.config
    },
    logger: {
      log: async (level, event, data) => { logEntries.push({ level, event, data }); },
      logPreviewCheck: async (data) => { logEntries.push({ level: 'info', event: 'preview_check', data }); },
      logGoLook: async (data) => { logEntries.push({ level: 'info', event: 'go_look', data }); },
      ...overrides.logger
    },
    monitor: {
      getStateForPersistence: () => ({}),
      recordInvocation: () => {},
      ...overrides.monitor
    },
    stateMachine: {
      transition: async () => {},
      getState: () => ({
        sessionId: 'test-session',
        preview: overrides.previewState || null,
        ...overrides.state
      }),
      update: async () => {},
      ...overrides.stateMachine
    },
    gitOps: {
      commitAll: async () => 'abc123',
      _git: async () => {},
      ...overrides.gitOps
    },
    agentRunner: {
      runAgent: async () => ({
        success: true, cost: 0.5, duration: 1000,
        output: JSON.stringify({ decision: 'APPROVE', summary: 'OK' })
      }),
      ...overrides.agentRunner
    },
    templateEngine: {
      renderAgentPrompt: async () => 'system prompt',
      ...overrides.templateEngine
    },
    repair: {
      runProjectDiagnostic: async () => ({ success: false, skipped: true }),
      runDiagnosticFix: async () => ({ success: false }),
      ...overrides.repair
    },
    triage: {
      parkItem: async () => ({ classification: 'non_blocking' }),
      ...overrides.triage
    },
    _conventions: overrides.conventions || null,
    _techStack: overrides.techStack || 'Node.js',
    _architectureCheckDone: overrides.architectureCheckDone || false,
    _createAgentOnEvent: () => undefined,
    _getProjectListing: () => 'file1.js\nfile2.js',
    _lastMergedRequirementId: overrides.lastMergedReqId || null,
    _completeSession: async () => {},
    ...overrides.orchestratorOverrides
  };

  return { o, logEntries };
}

describe('HealthGate', () => {
  // We need to mock the healthChecker module used by HealthGate.
  // Since HealthGate requires it internally, we mock it via require cache.
  let healthChecker;
  let HealthGateClass;

  beforeEach(() => {
    // Reset require caches
    delete require.cache[require.resolve('./health-gate')];
    delete require.cache[require.resolve('./health-checker')];

    // Mock health-checker
    healthChecker = {
      resolveHealthCheckConfig: async () => ({ commands: ['npm test'], timeoutMs: 120000 }),
      runHealthCheck: async () => ({ passed: true, results: [{ command: 'npm test', exitCode: 0, stderr: '', stdout: '' }] }),
      detectHealthCheckCommands: async () => ['npm test']
    };
    require.cache[require.resolve('./health-checker')] = {
      id: require.resolve('./health-checker'),
      filename: require.resolve('./health-checker'),
      loaded: true,
      exports: healthChecker
    };

    // Also mock agent-session to avoid its real deps
    delete require.cache[require.resolve('../agents/agent-session')];
    require.cache[require.resolve('../agents/agent-session')] = {
      id: require.resolve('../agents/agent-session'),
      filename: require.resolve('../agents/agent-session'),
      loaded: true,
      exports: {
        AgentSession: {
          createMorganSession: () => ({
            chat: async () => ({ success: true, cost: 0.5 })
          })
        }
      }
    };

    delete require.cache[require.resolve('./health-gate')];
    ({ HealthGate: HealthGateClass } = require('./health-gate'));
  });

  describe('runHealthCheckGate', () => {
    it('returns true when no health check commands configured', async () => {
      healthChecker.resolveHealthCheckConfig = async () => ({ commands: [] });
      const { o, logEntries } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      const result = await gate.runHealthCheckGate();
      assert.equal(result, true);
      assert.equal(logEntries.some(e => e.event === 'health_check_skipped'), true);
    });

    it('returns true when health check passes', async () => {
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      const result = await gate.runHealthCheckGate();
      assert.equal(result, true);
    });

    it('transitions to PROJECT_REPAIR on failure', async () => {
      healthChecker.runHealthCheck = async () => ({
        passed: false,
        results: [{ command: 'npm test', exitCode: 1, stderr: 'Error', stdout: '' }]
      });

      let transitionedTo = null;
      const { o } = createMockOrchestrator({
        stateMachine: {
          transition: async (state) => { transitionedTo = state; },
          getState: () => ({ sessionId: 's1', preview: null }),
          update: async () => {}
        }
      });
      const gate = new HealthGateClass(o);

      // handleProjectRepair will be called - mock it to return true
      gate.handleProjectRepair = async () => true;

      await gate.runHealthCheckGate();
      assert.equal(transitionedTo, 'PROJECT_REPAIR');
    });
  });

  describe('runPhaseGate', () => {
    it('returns passed:true when no commands configured', async () => {
      healthChecker.resolveHealthCheckConfig = async () => ({ commands: [] });
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      const result = await gate.runPhaseGate({ number: 1, label: 'Core' });
      assert.deepEqual(result, { passed: true });
    });

    it('returns passed:true when health check passes', async () => {
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      const result = await gate.runPhaseGate({ number: 1, label: 'Core' });
      assert.deepEqual(result, { passed: true });
    });

    it('attempts diagnostic on failure', async () => {
      healthChecker.runHealthCheck = async () => ({
        passed: false,
        results: [{ command: 'npm test', exitCode: 1, stderr: 'err', stdout: '' }]
      });

      let diagCalled = false;
      const { o, logEntries } = createMockOrchestrator({
        repair: {
          runProjectDiagnostic: async () => { diagCalled = true; return { success: false }; }
        }
      });
      const gate = new HealthGateClass(o);

      const result = await gate.runPhaseGate({ number: 1, label: 'Core' });
      assert.equal(result.passed, false);
      assert.equal(diagCalled, true);
    });

    it('returns passed:true when diagnostic fixes the issue', async () => {
      let checkCount = 0;
      healthChecker.runHealthCheck = async () => {
        checkCount++;
        if (checkCount === 1) {
          return { passed: false, results: [{ command: 'npm test', exitCode: 1, stderr: 'err', stdout: '' }] };
        }
        return { passed: true, results: [] };
      };

      const { o, logEntries } = createMockOrchestrator({
        repair: {
          runProjectDiagnostic: async () => ({ success: true })
        }
      });
      const gate = new HealthGateClass(o);

      const result = await gate.runPhaseGate({ number: 1, label: 'Core' });
      assert.equal(result.passed, true);
      assert.equal(logEntries.some(e => e.event === 'phase_gate_fixed'), true);
    });
  });

  describe('runPostMergeSmokeTest', () => {
    it('returns passed:true when no test commands detected', async () => {
      healthChecker.detectHealthCheckCommands = async () => [];
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      const result = await gate.runPostMergeSmokeTest('req-1');
      assert.deepEqual(result, { passed: true });
    });

    it('returns passed:true on passing smoke test', async () => {
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      const result = await gate.runPostMergeSmokeTest('req-1');
      assert.equal(result.passed, true);
    });

    it('filters out build commands from smoke test', async () => {
      healthChecker.detectHealthCheckCommands = async () => ['npm run build', 'npm test'];
      let capturedConfig = null;
      healthChecker.runHealthCheck = async (dir, config) => {
        capturedConfig = config;
        return { passed: true, results: [] };
      };

      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      await gate.runPostMergeSmokeTest('req-1');
      assert.deepEqual(capturedConfig.commands, ['npm test']);
    });

    it('attempts diagnostic fix on failure', async () => {
      healthChecker.runHealthCheck = async () => ({
        passed: false,
        results: [{ command: 'npm test', exitCode: 1, stderr: 'fail', stdout: '' }]
      });

      let diagCalled = false;
      const { o } = createMockOrchestrator({
        repair: {
          runDiagnosticFix: async () => { diagCalled = true; return { success: false }; }
        }
      });
      const gate = new HealthGateClass(o);

      const result = await gate.runPostMergeSmokeTest('req-1');
      assert.equal(result.passed, false);
      assert.match(result.error, /post-merge regression/);
      assert.equal(diagCalled, true);
    });

    it('returns passed:true when diagnostic fix succeeds', async () => {
      let checkCount = 0;
      healthChecker.runHealthCheck = async () => {
        checkCount++;
        if (checkCount === 1) {
          return { passed: false, results: [{ command: 'npm test', exitCode: 1, stderr: 'fail', stdout: '' }] };
        }
        return { passed: true, results: [] };
      };

      const { o } = createMockOrchestrator({
        repair: {
          runDiagnosticFix: async () => ({ success: true })
        }
      });
      const gate = new HealthGateClass(o);

      const result = await gate.runPostMergeSmokeTest('req-1');
      assert.equal(result.passed, true);
    });
  });

  describe('_parseEnvironmentIssue', () => {
    it('extracts ENVIRONMENT_ISSUE line from response', () => {
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      const response = 'I investigated the error.\n\nENVIRONMENT_ISSUE: CocoaPods xcodeproj gem does not support Xcode 16.4 object version 70\n\nPlease update the gem.';
      assert.equal(
        gate._parseEnvironmentIssue(response),
        'CocoaPods xcodeproj gem does not support Xcode 16.4 object version 70'
      );
    });

    it('returns null when no ENVIRONMENT_ISSUE marker present', () => {
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      assert.equal(gate._parseEnvironmentIssue('I fixed the bug in line 42.'), null);
    });

    it('returns null for null/undefined response', () => {
      const { o } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      assert.equal(gate._parseEnvironmentIssue(null), null);
      assert.equal(gate._parseEnvironmentIssue(undefined), null);
    });
  });

  describe('handleProjectRepair — environment issue', () => {
    it('detects ENVIRONMENT_ISSUE and skips recheck', async () => {
      healthChecker.runHealthCheck = async () => ({
        passed: false,
        results: [{ command: 'xcodebuild ...', exitCode: 1, stderr: 'error: modulemap not found', stdout: '' }]
      });

      // Morgan returns an environment issue
      delete require.cache[require.resolve('../agents/agent-session')];
      require.cache[require.resolve('../agents/agent-session')] = {
        id: require.resolve('../agents/agent-session'),
        filename: require.resolve('../agents/agent-session'),
        loaded: true,
        exports: {
          AgentSession: {
            createMorganSession: () => ({
              chat: async () => ({
                success: true,
                cost: 0.5,
                response: 'The error is a toolchain issue.\n\nENVIRONMENT_ISSUE: xcodeproj gem 1.27.0 does not support Xcode 16.4 object version 70'
              })
            })
          }
        }
      };

      delete require.cache[require.resolve('./health-gate')];
      const { HealthGate: FreshGate } = require('./health-gate');

      let recheckCalled = false;
      const originalRunHealthCheck = healthChecker.runHealthCheck;
      let callCount = 0;

      healthChecker.runHealthCheck = async (...args) => {
        callCount++;
        if (callCount > 1) recheckCalled = true;
        return originalRunHealthCheck(...args);
      };

      const { o, logEntries } = createMockOrchestrator({
        stateMachine: {
          transition: async () => {},
          getState: () => ({ sessionId: 's1', preview: null }),
          update: async () => {}
        }
      });
      const gate = new FreshGate(o);

      // Mock pair fallback to avoid real pair mode
      gate.projectRepairPairFallback = async () => false;

      await gate.handleProjectRepair({
        passed: false,
        results: [{ command: 'xcodebuild', exitCode: 1, stderr: 'error', stdout: '' }]
      });

      assert.equal(recheckCalled, false, 'should NOT re-run health check after environment issue');
      assert.equal(logEntries.some(e => e.event === 'project_repair_environment_issue'), true);
    });
  });

  describe('runArchitectureCheck', () => {
    it('skips when already done', async () => {
      const { o, logEntries } = createMockOrchestrator({ architectureCheckDone: true });
      const gate = new HealthGateClass(o);

      await gate.runArchitectureCheck();
      assert.equal(logEntries.length, 0);
    });

    it('skips when no tech stack specified', async () => {
      const { o, logEntries } = createMockOrchestrator({ techStack: 'Not specified' });
      const gate = new HealthGateClass(o);

      await gate.runArchitectureCheck();
      assert.equal(logEntries.length, 0);
    });

    it('logs architecture_validated on APPROVE', async () => {
      const { o, logEntries } = createMockOrchestrator();
      const gate = new HealthGateClass(o);

      await gate.runArchitectureCheck();
      assert.equal(logEntries.some(e => e.event === 'architecture_validated'), true);
      assert.equal(o._architectureCheckDone, true);
    });

    it('logs architecture_mismatch on REQUEST_CHANGES', async () => {
      const { o, logEntries } = createMockOrchestrator({
        agentRunner: {
          runAgent: async () => ({
            success: true, cost: 0.5, duration: 1000,
            output: JSON.stringify({ decision: 'REQUEST_CHANGES', summary: 'Wrong framework' })
          })
        }
      });
      const gate = new HealthGateClass(o);

      await gate.runArchitectureCheck();
      assert.equal(logEntries.some(e => e.event === 'architecture_mismatch'), true);
    });

    it('handles agent failure gracefully', async () => {
      const { o, logEntries } = createMockOrchestrator({
        agentRunner: {
          runAgent: async () => ({ success: false, cost: 0.1, duration: 100, error: 'timeout' })
        }
      });
      const gate = new HealthGateClass(o);

      await gate.runArchitectureCheck();
      assert.equal(logEntries.some(e => e.event === 'architecture_check_failed'), true);
    });
  });

  describe('runPreviewCheck', () => {
    it('does nothing when no preview config', async () => {
      const { o, logEntries } = createMockOrchestrator({ preview: null });
      const gate = new HealthGateClass(o);

      await gate.runPreviewCheck();
      assert.equal(logEntries.length, 0);
    });

    it('updates state when preview becomes available', async () => {
      // Mock preview-checker
      delete require.cache[require.resolve('./preview-checker')];
      require.cache[require.resolve('./preview-checker')] = {
        id: require.resolve('./preview-checker'),
        filename: require.resolve('./preview-checker'),
        loaded: true,
        exports: {
          checkPreview: async () => ({ available: true, responseTimeMs: 50 })
        }
      };

      let updatedState = null;
      const { o, logEntries } = createMockOrchestrator({
        preview: { command: 'npm run dev', port: 3000 },
        previewState: { available: false },
        stateMachine: {
          getState: () => ({ sessionId: 's1', preview: { available: false } }),
          update: async (patch) => { updatedState = patch; },
          transition: async () => {}
        },
        lastMergedReqId: 'req-1'
      });
      const gate = new HealthGateClass(o);

      // Re-require health-gate to pick up the mocked preview-checker
      delete require.cache[require.resolve('./health-gate')];
      const { HealthGate: FreshHealthGate } = require('./health-gate');
      const freshGate = new FreshHealthGate(o);

      await freshGate.runPreviewCheck();
      assert.notEqual(updatedState, null);
      assert.equal(updatedState.preview.available, true);
    });
  });
});
