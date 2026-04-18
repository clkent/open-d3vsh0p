const fs = require('fs/promises');
const path = require('path');

const VALID_TRANSITIONS = {
  IDLE:                    ['SELECTING_REQUIREMENT', 'LOADING_ROADMAP'],
  LOADING_ROADMAP:         ['EXECUTING_PHASE', 'SESSION_COMPLETE'],
  EXECUTING_PHASE:         ['PHASE_COMPLETE', 'SESSION_COMPLETE'],
  PHASE_COMPLETE:          ['EXECUTING_PHASE', 'SESSION_COMPLETE'],
  SELECTING_REQUIREMENT:   ['IMPLEMENTING', 'PROJECT_REPAIR', 'BLOCKING_FIX', 'SESSION_COMPLETE'],
  PROJECT_REPAIR:          ['SELECTING_REQUIREMENT', 'SESSION_COMPLETE'],
  IMPLEMENTING:            ['RUNNING_TESTS', 'IMPLEMENTING', 'PARKING', 'SESSION_COMPLETE'],
  RUNNING_TESTS:           ['COMMITTING', 'IMPLEMENTING', 'PARKING', 'SESSION_COMPLETE'],
  COMMITTING:              ['REVIEWING', 'SESSION_COMPLETE'],
  REVIEWING:               ['MERGING', 'IMPLEMENTING', 'PARKING', 'SESSION_COMPLETE'],
  MERGING:                 ['SELECTING_REQUIREMENT', 'SESSION_COMPLETE'],
  PARKING:                 ['SELECTING_REQUIREMENT', 'BLOCKING_FIX', 'SESSION_COMPLETE'],
  BLOCKING_FIX:            ['SESSION_COMPLETE'],
  SESSION_COMPLETE:        []
};

const STATES = Object.keys(VALID_TRANSITIONS);

function createInitialState(projectId, projectDir, sessionId) {
  const sessionBranch = `devshop/session-${sessionId}`;
  return {
    version: 2,
    sessionId,
    projectId,
    projectDir,
    sessionBranch,
    state: 'IDLE',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentRequirement: null,
    currentPhase: null,
    activeAgents: [],
    requirements: {
      pending: [],
      inProgress: null,
      completed: [],
      parked: []
    },
    retryCounters: {
      implementation: { current: 0, max: 3 },
      testFix: { current: 0, max: 3 },
      reviewFix: { current: 0, max: 2 }
    },
    consumption: {
      totalCostUsd: 0,
      totalDurationMs: 0,
      agentInvocations: 0
    },
    completedMicrocycles: []
  };
}

class StateMachine {
  constructor(stateFilePath) {
    this.stateFilePath = stateFilePath;
    this.state = null;
  }

  async load() {
    try {
      // Check for temp file first (crash recovery)
      const tmpPath = this.stateFilePath + '.tmp';
      try {
        await fs.access(tmpPath);
        // Temp file exists — previous write was interrupted. Remove it.
        await fs.unlink(tmpPath);
      } catch {
        // No temp file, good
      }

      const raw = await fs.readFile(this.stateFilePath, 'utf-8');
      this.state = JSON.parse(raw);

      // Migrate v1 → v2 state
      if (!this.state.version || this.state.version < 2) {
        this.state.version = 2;
        if (!this.state.currentPhase) this.state.currentPhase = null;
        if (!this.state.activeAgents) this.state.activeAgents = [];
        await this._writeToDisk();
      }

      return this.state;
    } catch {
      return null;
    }
  }

  async initialize(projectId, projectDir, sessionId, config) {
    this.state = createInitialState(projectId, projectDir, sessionId);

    // Apply retry limits from config
    if (config && config.retryLimits) {
      this.state.retryCounters.implementation.max = config.retryLimits.implementation || 3;
      this.state.retryCounters.testFix.max = config.retryLimits.testFix || 3;
      this.state.retryCounters.reviewFix.max = config.retryLimits.reviewFix || 2;
    }

    await this._ensureDir();
    await this._writeToDisk();
    return this.state;
  }

  async transition(newState, updates = {}) {
    if (!this.state) {
      throw new Error('State machine not initialized. Call load() or initialize() first.');
    }

    if (!STATES.includes(newState)) {
      throw new Error(`Unknown state: ${newState}`);
    }

    const allowed = VALID_TRANSITIONS[this.state.state];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid transition: ${this.state.state} → ${newState}. ` +
        `Allowed: ${allowed.join(', ') || '(none — terminal state)'}`
      );
    }

    // Apply updates
    this.state = {
      ...this.state,
      ...updates,
      state: newState,
      updatedAt: new Date().toISOString()
    };

    // Deep merge nested objects that were explicitly passed
    if (updates.requirements) {
      this.state.requirements = { ...this.state.requirements, ...updates.requirements };
    }
    if (updates.retryCounters) {
      this.state.retryCounters = { ...this.state.retryCounters, ...updates.retryCounters };
    }
    if (updates.consumption) {
      this.state.consumption = { ...this.state.consumption, ...updates.consumption };
    }
    if (updates.currentRequirement && this.state.currentRequirement) {
      this.state.currentRequirement = { ...this.state.currentRequirement, ...updates.currentRequirement };
    }

    await this._writeToDisk();
    return this.state;
  }

  async update(updates) {
    if (!this.state) {
      throw new Error('State machine not initialized. Call load() or initialize() first.');
    }

    this.state = {
      ...this.state,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    if (updates.requirements) {
      this.state.requirements = { ...this.state.requirements, ...updates.requirements };
    }
    if (updates.consumption) {
      this.state.consumption = { ...this.state.consumption, ...updates.consumption };
    }

    await this._writeToDisk();
    return this.state;
  }

  getState() {
    return this.state;
  }

  isTerminal() {
    return this.state && this.state.state === 'SESSION_COMPLETE';
  }

  async _ensureDir() {
    await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true });
  }

  async _writeToDisk() {
    const tmpPath = this.stateFilePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
    await fs.rename(tmpPath, this.stateFilePath);
  }
}

// VALID_TRANSITIONS, STATES, createInitialState exported for testing
module.exports = { StateMachine, VALID_TRANSITIONS, STATES, createInitialState };
