const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ParallelOrchestrator } = require('../parallel-orchestrator');

function createOrchestrator(overrides = {}) {
  const logs = [];
  const stateUpdates = [];

  const orch = new ParallelOrchestrator({
    projectDir: '/proj',
    projectId: 'proj-001',
    templatesDir: '/templates',
    resume: false
  });

  orch.logger = {
    log: async (level, event, data) => {
      logs.push({ level, event, data });
    }
  };

  orch.config = {
    agents: {
      triage: {
        model: 'test',
        maxBudgetUsd: 1.00,
        timeoutMs: 60000,
        allowedTools: ['Read', 'Glob', 'Grep']
      }
    }
  };

  orch.templateEngine = {
    renderAgentPrompt: async () => 'triage system prompt'
  };

  let parkedItems = overrides.parkedItems || [];
  let pendingItems = overrides.pendingItems || ['req-1', 'req-2'];

  orch.stateMachine = {
    getState: () => ({
      requirements: {
        parked: parkedItems,
        pending: pendingItems,
        completed: overrides.completedItems || []
      }
    }),
    update: async (updates) => {
      stateUpdates.push(updates);
      if (updates.requirements) {
        parkedItems = updates.requirements.parked;
        pendingItems = updates.requirements.pending;
      }
    }
  };

  orch.monitor = {
    recordInvocation: () => {}
  };

  orch.agentRunner = {
    runAgent: overrides.runAgent || (async () => ({
      success: true,
      cost: 0.50,
      duration: 5000,
      output: JSON.stringify({
        classifications: [
          { id: 'req-1', classification: 'BLOCKING', reason: 'Core dependency' }
        ]
      })
    }))
  };

  orch.roadmapReader = {
    getParkedItemsInPhase: (phase) => {
      return phase.groups?.[0]?.items?.filter(i => i.status === 'parked') || [];
    },
    markItemParked: async () => {},
    markItemComplete: async () => {}
  };

  orch.gitOps = {
    commitAll: async () => 'abc123'
  };

  return { orch, logs, stateUpdates };
}

describe('ItemTriage — triageParkedItems', () => {
  it('classifies unclassified parked items via triage agent', async () => {
    const { orch, logs, stateUpdates } = createOrchestrator({
      parkedItems: [
        { id: 'req-1', reason: 'Test failed' }
      ],
      runAgent: async () => ({
        success: true,
        cost: 0.50,
        duration: 5000,
        output: JSON.stringify({
          classifications: [
            { id: 'req-1', classification: 'BLOCKING', reason: 'Core API feature' }
          ]
        })
      })
    });

    const completedPhase = {
      number: 1,
      label: 'Core',
      groups: [{ items: [{ id: 'req-1', status: 'parked', description: 'Add auth' }] }]
    };
    const nextPhaseItems = [{ id: 'req-3', description: 'Add dashboard' }];

    await orch.triage.triageParkedItems(completedPhase, nextPhaseItems);

    assert.ok(logs.find(l => l.event === 'triage_started'));
    assert.ok(logs.find(l => l.event === 'triage_complete'));

    const update = stateUpdates.find(u => u.requirements);
    assert.ok(update);
    const classified = update.requirements.parked.find(p => p.id === 'req-1');
    assert.equal(classified.triageClassification, 'blocking');
  });

  it('skips already-classified items', async () => {
    let agentCalled = false;
    const { orch } = createOrchestrator({
      parkedItems: [
        { id: 'req-1', reason: 'Test failed', triageClassification: 'non_blocking' }
      ],
      runAgent: async () => {
        agentCalled = true;
        return { success: true, cost: 0, duration: 0, output: '{}' };
      }
    });

    const completedPhase = {
      number: 1,
      label: 'Core',
      groups: [{ items: [{ id: 'req-1', status: 'parked', description: 'Add auth' }] }]
    };

    await orch.triage.triageParkedItems(completedPhase, []);
    assert.equal(agentCalled, false, 'should not invoke agent for already-classified items');
  });

  it('falls back to blocking when triage agent fails', async () => {
    const { orch, logs, stateUpdates } = createOrchestrator({
      parkedItems: [
        { id: 'req-1', reason: 'Test failed' }
      ],
      runAgent: async () => ({
        success: false,
        error: 'Agent timed out',
        cost: 0,
        duration: 0,
        output: ''
      })
    });

    const completedPhase = {
      number: 1,
      label: 'Core',
      groups: [{ items: [{ id: 'req-1', status: 'parked', description: 'Add auth' }] }]
    };

    await orch.triage.triageParkedItems(completedPhase, [{ id: 'req-2', description: 'Next' }]);

    assert.ok(logs.find(l => l.event === 'triage_agent_failed'));
    assert.ok(logs.find(l => l.event === 'triage_fallback_blocking'));
  });

  it('falls back to blocking when template fails to load', async () => {
    const { orch, logs, stateUpdates } = createOrchestrator({
      parkedItems: [
        { id: 'req-1', reason: 'Test failed' }
      ]
    });

    orch.templateEngine.renderAgentPrompt = async () => {
      throw new Error('Template not found');
    };

    const completedPhase = {
      number: 1,
      label: 'Core',
      groups: [{ items: [{ id: 'req-1', status: 'parked', description: 'Add auth' }] }]
    };

    await orch.triage.triageParkedItems(completedPhase, [{ id: 'req-2', description: 'Next' }]);

    assert.ok(logs.find(l => l.event === 'triage_template_error'));
    assert.ok(logs.find(l => l.event === 'triage_fallback_blocking'));
  });
});

describe('ItemTriage — classifySingleItem', () => {
  it('returns classification from triage agent', async () => {
    const { orch } = createOrchestrator({
      runAgent: async () => ({
        success: true,
        cost: 0.20,
        duration: 3000,
        output: JSON.stringify({
          classifications: [
            { id: 'req-1', classification: 'NON_BLOCKING', reason: 'Optional feature' }
          ]
        })
      })
    });

    const result = await orch.triage.classifySingleItem('req-1', 'Build failed');
    assert.equal(result, 'non_blocking');
  });

  it('returns blocking when agent fails', async () => {
    const { orch } = createOrchestrator({
      runAgent: async () => ({
        success: false,
        error: 'Timeout',
        cost: 0,
        duration: 0,
        output: ''
      })
    });

    const result = await orch.triage.classifySingleItem('req-1', 'Build failed');
    assert.equal(result, 'blocking');
  });

  it('returns blocking when response is not valid JSON', async () => {
    const { orch } = createOrchestrator({
      runAgent: async () => ({
        success: true,
        cost: 0.10,
        duration: 1000,
        output: 'This is not JSON'
      })
    });

    const result = await orch.triage.classifySingleItem('req-1', 'Test failed');
    assert.equal(result, 'blocking');
  });

  it('returns blocking when template fails', async () => {
    const { orch } = createOrchestrator();
    orch.templateEngine.renderAgentPrompt = async () => {
      throw new Error('Template not found');
    };

    const result = await orch.triage.classifySingleItem('req-1', 'Test failed');
    assert.equal(result, 'blocking');
  });
});

describe('ItemTriage — markAllAsBlocking', () => {
  it('marks all specified items as blocking in state', async () => {
    const { orch, stateUpdates } = createOrchestrator({
      parkedItems: [
        { id: 'req-1', reason: 'fail 1' },
        { id: 'req-2', reason: 'fail 2' }
      ]
    });

    await orch.triage.markAllAsBlocking(
      [{ id: 'req-1' }, { id: 'req-2' }],
      'Triage agent failed'
    );

    const update = stateUpdates.find(u => u.requirements);
    assert.ok(update);
    assert.equal(update.requirements.parked[0].triageClassification, 'blocking');
    assert.equal(update.requirements.parked[1].triageClassification, 'blocking');
    assert.equal(update.requirements.parked[0].triageReason, 'Triage agent failed');
  });

  it('does not overwrite existing classifications', async () => {
    const { orch, stateUpdates } = createOrchestrator({
      parkedItems: [
        { id: 'req-1', reason: 'fail 1', triageClassification: 'non_blocking' },
        { id: 'req-2', reason: 'fail 2' }
      ]
    });

    await orch.triage.markAllAsBlocking(
      [{ id: 'req-1' }, { id: 'req-2' }],
      'Fallback'
    );

    const update = stateUpdates.find(u => u.requirements);
    // req-1 already classified — should not be overwritten
    assert.equal(update.requirements.parked[0].triageClassification, 'non_blocking');
    // req-2 was not classified — should be set to blocking
    assert.equal(update.requirements.parked[1].triageClassification, 'blocking');
  });
});

describe('ItemTriage — parkItem', () => {
  it('marks item in roadmap, commits, classifies, and updates state', async () => {
    let roadmapMarked = false;
    let committed = false;

    const { orch, stateUpdates, logs } = createOrchestrator({
      parkedItems: [],
      pendingItems: ['req-1'],
      runAgent: async () => ({
        success: true,
        cost: 0.10,
        duration: 1000,
        output: JSON.stringify({
          classifications: [
            { id: 'req-1', classification: 'NON_BLOCKING', reason: 'Not critical' }
          ]
        })
      })
    });

    orch.roadmapReader.markItemParked = async (id) => { roadmapMarked = id; };
    orch.gitOps.commitAll = async () => { committed = true; return 'sha123'; };

    const result = await orch.triage.parkItem('req-1', {
      reason: 'Tests failed',
      persona: 'Jordan',
      attempts: 2,
      costUsd: 1.50
    });

    assert.equal(roadmapMarked, 'req-1');
    assert.equal(committed, true);
    assert.equal(result.classification, 'non_blocking');

    const update = stateUpdates.find(u => u.requirements);
    assert.ok(update);
    const parkedEntry = update.requirements.parked.find(p => p.id === 'req-1');
    assert.ok(parkedEntry);
    assert.equal(parkedEntry.triageClassification, 'non_blocking');
    assert.ok(parkedEntry.parkedAt);
    assert.equal(parkedEntry.persona, 'Jordan');
  });

  it('classifies human-needed errors and returns intervention', async () => {
    const { orch, stateUpdates, logs } = createOrchestrator({
      parkedItems: [],
      pendingItems: ['ios-signing'],
      runAgent: async () => ({
        success: true,
        cost: 0.10,
        duration: 1000,
        output: JSON.stringify({
          classifications: [
            { id: 'ios-signing', classification: 'NON_BLOCKING', reason: 'Can proceed without' }
          ]
        })
      })
    });

    orch.roadmapReader.markItemParked = async () => {};
    orch.roadmapReader.annotateWithHuman = async () => true;
    orch.gitOps.commitAll = async () => 'sha123';
    // Mock projectDir to a non-ios directory (no ios detection)
    orch.cliOptions.projectDir = '/tmp/non-existent-project';

    const result = await orch.triage.parkItem('ios-signing', {
      reason: 'Error: API_KEY is missing. Set it in your environment.',
      persona: 'Jordan',
      attempts: 2,
      costUsd: 1.50
    });

    assert.ok(result.intervention);
    assert.equal(result.intervention.category, 'credentials');
    assert.ok(result.intervention.steps.length > 0);
    assert.ok(logs.find(l => l.event === 'intervention_classified'));

    const update = stateUpdates.find(u => u.requirements);
    const parkedEntry = update.requirements.parked.find(p => p.id === 'ios-signing');
    assert.ok(parkedEntry.intervention);
  });

  it('returns null intervention for code bug errors', async () => {
    const { orch, stateUpdates } = createOrchestrator({
      parkedItems: [],
      pendingItems: ['req-1'],
      runAgent: async () => ({
        success: true,
        cost: 0.10,
        duration: 1000,
        output: JSON.stringify({
          classifications: [
            { id: 'req-1', classification: 'NON_BLOCKING', reason: 'Not critical' }
          ]
        })
      })
    });

    orch.roadmapReader.markItemParked = async () => {};
    orch.gitOps.commitAll = async () => 'sha123';
    orch.cliOptions.projectDir = '/tmp/non-existent-project';

    const result = await orch.triage.parkItem('req-1', {
      reason: 'SyntaxError: Unexpected token',
      persona: 'Jordan',
      attempts: 2,
      costUsd: 1.50
    });

    assert.equal(result.intervention, null);

    const update = stateUpdates.find(u => u.requirements);
    const parkedEntry = update.requirements.parked.find(p => p.id === 'req-1');
    assert.equal(parkedEntry.intervention, undefined);
  });

  it('skips intervention classification for pre-classified items', async () => {
    const { orch, stateUpdates } = createOrchestrator({
      parkedItems: [],
      pendingItems: ['req-1']
    });

    orch.roadmapReader.markItemParked = async () => {};
    orch.gitOps.commitAll = async () => 'sha';

    const result = await orch.triage.parkItem('req-1', {
      reason: '[HUMAN] tagged — requires manual intervention',
      triageClassification: 'non_blocking',
      triageReason: 'Always non-blocking'
    });

    assert.equal(result.intervention, null);
  });

  it('uses pre-provided triageClassification and skips agent call', async () => {
    let agentCalled = false;

    const { orch, stateUpdates } = createOrchestrator({
      parkedItems: [],
      pendingItems: ['req-1'],
      runAgent: async () => {
        agentCalled = true;
        return { success: true, cost: 0, duration: 0, output: '{}' };
      }
    });

    orch.roadmapReader.markItemParked = async () => {};
    orch.gitOps.commitAll = async () => 'sha';

    const result = await orch.triage.parkItem('req-1', {
      reason: '[HUMAN] tagged',
      triageClassification: 'non_blocking',
      triageReason: 'Always non-blocking'
    });

    assert.equal(result.classification, 'non_blocking');
    assert.equal(agentCalled, false, 'should skip triage agent when classification is pre-provided');
  });
});
