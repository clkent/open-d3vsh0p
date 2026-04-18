const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Microcycle } = require('./microcycle');

function createMocks(overrides = {}) {
  const logEntries = [];
  const agentCalls = [];

  const logger = {
    log: async () => {},
    logCommit: async () => {},
    logMerge: async () => {},
    logAgentRun: async () => {},
    logTestRun: async () => {}
  };

  const monitor = {
    shouldStop: () => ({ stop: false }),
    recordInvocation: () => {}
  };

  const gitOps = {
    createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
    checkoutBranch: async () => {},
    commitAll: async () => 'abc123',
    getDiff: async () => 'diff content',
    getDiffStat: async () => '1 file changed',
    getLog: async () => '',
    _git: async (cwd, args) => {
      if (args[0] === 'rev-parse') return { stdout: 'abc123\n' };
      if (args[0] === 'status') return { stdout: '\n' };
      if (args[0] === 'diff') return { stdout: '\n' };
      return { stdout: '' };
    },
    ...overrides.gitOps
  };

  const templateEngine = {
    renderAgentPrompt: async () => 'system prompt',
    ...overrides.templateEngine
  };

  const openspec = {
    buildImplementationPrompt: () => 'implement this',
    buildRetryPrompt: () => 'retry this',
    buildReviewPrompt: () => 'review this',
    getDesignSkillsSection: async () => '',
    ...overrides.openspec
  };

  const STRUCTURED_APPROVE = JSON.stringify({
    decision: 'APPROVE',
    scores: { spec_adherence: 4, test_coverage: 4, code_quality: 4, security: 4, simplicity: 4 },
    summary: 'Looks good',
    issues: []
  });

  const agentRunner = {
    runAgent: async (opts) => {
      agentCalls.push(opts);
      return { success: true, cost: 0.50, duration: 1000, output: STRUCTURED_APPROVE };
    },
    ...overrides.agentRunner
  };

  const config = {
    retryLimits: { implementation: 3, implementationMaxAttempts: 7, testFix: 3, reviewFix: 2 },
    agents: {
      'implementation': { model: 'test', maxBudgetUsd: 5, timeoutMs: 60000, allowedTools: [] },
      'principal-engineer': { model: 'test', maxBudgetUsd: 2, timeoutMs: 60000, allowedTools: [] }
    },
    git: { commitPrefix: 'feat' },
    ...overrides.config
  };

  return {
    agentRunner, templateEngine, gitOps, openspec, logger, monitor, config,
    agentCalls, logEntries
  };
}

function createMicrocycle(mockOverrides = {}) {
  const mocks = createMocks(mockOverrides);
  const mc = new Microcycle({
    ...mocks,
    projectDir: '/proj',
    workingDir: '/proj',
    sessionBranch: 'devshop/session-s1',
    projectId: 'proj-001',
    techStack: 'Node.js',
    persona: 'implementation-agent'
  });
  return { mc, mocks };
}

const REQ = { id: 'user-auth', name: 'User Auth', changeName: 'add-user-auth', bullets: ['login'] };

describe('Microcycle', () => {
  describe('happy path', () => {
    it('implement → test → commit → review approve → merged result', async () => {
      const { mc } = createMicrocycle();

      // Mock _runTests to pass
      mc._runTests = async () => ({ passed: true, output: 'all pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.equal(result.error, null);
      assert.equal(result.commitSha, 'abc123');
      assert.ok(result.workBranch.includes('user-auth'));
    });

    it('returns correct cost accumulation', async () => {
      const approveJson = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 4, test_coverage: 4, code_quality: 4, security: 4, simplicity: 4 },
        summary: 'Good', issues: []
      });
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: true, cost: 1.25, duration: 1000, output: approveJson })
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      // Implementation + review = 2 agent calls
      assert.equal(result.cost, 2.50);
    });

    it('returns workBranch in result', async () => {
      const { mc } = createMicrocycle();
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.workBranch, 'devshop/work-s1/user-auth');
    });
  });

  describe('consumption limit', () => {
    it('parks when shouldStop() returns true', async () => {
      const { mc } = createMicrocycle({
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {}
        }
      });
      mc.monitor.shouldStop = () => ({ stop: true, reason: 'budget_exhausted' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.equal(result.error, 'budget_exhausted');
    });
  });

  describe('implementation retry', () => {
    it('retries on implementation failure', async () => {
      let implCount = 0;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            if (implCount <= 2) return { success: false, cost: 0.1, duration: 100, error: 'failed' };
            return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
          }
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.equal(result.attempts, 3);
    });

    it('parks after max implementation retries', async () => {
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: false, cost: 0.1, duration: 100, error: 'always fail' })
        }
      });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.ok(result.error.includes('Implementation retries exhausted'));
    });
  });

  describe('test failure', () => {
    it('retries on test failure', async () => {
      let testCount = 0;
      let implCount = 0;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            return { success: true, cost: 0.1, duration: 100, output: 'APPROVE' };
          }
        }
      });
      mc._runTests = async () => {
        testCount++;
        if (testCount <= 1) return { passed: false, output: 'test failed', summary: 'FAIL' };
        return { passed: true, output: 'pass', summary: 'PASS' };
      };

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.ok(result.attempts > 1);
    });

    it('parks after max testFix retries', async () => {
      const { mc } = createMicrocycle();
      mc._runTests = async () => ({ passed: false, output: 'always fails', summary: 'FAIL' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.ok(result.error.includes('Test fix retries exhausted'));
    });
  });

  describe('no changes', () => {
    it('retries when commitAll returns null and no agent commits detected', async () => {
      let commitCount = 0;
      const { mc } = createMicrocycle({
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {},
          commitAll: async () => {
            commitCount++;
            if (commitCount <= 1) return null;
            return 'abc123';
          },
          getDiff: async () => 'diff content',
          getDiffStat: async () => '1 file changed',
          getLog: async () => '' // no agent commits
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.ok(result.attempts > 1);
    });

    it('detects agent-committed via git log', async () => {
      const { mc } = createMicrocycle({
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {},
          commitAll: async () => null, // no changes to commit
          getDiff: async () => 'diff content',
          getDiffStat: async () => '1 file changed',
          getLog: async () => 'abc123 feat: something' // agent already committed
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.equal(result.commitSha, 'agent-committed');
    });
  });

  describe('review cycle', () => {
    it('retries on REQUEST_CHANGES', async () => {
      let reviewCount = 0;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async (opts) => {
            // Implementation calls always succeed
            if (!opts.userPrompt || !opts.userPrompt.includes || !opts.userPrompt.includes('review')) {
              return { success: true, cost: 0.1, duration: 100, output: 'done' };
            }
            reviewCount++;
            return { success: true, cost: 0.1, duration: 100, output: 'REQUEST_CHANGES: fix X' };
          }
        }
      });

      // Track which prompt type is used by the openspec mock
      let reviewCalls = 0;
      mc.openspec.buildReviewPrompt = () => { reviewCalls++; return 'review this'; };
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.ok(result.error.includes('Review retries exhausted'));
    });

    it('approves on APPROVE in output', async () => {
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: true, cost: 0.1, duration: 100, output: 'APPROVE - looks good' })
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
    });

    it('parses structured JSON APPROVE and returns reviewScores', async () => {
      const structuredOutput = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 5, test_coverage: 4, code_quality: 4, security: 5, simplicity: 4 },
        summary: 'Well done',
        issues: []
      });

      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: true, cost: 0.5, duration: 1000, output: structuredOutput })
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.ok(result.reviewScores);
      assert.equal(result.reviewScores.spec_adherence, 5);
      assert.equal(result.reviewScores.test_coverage, 4);
    });

    it('parses structured JSON REQUEST_CHANGES and includes issues in retry', async () => {
      let callCount = 0;
      const structuredReject = JSON.stringify({
        decision: 'REQUEST_CHANGES',
        scores: { spec_adherence: 3, test_coverage: 2, code_quality: 4, security: 5, simplicity: 4 },
        summary: 'Missing tests',
        issues: [{ severity: 'major', description: 'No edge case tests' }]
      });
      const structuredApprove = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 5, test_coverage: 5, code_quality: 4, security: 5, simplicity: 4 },
        summary: 'Fixed',
        issues: []
      });

      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            callCount++;
            // First 2 calls: implement + review (reject)
            // Third call: re-implement
            // Fourth call: review (approve)
            if (callCount === 2) return { success: true, cost: 0.1, duration: 100, output: structuredReject };
            if (callCount === 4) return { success: true, cost: 0.1, duration: 100, output: structuredApprove };
            return { success: true, cost: 0.1, duration: 100, output: 'done' };
          }
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
    });

    it('falls back to string matching when no JSON in review output', async () => {
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: true, cost: 0.1, duration: 100, output: 'APPROVE - looks great, no issues found' })
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.equal(result.reviewScores, null); // fallback has no scores
    });

    it('auto-approves on empty diff', async () => {
      const { mc } = createMicrocycle({
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {},
          commitAll: async () => 'abc123',
          getDiff: async () => '  ', // empty diff (whitespace only)
          getDiffStat: async () => ''
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
    });
  });

  describe('TECH_STACK in review', () => {
    it('passes TECH_STACK to principal-engineer template variables', async () => {
      let capturedVars = null;
      const { mc } = createMicrocycle({
        templateEngine: {
          renderAgentPrompt: async (agent, vars) => {
            if (agent === 'principal-engineer') capturedVars = vars;
            return 'system prompt';
          }
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);
      assert.ok(capturedVars, 'principal-engineer should have been called');
      assert.equal(capturedVars.TECH_STACK, 'Node.js');
      assert.equal(capturedVars.PROJECT_ID, 'proj-001');
      assert.equal(capturedVars.PROJECT_DIR, '/proj');
    });

    it('defaults TECH_STACK to "Not specified" when not provided', async () => {
      let capturedVars = null;
      const mocks = createMocks({
        templateEngine: {
          renderAgentPrompt: async (agent, vars) => {
            if (agent === 'principal-engineer') capturedVars = vars;
            return 'system prompt';
          }
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        // techStack omitted
        persona: 'implementation-agent'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(capturedVars.TECH_STACK, 'Not specified');
    });
  });

  describe('progress events', () => {
    it('emits implementing → testing → committing → reviewing on happy path', async () => {
      const logEntries = [];
      const mocks = createMocks();
      mocks.logger.log = async (level, event, data) => {
        logEntries.push({ level, event, data });
      };
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        personaName: 'Jordan'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      const progress = logEntries
        .filter(e => e.event === 'microcycle_progress')
        .map(e => e.data.phase);

      assert.deepEqual(progress, ['implementing', 'testing', 'committing', 'reviewing']);

      // Verify metadata on first implementing progress event
      const first = logEntries.find(e => e.event === 'microcycle_progress' && e.data.phase === 'implementing');
      assert.equal(first.data.requirementId, 'user-auth');
      assert.equal(first.data.persona, 'Jordan');
      assert.ok(first.data.thought.includes('user-auth'));
    });

    it('emits retrying_tests with thought on test failure', async () => {
      let testCount = 0;
      const logEntries = [];
      const mocks = createMocks();
      mocks.logger.log = async (level, event, data) => {
        logEntries.push({ level, event, data });
      };
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        personaName: 'Jordan'
      });

      mc._runTests = async () => {
        testCount++;
        if (testCount <= 1) return { passed: false, output: 'test failed', summary: 'FAIL: 2 tests' };
        return { passed: true, output: 'pass', summary: 'PASS' };
      };

      await mc.run('user-auth', 'add-user-auth', REQ);

      const retryTest = logEntries.find(
        e => e.event === 'microcycle_progress' && e.data.phase === 'retrying_tests'
      );
      assert.ok(retryTest, 'should emit retrying_tests');
      assert.ok(retryTest.data.thought.includes('Tests failed'));
    });

    it('emits retrying_review with Morgan feedback in thought', async () => {
      let callCount = 0;
      const logEntries = [];
      const rejectOutput = JSON.stringify({
        decision: 'REQUEST_CHANGES',
        scores: { spec_adherence: 3 },
        summary: 'Missing error handling',
        issues: [{ severity: 'major', description: 'No try/catch' }]
      });
      const approveOutput = JSON.stringify({
        decision: 'APPROVE',
        scores: { spec_adherence: 5 },
        summary: 'Fixed',
        issues: []
      });

      const mocks = createMocks({
        agentRunner: {
          runAgent: async () => {
            callCount++;
            if (callCount === 2) return { success: true, cost: 0.1, duration: 100, output: rejectOutput };
            if (callCount === 4) return { success: true, cost: 0.1, duration: 100, output: approveOutput };
            return { success: true, cost: 0.1, duration: 100, output: 'done' };
          }
        }
      });
      mocks.logger.log = async (level, event, data) => {
        logEntries.push({ level, event, data });
      };
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        personaName: 'Jordan'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      const retryReview = logEntries.find(
        e => e.event === 'microcycle_progress' && e.data.phase === 'retrying_review'
      );
      assert.ok(retryReview, 'should emit retrying_review');
      assert.ok(retryReview.data.thought.includes('Morgan flagged'));
      assert.ok(retryReview.data.thought.includes('Missing error handling'));
    });

    it('emits retrying_implementation with thought on agent failure', async () => {
      let implCount = 0;
      const logEntries = [];
      const mocks = createMocks({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            if (implCount <= 1) return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
            return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
          }
        }
      });
      mocks.logger.log = async (level, event, data) => {
        logEntries.push({ level, event, data });
      };
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        personaName: 'Jordan'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      const retryImpl = logEntries.find(
        e => e.event === 'microcycle_progress' && e.data.phase === 'retrying_implementation'
      );
      assert.ok(retryImpl, 'should emit retrying_implementation');
      assert.ok(retryImpl.data.thought.includes('trying again'));
    });
  });

  describe('salvage check', () => {
    it('salvages when agent fails but tests pass and commits exist', async () => {
      let callCount = 0;
      const logEntries = [];
      const mocks = createMocks({
        agentRunner: {
          runAgent: async () => {
            callCount++;
            // First call: implementation fails
            if (callCount === 1) return { success: false, cost: 0.5, duration: 1000, error: 'prompt too long' };
            // Second call: review approves
            return { success: true, cost: 0.1, duration: 100, output: 'APPROVE' };
          }
        },
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {},
          commitAll: async () => null, // nothing new to commit
          getDiff: async () => 'diff content',
          getDiffStat: async () => '3 files changed',
          getLog: async () => 'abc123 feat: implement user-auth' // agent already committed
        }
      });
      mocks.logger.log = async (level, event, data) => {
        logEntries.push({ level, event, data });
      };
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        personaName: 'Jordan'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');

      const salvaged = logEntries.find(e => e.event === 'implementation_salvaged');
      assert.ok(salvaged, 'should log implementation_salvaged');
      assert.equal(salvaged.data.requirementId, 'user-auth');
      assert.equal(salvaged.data.originalError, 'prompt too long');
    });

    it('does not salvage when no commits on work branch', async () => {
      let implCount = 0;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            if (implCount <= 1) return { success: false, cost: 0.1, duration: 100, error: 'failed' };
            return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
          }
        },
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {},
          commitAll: async () => 'abc123',
          getDiff: async () => 'diff content',
          getDiffStat: async () => '1 file changed',
          getLog: async () => '' // no commits — salvage should not activate
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.equal(result.attempts, 2); // retried, not salvaged
    });

    it('does not salvage when commits exist but tests fail', async () => {
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: false, cost: 0.1, duration: 100, error: 'context overflow' })
        },
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {},
          commitAll: async () => 'abc123',
          getDiff: async () => 'diff content',
          getDiffStat: async () => '1 file changed',
          getLog: async () => 'abc123 feat: partial work' // commits exist
        }
      });
      // Tests fail — salvage should not activate
      mc._runTests = async () => ({ passed: false, output: 'test failed', summary: 'FAIL' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.ok(result.error.includes('Implementation retries exhausted'));
    });

    it('includes salvaged and workBranch in parked result when salvage succeeds but review fails', async () => {
      let callCount = 0;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            callCount++;
            // First call: implementation fails (triggers salvage)
            if (callCount === 1) return { success: false, cost: 0.5, duration: 1000, error: 'prompt too long' };
            // All review calls: reject
            return { success: true, cost: 0.1, duration: 100, output: 'REQUEST_CHANGES: needs work' };
          }
        },
        gitOps: {
          createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
          checkoutBranch: async () => {},
          commitAll: async () => null,
          getDiff: async () => 'diff content',
          getDiffStat: async () => '3 files changed',
          getLog: async () => 'abc123 feat: implement user-auth'
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.equal(result.salvaged, true);
      assert.equal(result.workBranch, 'devshop/work-s1/user-auth');
      assert.ok(result.error.includes('Review retries exhausted'));
    });

    it('does not include salvaged flag when salvage did not trigger', async () => {
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: false, cost: 0.1, duration: 100, error: 'always fail' })
        }
      });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.equal(result.salvaged, undefined);
      assert.equal(result.workBranch, undefined);
    });

    it('falls through to retry when salvage check throws', async () => {
      let implCount = 0;
      const logEntries = [];
      const mocks = createMocks({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            if (implCount <= 1) return { success: false, cost: 0.1, duration: 100, error: 'failed' };
            return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
          }
        }
      });
      mocks.logger.log = async (level, event, data) => {
        logEntries.push({ level, event, data });
      };
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        personaName: 'Jordan'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });
      // Make _trySalvage throw
      mc._trySalvage = async () => { throw new Error('git exploded'); };

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.equal(result.attempts, 2); // retried normally

      const warning = logEntries.find(e => e.event === 'salvage_check_failed');
      assert.ok(warning, 'should log salvage_check_failed warning');
      assert.equal(warning.data.error, 'git exploded');
    });
  });

  describe('template vars (no convention/gotcha injection)', () => {
    it('does not pass PROJECT_GOTCHAS or PROJECT_CONVENTIONS to template variables', async () => {
      let capturedVars = null;
      const mocks = createMocks({
        templateEngine: {
          renderAgentPrompt: async (agent, vars) => {
            if (agent === 'implementation-agent') capturedVars = vars;
            return 'system prompt';
          }
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        gotchas: '- Never use require() for ESM modules',
        conventions: '## Testing\nUse node:test'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);
      assert.ok(capturedVars, 'implementation agent should have been called');
      assert.equal(capturedVars.PROJECT_GOTCHAS, undefined,
        'should not inject PROJECT_GOTCHAS — agents read CLAUDE.md natively');
      assert.equal(capturedVars.PROJECT_CONVENTIONS, undefined,
        'should not inject PROJECT_CONVENTIONS — agents read CLAUDE.md natively');
    });

    it('calls buildImplementationPrompt without codebaseContext', async () => {
      let capturedArgs = null;
      const { mc } = createMicrocycle({
        openspec: {

          buildImplementationPrompt: (...args) => { capturedArgs = args; return 'implement this'; },
          buildRetryPrompt: () => 'retry this',
          buildReviewPrompt: () => 'review this'
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedArgs, 'buildImplementationPrompt should have been called');
      assert.equal(capturedArgs[0], REQ);
      // Second arg should be preflightPlan (null), not codebaseContext
      assert.equal(capturedArgs[1], null);
    });

    it('calls buildRetryPrompt without codebaseContext', async () => {
      let implCount = 0;
      let capturedRetryArgs = null;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            if (implCount === 1) return { success: false, cost: 0.1, duration: 100, error: 'failed' };
            return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
          }
        },
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
          buildReviewPrompt: () => 'review this'
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
      // args: requirement, errorContext, attemptNumber, attemptHistory
      assert.equal(capturedRetryArgs[0], REQ);
      assert.equal(typeof capturedRetryArgs[1], 'string'); // errorContext
      assert.equal(capturedRetryArgs[2], 2); // attemptNumber
      assert.ok(Array.isArray(capturedRetryArgs[3])); // attemptHistory
    });
  });

  describe('_extractTestSummary', () => {
    it('extracts lines containing test keywords', () => {
      const mc = new Microcycle({
        agentRunner: {}, templateEngine: {}, gitOps: {}, openspec: {},
        logger: {}, monitor: {}, config: { retryLimits: {}, agents: {}, git: {} },
        projectDir: '/p', workingDir: '/p', sessionBranch: 's', projectId: 'x'
      });

      const output = 'Building...\nCompiling...\nTests: 5 passed\nTest Suites: 1 passed\nDone.';
      const summary = mc._extractTestSummary(output);
      assert.ok(summary.includes('Tests: 5 passed'));
      assert.ok(summary.includes('Test Suites: 1 passed'));
      assert.ok(!summary.includes('Building'));
    });

    it('falls back to last 500 chars when no keywords match', () => {
      const mc = new Microcycle({
        agentRunner: {}, templateEngine: {}, gitOps: {}, openspec: {},
        logger: {}, monitor: {}, config: { retryLimits: {}, agents: {}, git: {} },
        projectDir: '/p', workingDir: '/p', sessionBranch: 's', projectId: 'x'
      });

      const output = 'x'.repeat(600) + 'tail content';
      const summary = mc._extractTestSummary(output);
      assert.equal(summary.length, 500);
      assert.ok(summary.endsWith('tail content'));
    });
  });

  describe('phaseContext in review', () => {
    it('passes phaseContext to buildReviewPrompt', async () => {
      let capturedArgs = null;
      const { mc } = createMicrocycle({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: () => 'retry this',
          buildReviewPrompt: (...args) => { capturedArgs = args; return 'review this'; }
        }
      });

      mc.phaseContext = [
        { id: 'user-reg', description: 'User registration' },
        { id: 'password-reset', description: 'Password reset' }
      ];
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedArgs, 'buildReviewPrompt should have been called');
      assert.equal(capturedArgs.length, 5);
      assert.deepEqual(capturedArgs[3], [
        { id: 'user-reg', description: 'User registration' },
        { id: 'password-reset', description: 'Password reset' }
      ]);
      assert.equal(capturedArgs[4], ''); // designSkillsSection defaults to empty
    });

    it('passes empty phaseContext when none provided', async () => {
      let capturedArgs = null;
      const { mc } = createMicrocycle({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: () => 'retry this',
          buildReviewPrompt: (...args) => { capturedArgs = args; return 'review this'; }
        }
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedArgs, 'buildReviewPrompt should have been called');
      assert.deepEqual(capturedArgs[3], []);
      assert.equal(capturedArgs[4], ''); // designSkillsSection defaults to empty
    });
  });

  describe('parallel agent coordination', () => {
    it('passes peerContext and phaseContext to buildImplementationPrompt', async () => {
      let capturedImplArgs = null;
      const mocks = createMocks({
        openspec: {

          buildImplementationPrompt: (...args) => { capturedImplArgs = args; return 'implement this'; },
          buildRetryPrompt: () => 'retry this',
          buildReviewPrompt: () => 'review this'
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        peerContext: [
          { personaName: 'Taylor', requirementName: 'User Profile', bullets: ['Show profile'] }
        ],
        phaseContext: [
          { id: 'database-schema', description: 'Database schema setup' }
        ]
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedImplArgs, 'buildImplementationPrompt should have been called');
      // Third arg should be peerContext (codebaseContext removed)
      assert.ok(Array.isArray(capturedImplArgs[2]), 'peerContext should be an array');
      assert.equal(capturedImplArgs[2][0].personaName, 'Taylor');
      // Fourth arg should be phaseContext
      assert.ok(Array.isArray(capturedImplArgs[3]), 'phaseContext should be an array');
      assert.equal(capturedImplArgs[3][0].id, 'database-schema');
    });

    it('defaults peerContext to empty array when not provided', async () => {
      const { mc } = createMicrocycle();
      assert.deepEqual(mc.peerContext, []);
    });
  });

  describe('adaptive retry', () => {
    it('passes attemptNumber and attemptHistory to buildRetryPrompt on test failure', async () => {
      let testCount = 0;
      let capturedRetryArgs = null;
      const { mc } = createMicrocycle({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
          buildReviewPrompt: () => 'review this'
        }
      });
      mc._runTests = async () => {
        testCount++;
        if (testCount <= 1) return { passed: false, output: 'TypeError: x is undefined', summary: 'FAIL: 1 test' };
        return { passed: true, output: 'pass', summary: 'PASS' };
      };

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
      // args: requirement, errorContext, attemptNumber, attemptHistory
      const attemptNumber = capturedRetryArgs[2];
      const attemptHistory = capturedRetryArgs[3];
      assert.equal(attemptNumber, 2, 'should be attempt 2');
      assert.ok(Array.isArray(attemptHistory), 'attemptHistory should be an array');
      assert.equal(attemptHistory.length, 1, 'should have 1 history entry');
      assert.equal(attemptHistory[0].attempt, 1);
      assert.equal(attemptHistory[0].type, 'test');
    });

    it('accumulates attempt history across multiple failures', async () => {
      let implCount = 0;
      let lastRetryArgs = null;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            // First two impl calls fail, third succeeds
            if (implCount <= 2) return { success: false, cost: 0.1, duration: 100, error: 'TypeError: bad' };
            return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
          }
        },
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: (...args) => { lastRetryArgs = args; return 'retry this'; },
          buildReviewPrompt: () => 'review this'
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(lastRetryArgs, 'buildRetryPrompt should have been called');
      const attemptHistory = lastRetryArgs[3];
      assert.equal(attemptHistory.length, 2, 'should have 2 history entries');
      assert.equal(attemptHistory[0].attempt, 1);
      assert.equal(attemptHistory[1].attempt, 2);
    });

    it('includes failure pattern in parking error for consistent failures', async () => {
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => ({ success: false, cost: 0.1, duration: 100, error: 'TypeError: x is undefined' })
        }
      });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.ok(result.error.includes('Failure pattern:'), 'parking error should include failure pattern');
      assert.ok(result.error.includes('similar errors'), 'should detect consistent pattern');
    });

    it('includes failure pattern in parking error for varied failures', async () => {
      let implCount = 0;
      let testCount = 0;
      const { mc } = createMicrocycle({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            // First attempt: impl fails
            if (implCount === 1) return { success: false, cost: 0.1, duration: 100, error: 'SyntaxError: unexpected' };
            // All other attempts succeed impl but tests always fail
            return { success: true, cost: 0.1, duration: 100, output: 'APPROVE' };
          }
        }
      });
      mc._runTests = async () => {
        testCount++;
        return { passed: false, output: 'test timeout', summary: 'FAIL: timeout' };
      };

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.ok(result.error.includes('Failure pattern:'), 'parking error should include failure pattern');
      assert.ok(result.error.includes('different failure modes'), 'should detect varied pattern');
    });

    describe('_analyzeFailurePattern', () => {
      it('returns empty string for empty history', () => {
        const { mc } = createMicrocycle();
        assert.equal(mc._analyzeFailurePattern([]), '');
        assert.equal(mc._analyzeFailurePattern(null), '');
      });

      it('detects consistent failure pattern', () => {
        const { mc } = createMicrocycle();
        const history = [
          { attempt: 1, error: 'TypeError: x is undefined', type: 'implementation' },
          { attempt: 2, error: 'TypeError: y is null', type: 'implementation' }
        ];
        const result = mc._analyzeFailurePattern(history);
        assert.ok(result.includes('similar errors'));
        assert.ok(result.includes('TypeError'));
        assert.ok(result.includes('systemic issue'));
      });

      it('detects varied failure pattern', () => {
        const { mc } = createMicrocycle();
        const history = [
          { attempt: 1, error: 'SyntaxError: unexpected token', type: 'implementation' },
          { attempt: 2, error: 'Tests failed: 3 failures', type: 'test' },
          { attempt: 3, error: 'Review rejected: missing tests', type: 'review' }
        ];
        const result = mc._analyzeFailurePattern(history);
        assert.ok(result.includes('different failure modes'));
        assert.ok(result.includes('no consistent pattern'));
      });

      it('includes stall vs progress breakdown in pattern', () => {
        const { mc } = createMicrocycle();
        const history = [
          { attempt: 1, error: 'Timeout exceeded', type: 'implementation', madeProgress: true },
          { attempt: 2, error: 'Timeout exceeded', type: 'implementation', madeProgress: true },
          { attempt: 3, error: 'Timeout exceeded', type: 'implementation', madeProgress: false }
        ];
        const result = mc._analyzeFailurePattern(history);
        assert.ok(result.includes('2 of 3 attempts made progress'));
        assert.ok(result.includes('1 stalled'));
      });
    });

    describe('_snapshotWorktree', () => {
      it('returns head, status, and diffStat from git', async () => {
        const { mc } = createMicrocycle({
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async (cwd, args) => {
              if (args[0] === 'rev-parse') return { stdout: 'deadbeef\n' };
              if (args[0] === 'status') return { stdout: ' M src/index.js\n' };
              if (args[0] === 'diff') return { stdout: ' 1 file changed, 5 insertions\n' };
              return { stdout: '' };
            }
          }
        });

        const snapshot = await mc._snapshotWorktree();
        assert.equal(snapshot.head, 'deadbeef');
        assert.equal(snapshot.status, 'M src/index.js');
        assert.equal(snapshot.diffStat, '1 file changed, 5 insertions');
      });

      it('returns empty snapshot when git fails', async () => {
        const { mc } = createMicrocycle({
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async () => { throw new Error('git not found'); }
          }
        });

        const snapshot = await mc._snapshotWorktree();
        assert.equal(snapshot.head, '');
        assert.equal(snapshot.status, '');
        assert.equal(snapshot.diffStat, '');
      });
    });

    describe('_didMakeProgress', () => {
      it('returns true when HEAD changes', () => {
        const { mc } = createMicrocycle();
        const before = { head: 'aaa', status: '', diffStat: '' };
        const after = { head: 'bbb', status: '', diffStat: '' };
        assert.equal(mc._didMakeProgress(before, after), true);
      });

      it('returns true when status changes', () => {
        const { mc } = createMicrocycle();
        const before = { head: 'aaa', status: '', diffStat: '' };
        const after = { head: 'aaa', status: 'M file.js', diffStat: '' };
        assert.equal(mc._didMakeProgress(before, after), true);
      });

      it('returns true when diffStat changes', () => {
        const { mc } = createMicrocycle();
        const before = { head: 'aaa', status: '', diffStat: '' };
        const after = { head: 'aaa', status: '', diffStat: '1 file changed' };
        assert.equal(mc._didMakeProgress(before, after), true);
      });

      it('returns false when nothing changes', () => {
        const { mc } = createMicrocycle();
        const before = { head: 'aaa', status: 'M x', diffStat: 'stat' };
        const after = { head: 'aaa', status: 'M x', diffStat: 'stat' };
        assert.equal(mc._didMakeProgress(before, after), false);
      });
    });

    describe('stall vs progress parking', () => {
      it('parks after stallLimit stalled attempts (same as current behavior)', async () => {
        // All attempts stall (no worktree changes) → parks after 3 stalls
        const { mc } = createMicrocycle({
          agentRunner: {
            runAgent: async () => ({ success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' })
          }
        });

        const result = await mc.run('user-auth', 'add-user-auth', REQ);
        assert.equal(result.status, 'parked');
        assert.ok(result.error.includes('Implementation retries exhausted'));
      });

      it('does NOT park progress-making attempts under maxAttempts', async () => {
        // Agent makes progress each time (HEAD changes), so stallRetries stays 0.
        // With stallLimit=3 and maxAttempts=7, it should retry up to 7 times.
        let implCount = 0;
        let headCounter = 0;
        const { mc } = createMicrocycle({
          agentRunner: {
            runAgent: async () => {
              implCount++;
              if (implCount <= 4) return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
              return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
            }
          },
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async (cwd, args) => {
              // Return incrementing HEAD to simulate progress
              if (args[0] === 'rev-parse') return { stdout: `head${headCounter++}\n` };
              if (args[0] === 'status') return { stdout: '\n' };
              if (args[0] === 'diff') return { stdout: '\n' };
              return { stdout: '' };
            }
          }
        });
        mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

        const result = await mc.run('user-auth', 'add-user-auth', REQ);
        assert.equal(result.status, 'merged');
        assert.equal(result.attempts, 5); // 4 failed + 1 success
      });

      it('parks on mixed failures when stall limit reached', async () => {
        // 2 progress attempts, then 3 stalls → parks on stallLimit
        let implCount = 0;
        let gitCallCount = 0;
        const { mc } = createMicrocycle({
          agentRunner: {
            runAgent: async () => {
              implCount++;
              return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
            }
          },
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async (cwd, args) => {
              if (args[0] === 'rev-parse') {
                gitCallCount++;
                // First 2 attempts: HEAD changes (before/after differ) = progress
                // Remaining attempts: HEAD stays same = stall
                // Each attempt calls rev-parse twice (before + after)
                // Calls 1-2: attempt 1 before/after (different = progress)
                // Calls 3-4: attempt 2 before/after (different = progress)
                // Calls 5+: attempt 3+ before/after (same = stall)
                if (gitCallCount <= 4) return { stdout: `head${gitCallCount}\n` };
                return { stdout: 'stale\n' };
              }
              if (args[0] === 'status') return { stdout: '\n' };
              if (args[0] === 'diff') return { stdout: '\n' };
              return { stdout: '' };
            }
          }
        });

        const result = await mc.run('user-auth', 'add-user-auth', REQ);
        assert.equal(result.status, 'parked');
        // 2 progress + 3 stalls = 5 total attempts
        assert.equal(result.attempts, 5);
      });

      it('parks on maxAttempts even with continuous progress', async () => {
        // All attempts make progress (HEAD changes), but should park at maxAttempts=7
        let implCount = 0;
        let headCounter = 0;
        const { mc } = createMicrocycle({
          agentRunner: {
            runAgent: async () => {
              implCount++;
              return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
            }
          },
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async (cwd, args) => {
              if (args[0] === 'rev-parse') return { stdout: `head${headCounter++}\n` };
              if (args[0] === 'status') return { stdout: '\n' };
              if (args[0] === 'diff') return { stdout: '\n' };
              return { stdout: '' };
            }
          }
        });

        const result = await mc.run('user-auth', 'add-user-auth', REQ);
        assert.equal(result.status, 'parked');
        assert.equal(result.attempts, 7); // parks at maxAttempts=7
      });

      it('includes madeProgress flag in attemptHistory', async () => {
        let implCount = 0;
        let headCounter = 0;
        let capturedRetryArgs = null;
        const { mc } = createMicrocycle({
          agentRunner: {
            runAgent: async () => {
              implCount++;
              if (implCount <= 1) return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
              return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
            }
          },
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async (cwd, args) => {
              if (args[0] === 'rev-parse') return { stdout: `head${headCounter++}\n` };
              if (args[0] === 'status') return { stdout: '\n' };
              if (args[0] === 'diff') return { stdout: '\n' };
              return { stdout: '' };
            }
          },
          openspec: {
  
            buildImplementationPrompt: () => 'implement this',
            buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
            buildReviewPrompt: () => 'review this'
          }
        });
        mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

        await mc.run('user-auth', 'add-user-auth', REQ);

        assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
        const attemptHistory = capturedRetryArgs[3];
        assert.equal(attemptHistory.length, 1);
        assert.equal(attemptHistory[0].madeProgress, true);
      });

      it('emits implementation_stalled when no progress detected', async () => {
        const logEntries = [];
        const mocks = createMocks({
          agentRunner: {
            runAgent: async () => ({ success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' })
          }
        });
        mocks.logger.log = async (level, event, data) => {
          logEntries.push({ level, event, data });
        };
        const mc = new Microcycle({
          ...mocks,
          projectDir: '/proj',
          workingDir: '/proj',
          sessionBranch: 'devshop/session-s1',
          projectId: 'proj-001',
          techStack: 'Node.js',
          persona: 'implementation-agent',
          personaName: 'Jordan'
        });
  

        await mc.run('user-auth', 'add-user-auth', REQ);

        const stallEvents = logEntries.filter(e => e.event === 'implementation_stalled');
        assert.ok(stallEvents.length > 0, 'should emit implementation_stalled');
        assert.equal(stallEvents[0].data.requirementId, 'user-auth');
      });

      it('emits implementation_progress_detected when progress detected', async () => {
        let implCount = 0;
        let headCounter = 0;
        const logEntries = [];
        const mocks = createMocks({
          agentRunner: {
            runAgent: async () => {
              implCount++;
              if (implCount <= 1) return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
              return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
            }
          },
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async (cwd, args) => {
              if (args[0] === 'rev-parse') return { stdout: `head${headCounter++}\n` };
              if (args[0] === 'status') return { stdout: '\n' };
              if (args[0] === 'diff') return { stdout: '\n' };
              return { stdout: '' };
            }
          }
        });
        mocks.logger.log = async (level, event, data) => {
          logEntries.push({ level, event, data });
        };
        const mc = new Microcycle({
          ...mocks,
          projectDir: '/proj',
          workingDir: '/proj',
          sessionBranch: 'devshop/session-s1',
          projectId: 'proj-001',
          techStack: 'Node.js',
          persona: 'implementation-agent',
          personaName: 'Jordan'
        });
  
        mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

        await mc.run('user-auth', 'add-user-auth', REQ);

        const progressEvents = logEntries.filter(e => e.event === 'implementation_progress_detected');
        assert.ok(progressEvents.length > 0, 'should emit implementation_progress_detected');
        assert.equal(progressEvents[0].data.requirementId, 'user-auth');
      });

      it('includes continuation hint in retry prompt when previous attempt made progress', async () => {
        let implCount = 0;
        let headCounter = 0;
        let capturedRetryArgs = null;
        const { mc } = createMicrocycle({
          agentRunner: {
            runAgent: async () => {
              implCount++;
              if (implCount <= 1) return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
              return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
            }
          },
          gitOps: {
            createWorkBranch: async (dir, session, reqId) => `devshop/work-s1/${reqId}`,
            checkoutBranch: async () => {},
            commitAll: async () => 'abc123',
            getDiff: async () => 'diff content',
            getDiffStat: async () => '1 file changed',
            getLog: async () => '',
            _git: async (cwd, args) => {
              if (args[0] === 'rev-parse') return { stdout: `head${headCounter++}\n` };
              if (args[0] === 'status') return { stdout: '\n' };
              if (args[0] === 'diff') return { stdout: '\n' };
              return { stdout: '' };
            }
          },
          openspec: {
  
            buildImplementationPrompt: () => 'implement this',
            buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
            buildReviewPrompt: () => 'review this'
          }
        });
        mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

        await mc.run('user-auth', 'add-user-auth', REQ);

        assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
        const errorContext = capturedRetryArgs[1];
        assert.ok(errorContext.includes('previous attempt made progress'), 'should include continuation hint');
        assert.ok(errorContext.includes('do not start over'), 'should advise not to start over');
      });

      it('does NOT include continuation hint when previous attempt stalled', async () => {
        let implCount = 0;
        let capturedRetryArgs = null;
        const { mc } = createMicrocycle({
          agentRunner: {
            runAgent: async () => {
              implCount++;
              if (implCount <= 1) return { success: false, cost: 0.1, duration: 100, error: 'Timeout exceeded' };
              return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
            }
          },
          openspec: {
  
            buildImplementationPrompt: () => 'implement this',
            buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
            buildReviewPrompt: () => 'review this'
          }
        });
        mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

        await mc.run('user-auth', 'add-user-auth', REQ);

        assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
        const errorContext = capturedRetryArgs[1];
        assert.ok(!errorContext.includes('previous attempt made progress'), 'should NOT include continuation hint for stalled attempt');
      });
    });
  });

  describe('priorWorkDiff in cross-session retry', () => {
    it('includes prior work diff in retry prompt when available with failureHistory', async () => {
      let capturedRetryArgs = null;
      const mocks = createMocks({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
          buildReviewPrompt: () => 'review this'
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        failureHistory: { attempts: 2, costUsd: 3.50, reason: 'Timeout exceeded' },
        priorWorkDiff: {
          diffStat: ' src/auth.js | 25 +++\n 1 file changed',
          diff: 'diff --git a/src/auth.js\n+module.exports = { login };'
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
      const errorContext = capturedRetryArgs[1];
      assert.ok(errorContext.includes('Prior Work From Previous Session'));
      assert.ok(errorContext.includes('infrastructure issue'));
      assert.ok(errorContext.includes('do not rewrite from scratch'));
      assert.ok(errorContext.includes('src/auth.js'));
      assert.ok(errorContext.includes('module.exports = { login }'));
    });

    it('omits prior work diff section when priorWorkDiff is null', async () => {
      let capturedRetryArgs = null;
      const mocks = createMocks({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
          buildReviewPrompt: () => 'review this'
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        failureHistory: { attempts: 1, costUsd: 1.00, reason: 'Tests failed' },
        priorWorkDiff: null
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
      const errorContext = capturedRetryArgs[1];
      assert.ok(!errorContext.includes('Prior Work From Previous Session'));
    });

    it('omits prior work diff section when diff is empty string', async () => {
      let capturedRetryArgs = null;
      const mocks = createMocks({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: (...args) => { capturedRetryArgs = args; return 'retry this'; },
          buildReviewPrompt: () => 'review this'
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        failureHistory: { attempts: 1, costUsd: 1.00, reason: 'Timeout' },
        priorWorkDiff: { diffStat: '', diff: '' }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);

      assert.ok(capturedRetryArgs, 'buildRetryPrompt should have been called');
      const errorContext = capturedRetryArgs[1];
      assert.ok(!errorContext.includes('Prior Work From Previous Session'));
    });

    it('defaults priorWorkDiff to null when not provided', () => {
      const mocks = createMocks();
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001'
      });
      assert.equal(mc.priorWorkDiff, null);
    });
  });

  describe('convention check', () => {
    it('proceeds to review when convention check passes', async () => {
      let reviewCalled = false;
      const mocks = createMocks({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: () => 'retry this',
          buildReviewPrompt: () => { reviewCalled = true; return 'review this'; }
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        conventions: '## Testing\nUse node:test'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });
      // Convention check passes (no violations)
      mc._checkConventions = async () => ({ passed: true, violations: [] });

      await mc.run('user-auth', 'add-user-auth', REQ);
      assert.ok(reviewCalled, 'review should proceed when conventions pass');
    });

    it('retries when convention check finds violations', async () => {
      let implCount = 0;
      let conventionCheckCount = 0;
      const mocks = createMocks({
        agentRunner: {
          runAgent: async () => {
            implCount++;
            return { success: true, cost: 0.5, duration: 1000, output: 'APPROVE' };
          }
        }
      });
      const mc = new Microcycle({
        ...mocks,
        projectDir: '/proj',
        workingDir: '/proj',
        sessionBranch: 'devshop/session-s1',
        projectId: 'proj-001',
        techStack: 'Node.js',
        persona: 'implementation-agent',
        conventions: '## Testing\nUse vitest'
      });

      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });
      mc._checkConventions = async () => {
        conventionCheckCount++;
        if (conventionCheckCount <= 1) {
          return { passed: false, violations: ['Convention violation: uses jest but conventions specify vitest'] };
        }
        return { passed: true, violations: [] };
      };

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.ok(result.attempts > 1, 'should have retried');
    });

    it('skips convention check when no conventions set', async () => {
      let reviewCalled = false;
      const { mc } = createMicrocycle({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: () => 'retry this',
          buildReviewPrompt: () => { reviewCalled = true; return 'review this'; }
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });

      await mc.run('user-auth', 'add-user-auth', REQ);
      assert.ok(reviewCalled, 'review should proceed when no conventions');
    });
  });

  describe('import verification', () => {
    it('proceeds to tests when imports pass', async () => {
      let testsCalled = false;
      const { mc } = createMicrocycle();
      mc._runTests = async () => { testsCalled = true; return { passed: true, output: 'pass', summary: 'PASS' }; };
      mc._verifyImports = async () => ({ passed: true, errors: [] });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.ok(testsCalled, 'tests should run after imports pass');
    });

    it('retries implementation when imports fail', async () => {
      let verifyCount = 0;
      let retryPromptCalled = false;
      const { mc } = createMicrocycle({
        openspec: {

          buildImplementationPrompt: () => 'implement this',
          buildRetryPrompt: () => { retryPromptCalled = true; return 'retry this'; },
          buildReviewPrompt: () => 'review this'
        }
      });
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });
      mc._verifyImports = async () => {
        verifyCount++;
        if (verifyCount <= 1) {
          return { passed: false, errors: [`'./ghost' in src/index.ts:1 -- this file does not exist`] };
        }
        return { passed: true, errors: [] };
      };

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.ok(result.attempts > 1, 'should have retried');
      assert.ok(retryPromptCalled, 'retry prompt should be called with import error');
    });

    it('parks when import failures exhaust implementation retries', async () => {
      const { mc } = createMicrocycle();
      mc._runTests = async () => ({ passed: true, output: 'pass', summary: 'PASS' });
      mc._verifyImports = async () => ({
        passed: false,
        errors: [`'./phantom' in src/index.ts:1 -- this file does not exist`]
      });

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'parked');
      assert.ok(result.error.includes('Import verification failed'));
    });

    it('proceeds when verification itself throws (non-fatal)', async () => {
      let testsCalled = false;
      const { mc } = createMicrocycle();
      mc._runTests = async () => { testsCalled = true; return { passed: true, output: 'pass', summary: 'PASS' }; };
      mc._verifyImports = async () => { throw new Error('git not found'); };

      const result = await mc.run('user-auth', 'add-user-auth', REQ);
      assert.equal(result.status, 'merged');
      assert.ok(testsCalled, 'tests should run when verification errors');
    });
  });

});

