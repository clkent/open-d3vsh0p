const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { StateMachine, VALID_TRANSITIONS, STATES, createInitialState } = require('./state-machine');

describe('createInitialState', () => {
  it('creates correct state structure', () => {
    const state = createInitialState('proj-1', '/tmp/proj', 'sess-1');

    assert.equal(state.version, 2);
    assert.equal(state.sessionId, 'sess-1');
    assert.equal(state.projectId, 'proj-1');
    assert.equal(state.projectDir, '/tmp/proj');
    assert.equal(state.sessionBranch, 'devshop/session-sess-1');
    assert.equal(state.state, 'IDLE');
    assert.equal(state.currentRequirement, null);
    assert.equal(state.currentPhase, null);
    assert.deepEqual(state.activeAgents, []);
    assert.deepEqual(state.completedMicrocycles, []);
  });

  it('has retryCounters with correct defaults', () => {
    const state = createInitialState('p', '/d', 's');

    assert.deepEqual(state.retryCounters, {
      implementation: { current: 0, max: 3 },
      testFix: { current: 0, max: 3 },
      reviewFix: { current: 0, max: 2 }
    });
  });

  it('has zeroed consumption counters', () => {
    const state = createInitialState('p', '/d', 's');

    assert.deepEqual(state.consumption, {
      totalCostUsd: 0,
      totalDurationMs: 0,
      agentInvocations: 0
    });
  });
});

describe('VALID_TRANSITIONS', () => {
  it('allows IDLE → SELECTING_REQUIREMENT', () => {
    assert.ok(VALID_TRANSITIONS.IDLE.includes('SELECTING_REQUIREMENT'));
  });

  it('allows IDLE → LOADING_ROADMAP', () => {
    assert.ok(VALID_TRANSITIONS.IDLE.includes('LOADING_ROADMAP'));
  });

  it('rejects IDLE → COMMITTING (not a valid transition)', () => {
    assert.ok(!VALID_TRANSITIONS.IDLE.includes('COMMITTING'));
  });

  it('has no transitions from SESSION_COMPLETE (terminal)', () => {
    assert.deepEqual(VALID_TRANSITIONS.SESSION_COMPLETE, []);
  });

  it('allows PARKING → BLOCKING_FIX', () => {
    assert.ok(VALID_TRANSITIONS.PARKING.includes('BLOCKING_FIX'));
  });

  it('allows BLOCKING_FIX → SESSION_COMPLETE', () => {
    assert.ok(VALID_TRANSITIONS.BLOCKING_FIX.includes('SESSION_COMPLETE'));
  });

  it('BLOCKING_FIX has only SESSION_COMPLETE as target', () => {
    assert.deepEqual(VALID_TRANSITIONS.BLOCKING_FIX, ['SESSION_COMPLETE']);
  });

  it('includes BLOCKING_FIX in STATES array', () => {
    assert.ok(STATES.includes('BLOCKING_FIX'));
  });

  it('allows SELECTING_REQUIREMENT → PROJECT_REPAIR', () => {
    assert.ok(VALID_TRANSITIONS.SELECTING_REQUIREMENT.includes('PROJECT_REPAIR'));
  });

  it('allows SELECTING_REQUIREMENT → BLOCKING_FIX', () => {
    assert.ok(VALID_TRANSITIONS.SELECTING_REQUIREMENT.includes('BLOCKING_FIX'));
  });

  it('allows PROJECT_REPAIR → SELECTING_REQUIREMENT', () => {
    assert.ok(VALID_TRANSITIONS.PROJECT_REPAIR.includes('SELECTING_REQUIREMENT'));
  });

  it('allows PROJECT_REPAIR → SESSION_COMPLETE', () => {
    assert.ok(VALID_TRANSITIONS.PROJECT_REPAIR.includes('SESSION_COMPLETE'));
  });

  it('includes PROJECT_REPAIR in STATES array', () => {
    assert.ok(STATES.includes('PROJECT_REPAIR'));
  });

  it('allows SESSION_COMPLETE from every non-IDLE, non-terminal state', () => {
    for (const state of STATES) {
      if (state === 'SESSION_COMPLETE' || state === 'IDLE') continue;
      assert.ok(
        VALID_TRANSITIONS[state].includes('SESSION_COMPLETE'),
        `${state} should allow transition to SESSION_COMPLETE`
      );
    }
  });
});

describe('StateMachine', () => {
  let sm;
  let writtenData;
  let fileContent;

  beforeEach(() => {
    writtenData = null;
    fileContent = null;

    // Mock fs/promises
    const fsMock = {
      mkdir: async () => {},
      writeFile: async (_path, data) => { writtenData = data; },
      rename: async () => {},
      readFile: async () => {
        if (fileContent) return fileContent;
        throw new Error('ENOENT');
      },
      access: async () => { throw new Error('ENOENT'); },
      unlink: async () => {}
    };

    sm = new StateMachine('/tmp/test-state.json');
    // Replace the private _writeToDisk and _ensureDir to use our mocks
    sm._ensureDir = async () => {};
    sm._writeToDisk = async () => {
      writtenData = JSON.stringify(sm.state, null, 2);
    };
  });

  describe('initialize', () => {
    it('creates state and persists', async () => {
      await sm.initialize('proj-1', '/tmp/proj', 'sess-1');

      assert.equal(sm.state.state, 'IDLE');
      assert.equal(sm.state.projectId, 'proj-1');
      assert.ok(writtenData, 'should have written to disk');
    });

    it('applies custom retry limits from config', async () => {
      await sm.initialize('p', '/d', 's', {
        retryLimits: { implementation: 5, testFix: 4, reviewFix: 1 }
      });

      assert.equal(sm.state.retryCounters.implementation.max, 5);
      assert.equal(sm.state.retryCounters.testFix.max, 4);
      assert.equal(sm.state.retryCounters.reviewFix.max, 1);
    });
  });

  describe('transition', () => {
    it('performs valid transition and updates state', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');

      assert.equal(sm.state.state, 'SELECTING_REQUIREMENT');
    });

    it('sets updatedAt on transition', async () => {
      await sm.initialize('p', '/d', 's');
      const before = sm.state.updatedAt;

      // Small delay to ensure time difference
      await new Promise(r => setTimeout(r, 5));
      await sm.transition('SELECTING_REQUIREMENT');

      assert.notEqual(sm.state.updatedAt, before);
    });

    it('applies updates alongside transition', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT', {
        currentRequirement: { id: 'req-1' }
      });

      assert.deepEqual(sm.state.currentRequirement, { id: 'req-1' });
    });

    it('rejects invalid transition with error', async () => {
      await sm.initialize('p', '/d', 's');

      await assert.rejects(
        () => sm.transition('COMMITTING'),
        { message: /Invalid transition: IDLE → COMMITTING/ }
      );
    });

    it('rejects unknown state', async () => {
      await sm.initialize('p', '/d', 's');

      await assert.rejects(
        () => sm.transition('NONEXISTENT'),
        { message: /Unknown state: NONEXISTENT/ }
      );
    });

    it('throws when not initialized', async () => {
      await assert.rejects(
        () => sm.transition('IDLE'),
        { message: /not initialized/ }
      );
    });

    it('persists after transition', async () => {
      await sm.initialize('p', '/d', 's');
      writtenData = null;
      await sm.transition('SELECTING_REQUIREMENT');

      assert.ok(writtenData, 'should have written to disk');
      const parsed = JSON.parse(writtenData);
      assert.equal(parsed.state, 'SELECTING_REQUIREMENT');
    });
  });

  describe('update', () => {
    it('changes data without changing state field', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.update({ consumption: { totalCostUsd: 5 } });

      assert.equal(sm.state.state, 'IDLE');
      assert.equal(sm.state.consumption.totalCostUsd, 5);
    });

    it('throws when not initialized', async () => {
      await assert.rejects(
        () => sm.update({}),
        { message: /not initialized/ }
      );
    });
  });

  describe('isTerminal', () => {
    it('returns true for SESSION_COMPLETE', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');
      await sm.transition('SESSION_COMPLETE');

      assert.equal(sm.isTerminal(), true);
    });

    it('returns false for non-terminal states', async () => {
      await sm.initialize('p', '/d', 's');

      assert.equal(sm.isTerminal(), false);
    });

    it('returns falsy when state is null', () => {
      assert.ok(!sm.isTerminal());
    });
  });

  describe('getState', () => {
    it('returns current state object', async () => {
      await sm.initialize('p', '/d', 's');
      const state = sm.getState();

      assert.equal(state.projectId, 'p');
      assert.equal(state.state, 'IDLE');
    });
  });

  describe('BLOCKING_FIX transitions', () => {
    it('transitions PARKING → BLOCKING_FIX → SESSION_COMPLETE', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');
      await sm.transition('IMPLEMENTING');
      await sm.transition('PARKING');
      await sm.transition('BLOCKING_FIX');

      assert.equal(sm.state.state, 'BLOCKING_FIX');

      await sm.transition('SESSION_COMPLETE');
      assert.equal(sm.state.state, 'SESSION_COMPLETE');
    });

    it('transitions SELECTING_REQUIREMENT → BLOCKING_FIX → SESSION_COMPLETE (parallel orchestrator path)', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');
      await sm.transition('BLOCKING_FIX');

      assert.equal(sm.state.state, 'BLOCKING_FIX');

      await sm.transition('SESSION_COMPLETE');
      assert.equal(sm.state.state, 'SESSION_COMPLETE');
    });

    it('rejects BLOCKING_FIX → SELECTING_REQUIREMENT (not allowed)', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');
      await sm.transition('IMPLEMENTING');
      await sm.transition('PARKING');
      await sm.transition('BLOCKING_FIX');

      await assert.rejects(
        () => sm.transition('SELECTING_REQUIREMENT'),
        { message: /Invalid transition: BLOCKING_FIX → SELECTING_REQUIREMENT/ }
      );
    });
  });

  describe('PROJECT_REPAIR transitions', () => {
    it('transitions SELECTING_REQUIREMENT → PROJECT_REPAIR → SELECTING_REQUIREMENT', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');
      await sm.transition('PROJECT_REPAIR');

      assert.equal(sm.state.state, 'PROJECT_REPAIR');

      await sm.transition('SELECTING_REQUIREMENT');
      assert.equal(sm.state.state, 'SELECTING_REQUIREMENT');
    });

    it('transitions PROJECT_REPAIR → SESSION_COMPLETE', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');
      await sm.transition('PROJECT_REPAIR');
      await sm.transition('SESSION_COMPLETE');

      assert.equal(sm.state.state, 'SESSION_COMPLETE');
    });

    it('rejects PROJECT_REPAIR → IMPLEMENTING (not allowed)', async () => {
      await sm.initialize('p', '/d', 's');
      await sm.transition('SELECTING_REQUIREMENT');
      await sm.transition('PROJECT_REPAIR');

      await assert.rejects(
        () => sm.transition('IMPLEMENTING'),
        { message: /Invalid transition: PROJECT_REPAIR → IMPLEMENTING/ }
      );
    });

    it('rejects IDLE → PROJECT_REPAIR (not allowed)', async () => {
      await sm.initialize('p', '/d', 's');

      await assert.rejects(
        () => sm.transition('PROJECT_REPAIR'),
        { message: /Invalid transition: IDLE → PROJECT_REPAIR/ }
      );
    });
  });
});
