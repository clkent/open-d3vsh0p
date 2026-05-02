const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { RoadmapReader } = require('./roadmap-reader');

const SAMPLE_ROADMAP = `# Roadmap: Test Project

## Phase I: Foundation
### Group A: Core Setup
- [ ] \`setup-db\` — Initialize database schema
- [x] \`setup-auth\` — Add authentication module
- [!] \`setup-cache\` — Add caching layer

### Group B: API Layer
- [ ] \`api-routes\` — Create REST endpoints

## Phase II: Features
<!-- depends: Phase I -->
### Group A: User Features
- [ ] \`user-profile\` — User profile page
- [ ] \`user-settings\` — User settings page

## Phase III: Polish
### Group A: Final
- [ ] \`perf-tuning\` — Performance optimization
`;

describe('RoadmapReader', () => {
  const reader = new RoadmapReader('/tmp/fake-project');

  describe('parseContent', () => {
    it('parses title', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      assert.equal(roadmap.title, 'Test Project');
    });

    it('parses phases with number and label', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      assert.equal(roadmap.phases.length, 3);
      assert.equal(roadmap.phases[0].number, 'I');
      assert.equal(roadmap.phases[0].label, 'Foundation');
      assert.equal(roadmap.phases[1].number, 'II');
      assert.equal(roadmap.phases[1].label, 'Features');
    });

    it('parses groups with letter and label', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const phase1 = roadmap.phases[0];
      assert.equal(phase1.groups.length, 2);
      assert.equal(phase1.groups[0].letter, 'A');
      assert.equal(phase1.groups[0].label, 'Core Setup');
      assert.equal(phase1.groups[1].letter, 'B');
      assert.equal(phase1.groups[1].label, 'API Layer');
    });

    it('parses pending [ ], complete [x], and parked [!] items', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const items = roadmap.phases[0].groups[0].items;

      assert.equal(items[0].id, 'setup-db');
      assert.equal(items[0].status, 'pending');
      assert.equal(items[1].id, 'setup-auth');
      assert.equal(items[1].status, 'complete');
      assert.equal(items[2].id, 'setup-cache');
      assert.equal(items[2].status, 'parked');
    });

    it('parses item descriptions', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const item = roadmap.phases[0].groups[0].items[0];
      assert.equal(item.description, 'Initialize database schema');
    });

    it('parses explicit depends comment', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      assert.deepEqual(roadmap.phases[1].depends, ['I']);
    });

    it('sets implicit dependencies on phases without explicit depends', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      // Phase I has no depends (first phase)
      assert.equal(roadmap.phases[0].depends, null);
      // Phase III has no explicit depends, so it gets implicit dep on Phase II
      assert.deepEqual(roadmap.phases[2].depends, ['II']);
    });

    it('parses multi-dependency comments', () => {
      const multi = `# Roadmap: Multi
## Phase I: First
### Group A: A
- [ ] \`a\` — A
## Phase II: Second
### Group A: A
- [ ] \`b\` — B
## Phase III: Third
<!-- depends: Phase I, Phase II -->
### Group A: A
- [ ] \`c\` — C
`;
      const roadmap = reader.parseContent(multi);
      assert.deepEqual(roadmap.phases[2].depends, ['I', 'II']);
    });
  });

  describe('getNextPhase', () => {
    it('returns first phase with pending items when no dependencies', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const next = reader.getNextPhase(roadmap);
      assert.equal(next.number, 'I');
    });

    it('skips completed phases', () => {
      const allDone = `# Roadmap: Done
## Phase I: Done
### Group A: Done
- [x] \`a\` — A done
## Phase II: Next
### Group A: Work
- [ ] \`b\` — B pending
`;
      const roadmap = reader.parseContent(allDone);
      const next = reader.getNextPhase(roadmap);
      assert.equal(next.number, 'II');
    });

    it('respects dependencies — blocks phase when dep has pending items', () => {
      // Phase I has pending items, so Phase II (depends on I) should be blocked
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      // Mark Phase I items all complete except setup-db
      // Phase II depends on Phase I, so getNextPhase should return Phase I
      const next = reader.getNextPhase(roadmap);
      assert.equal(next.number, 'I'); // Phase I still has pending items
    });

    it('blocks phase when any multi-dependency has pending items', () => {
      const multi = `# Roadmap: Multi
## Phase I: First
### Group A: A
- [x] \`a\` — done
## Phase II: Second
### Group A: A
- [ ] \`b\` — pending
## Phase III: Both
<!-- depends: Phase I, Phase II -->
### Group A: A
- [ ] \`c\` — waiting
`;
      const roadmap = reader.parseContent(multi);
      const next = reader.getNextPhase(roadmap);
      // Phase I is done, but Phase II has pending items, so Phase III is blocked
      assert.equal(next.number, 'II');
    });

    it('unblocks phase when all multi-dependencies are satisfied', () => {
      const multi = `# Roadmap: Multi
## Phase I: First
### Group A: A
- [x] \`a\` — done
## Phase II: Second
### Group A: A
- [x] \`b\` — done
## Phase III: Both
<!-- depends: Phase I, Phase II -->
### Group A: A
- [ ] \`c\` — ready
`;
      const roadmap = reader.parseContent(multi);
      const next = reader.getNextPhase(roadmap);
      assert.equal(next.number, 'III');
    });

    it('returns null when all phases are done', () => {
      const allDone = `# Roadmap: Done
## Phase I: Done
### Group A: Done
- [x] \`a\` — done
`;
      const roadmap = reader.parseContent(allDone);
      const next = reader.getNextPhase(roadmap);
      assert.equal(next, null);
    });
  });

  describe('isHuman flag', () => {
    it('sets isHuman: true for items with [HUMAN] in description', () => {
      const humanRoadmap = `# Roadmap: Human
## Phase I: Setup
### Group A: Work
- [ ] \`manual-config\` — Configure DNS records [HUMAN]
- [ ] \`auto-setup\` — Run database migrations
`;
      const roadmap = reader.parseContent(humanRoadmap);
      const items = roadmap.phases[0].groups[0].items;
      assert.equal(items[0].isHuman, true);
      assert.equal(items[1].isHuman, false);
    });

    it('detects [HUMAN] anywhere in the description', () => {
      const humanRoadmap = `# Roadmap: Human
## Phase I: Setup
### Group A: Work
- [ ] \`dns-setup\` — [HUMAN] Configure DNS records manually
`;
      const roadmap = reader.parseContent(humanRoadmap);
      assert.equal(roadmap.phases[0].groups[0].items[0].isHuman, true);
    });
  });

  describe('isSpike flag', () => {
    it('sets isSpike: true for items with [SPIKE] in description', () => {
      const spikeRoadmap = `# Roadmap: Spikes
## Phase I: Spikes
### Group A: Validation
- [ ] \`spike-stripe\` — [SPIKE] Validate Stripe checkout flow
- [ ] \`setup-db\` — Initialize database schema
`;
      const roadmap = reader.parseContent(spikeRoadmap);
      const items = roadmap.phases[0].groups[0].items;
      assert.equal(items[0].isSpike, true);
      assert.equal(items[1].isSpike, false);
    });

    it('detects [SPIKE] anywhere in the description', () => {
      const spikeRoadmap = `# Roadmap: Spikes
## Phase I: Spikes
### Group A: Validation
- [ ] \`spike-api\` — Validate API integration [SPIKE]
`;
      const roadmap = reader.parseContent(spikeRoadmap);
      assert.equal(roadmap.phases[0].groups[0].items[0].isSpike, true);
    });
  });

  describe('isSpikePhase', () => {
    it('returns true when all pending items are spikes', () => {
      const spikeRoadmap = `# Roadmap: Spikes
## Phase I: Spikes
### Group A: Validation
- [ ] \`spike-stripe\` — [SPIKE] Validate Stripe checkout flow
- [ ] \`spike-api\` — [SPIKE] Test API integration
- [x] \`done-item\` — Already completed
`;
      const roadmap = reader.parseContent(spikeRoadmap);
      assert.equal(reader.isSpikePhase(roadmap.phases[0]), true);
    });

    it('returns false when phase has mixed spike and non-spike pending items', () => {
      const mixedRoadmap = `# Roadmap: Mixed
## Phase I: Mixed
### Group A: Work
- [ ] \`spike-stripe\` — [SPIKE] Validate Stripe
- [ ] \`setup-db\` — Initialize database
`;
      const roadmap = reader.parseContent(mixedRoadmap);
      assert.equal(reader.isSpikePhase(roadmap.phases[0]), false);
    });

    it('returns false when no pending items exist', () => {
      const doneRoadmap = `# Roadmap: Done
## Phase I: Done
### Group A: Done
- [x] \`spike-stripe\` — [SPIKE] Validate Stripe
`;
      const roadmap = reader.parseContent(doneRoadmap);
      assert.equal(reader.isSpikePhase(roadmap.phases[0]), false);
    });
  });

  describe('getParkedItemsInPhase', () => {
    it('returns only parked items from a phase', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const parked = reader.getParkedItemsInPhase(roadmap.phases[0]);
      assert.equal(parked.length, 1);
      assert.equal(parked[0].id, 'setup-cache');
      assert.equal(parked[0].status, 'parked');
    });

    it('returns empty array when no items are parked', () => {
      const noParked = `# Roadmap: Clean
## Phase I: Clean
### Group A: Done
- [x] \`a\` — done
- [ ] \`b\` — pending
`;
      const roadmap = reader.parseContent(noParked);
      const parked = reader.getParkedItemsInPhase(roadmap.phases[0]);
      assert.equal(parked.length, 0);
    });

    it('includes group metadata on parked items', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const parked = reader.getParkedItemsInPhase(roadmap.phases[0]);
      assert.equal(parked[0].groupLetter, 'A');
      assert.equal(parked[0].groupLabel, 'Core Setup');
    });
  });

  describe('getNextPhase with blockingParkedIds', () => {
    it('blocks dependent phase when parked item is in blocking set', () => {
      const roadmap = reader.parseContent(`# Roadmap: Blocking
## Phase I: Foundation
### Group A: Core
- [x] \`setup-auth\` — Auth done
- [!] \`setup-db\` — Database failed
## Phase II: Features
<!-- depends: Phase I -->
### Group A: User
- [ ] \`user-profile\` — User profile page
`);
      // Without blocking IDs — Phase II is ready (parked counts as satisfied)
      const nextWithout = reader.getNextPhase(roadmap);
      assert.equal(nextWithout.number, 'II');

      // With blocking IDs — Phase II is blocked
      const nextWith = reader.getNextPhase(roadmap, new Set(['setup-db']));
      assert.equal(nextWith, null);
    });

    it('allows dependent phase when parked item is NOT in blocking set', () => {
      const roadmap = reader.parseContent(`# Roadmap: NonBlocking
## Phase I: Foundation
### Group A: Core
- [x] \`setup-auth\` — Auth done
- [!] \`setup-docs\` — Docs failed
## Phase II: Features
<!-- depends: Phase I -->
### Group A: User
- [ ] \`user-profile\` — User profile page
`);
      // Parked item not in blocking set — Phase II proceeds
      const next = reader.getNextPhase(roadmap, new Set());
      assert.equal(next.number, 'II');
    });

    it('default empty set preserves backward compatibility', () => {
      const roadmap = reader.parseContent(`# Roadmap: Compat
## Phase I: Foundation
### Group A: Core
- [x] \`a\` — done
- [!] \`b\` — parked
## Phase II: Features
<!-- depends: Phase I -->
### Group A: User
- [ ] \`c\` — pending
`);
      // No second arg = same as old behavior (parked = satisfied)
      const next = reader.getNextPhase(roadmap);
      assert.equal(next.number, 'II');
    });

    it('blocks when mix of blocking and non-blocking parked items and one blocks', () => {
      const roadmap = reader.parseContent(`# Roadmap: Mixed
## Phase I: Foundation
### Group A: Core
- [!] \`setup-db\` — Database failed
- [!] \`setup-docs\` — Docs failed
## Phase II: Features
<!-- depends: Phase I -->
### Group A: User
- [ ] \`user-profile\` — User profile page
`);
      // Only setup-db is blocking, setup-docs is not
      const next = reader.getNextPhase(roadmap, new Set(['setup-db']));
      assert.equal(next, null);
    });
  });

  describe('getActionablePhaseNumbers', () => {
    it('returns all phases when no dependencies exist', () => {
      const roadmap = reader.parseContent(`# Roadmap: NoDeps
## Phase I: First
### Group A: A
- [ ] \`a\` — A task
`);
      const actionable = reader.getActionablePhaseNumbers(roadmap);
      assert.deepEqual(actionable, ['I']);
    });

    it('excludes phases whose dependencies are not satisfied', () => {
      const roadmap = reader.parseContent(`# Roadmap: Blocked
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Database setup
## Phase II: Features
<!-- depends: Phase I -->
### Group A: User
- [ ] \`user-profile\` — User profile page
`);
      const actionable = reader.getActionablePhaseNumbers(roadmap);
      // Phase I is actionable (no deps), Phase II is blocked (Phase I has pending items)
      assert.deepEqual(actionable, ['I']);
    });

    it('includes phases whose dependencies are all complete or parked', () => {
      const roadmap = reader.parseContent(`# Roadmap: Unblocked
## Phase I: Foundation
### Group A: Core
- [x] \`setup-auth\` — Auth done
- [!] \`setup-cache\` — Cache parked
## Phase II: Features
<!-- depends: Phase I -->
### Group A: User
- [ ] \`user-profile\` — User profile page
`);
      const actionable = reader.getActionablePhaseNumbers(roadmap);
      assert.deepEqual(actionable, ['I', 'II']);
    });

    it('returns multiple actionable phases independently', () => {
      const roadmap = reader.parseContent(`# Roadmap: Multi
## Phase I: First
### Group A: A
- [x] \`a\` — done
## Phase II: Second
<!-- depends: Phase I -->
### Group A: A
- [ ] \`b\` — pending
## Phase III: Third
<!-- depends: Phase I -->
### Group A: A
- [ ] \`c\` — pending
## Phase IV: Fourth
<!-- depends: Phase II -->
### Group A: A
- [ ] \`d\` — pending
`);
      const actionable = reader.getActionablePhaseNumbers(roadmap);
      // Phase I: no deps (actionable)
      // Phase II: depends on I (all done) — actionable
      // Phase III: depends on I (all done) — actionable
      // Phase IV: depends on II (has pending) — blocked
      assert.deepEqual(actionable, ['I', 'II', 'III']);
    });
  });

  describe('getPendingGroups', () => {
    it('filters out groups with no pending items', () => {
      const mixed = `# Roadmap: Mixed
## Phase I: Mixed
### Group A: Done
- [x] \`a\` — done
### Group B: Pending
- [ ] \`b\` — pending
`;
      const roadmap = reader.parseContent(mixed);
      const pending = reader.getPendingGroups(roadmap.phases[0]);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].letter, 'B');
    });
  });

  describe('isComplete', () => {
    it('returns true when all items are complete or parked', () => {
      const done = `# Roadmap: Done
## Phase I: Done
### Group A: Done
- [x] \`a\` — done
- [!] \`b\` — parked
`;
      const roadmap = reader.parseContent(done);
      assert.equal(reader.isComplete(roadmap), true);
    });

    it('returns false when any item is pending', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      assert.equal(reader.isComplete(roadmap), false);
    });
  });

  describe('resetParkedItems', () => {
    it('resets [!] markers to [ ] in the roadmap file', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [x] `done` — Completed item',
        '- [!] `parked-a` — Previously parked',
        '- [ ] `pending` — Still pending',
        '- [!] `parked-b` — Also parked'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const didReset = await tmpReader.resetParkedItems();
      assert.equal(didReset, true);

      const roadmap = await tmpReader.parse();
      const items = roadmap.phases[0].groups[0].items;
      assert.equal(items[0].status, 'complete');
      assert.equal(items[1].status, 'pending');
      assert.equal(items[2].status, 'pending');
      assert.equal(items[3].status, 'pending');

      await fs.rm(tmpDir, { recursive: true });
    });

    it('preserves [HUMAN] parked items by default', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [!] `code-bug` — Agent failed on this',
        '- [!] `needs-human` — [HUMAN] Obtain API keys',
        '- [!] `another-bug` — Another agent failure',
        '### Group Z: User Testing',
        '- [!] `human-checkpoint` — [HUMAN] Review phase output'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const didReset = await tmpReader.resetParkedItems();
      assert.equal(didReset, true);

      const roadmap = await tmpReader.parse();
      const groupA = roadmap.phases[0].groups[0].items;
      const groupZ = roadmap.phases[0].groups[1].items;
      assert.equal(groupA[0].status, 'pending');  // code-bug reset
      assert.equal(groupA[1].status, 'parked');    // HUMAN preserved
      assert.equal(groupA[2].status, 'pending');  // another-bug reset
      assert.equal(groupZ[0].status, 'parked');    // HUMAN checkpoint preserved

      await fs.rm(tmpDir, { recursive: true });
    });

    it('resets HUMAN items too when includeHuman is true', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [!] `code-bug` — Agent failed on this',
        '- [!] `needs-human` — [HUMAN] Obtain API keys'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const didReset = await tmpReader.resetParkedItems({ includeHuman: true });
      assert.equal(didReset, true);

      const roadmap = await tmpReader.parse();
      const items = roadmap.phases[0].groups[0].items;
      assert.equal(items[0].status, 'pending');
      assert.equal(items[1].status, 'pending');

      await fs.rm(tmpDir, { recursive: true });
    });

    it('returns false when no parked items exist', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [x] `done` — Completed',
        '- [ ] `pending` — Pending'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const didReset = await tmpReader.resetParkedItems();
      assert.equal(didReset, false);

      await fs.rm(tmpDir, { recursive: true });
    });

    it('returns false when only HUMAN parked items exist', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [!] `api-keys` — [HUMAN] Get API keys'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const didReset = await tmpReader.resetParkedItems();
      assert.equal(didReset, false);

      await fs.rm(tmpDir, { recursive: true });
    });
  });

  describe('annotateWithHuman', () => {
    it('adds [HUMAN] marker to a parked item description', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [!] `ios-signing` — Configure code signing for release builds',
        '- [ ] `setup-db` — Initialize database schema'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const result = await tmpReader.annotateWithHuman('ios-signing');
      assert.equal(result, true);

      const roadmap = await tmpReader.parse();
      const item = roadmap.phases[0].groups[0].items[0];
      assert.equal(item.isHuman, true);
      assert.ok(item.description.includes('[HUMAN]'));

      await fs.rm(tmpDir, { recursive: true });
    });

    it('does not duplicate [HUMAN] if already present', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [!] `ios-signing` — [HUMAN] Configure code signing'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const result = await tmpReader.annotateWithHuman('ios-signing');
      assert.equal(result, false);

      const content = await fs.readFile(path.join(openspecDir, 'roadmap.md'), 'utf-8');
      const humanCount = (content.match(/\[HUMAN\]/g) || []).length;
      assert.equal(humanCount, 1);

      await fs.rm(tmpDir, { recursive: true });
    });

    it('returns false for non-parked items', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [ ] `setup-db` — Initialize database schema'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const result = await tmpReader.annotateWithHuman('setup-db');
      assert.equal(result, false);

      await fs.rm(tmpDir, { recursive: true });
    });

    it('returns false for non-existent item', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [!] `ios-signing` — Configure code signing'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      const result = await tmpReader.annotateWithHuman('non-existent');
      assert.equal(result, false);

      await fs.rm(tmpDir, { recursive: true });
    });

    it('parsed item has isHuman true after annotation', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-test-'));
      const openspecDir = path.join(tmpDir, 'openspec');
      await fs.mkdir(openspecDir, { recursive: true });
      await fs.writeFile(path.join(openspecDir, 'roadmap.md'), [
        '# Roadmap: Test',
        '## Phase I: Foundation',
        '### Group A: Core',
        '- [!] `env-setup` — Set up environment variables'
      ].join('\n'));

      const tmpReader = new RoadmapReader(tmpDir);
      await tmpReader.annotateWithHuman('env-setup');

      const roadmap = await tmpReader.parse();
      const items = tmpReader.getAllItems(roadmap);
      const item = items.find(i => i.id === 'env-setup');
      assert.equal(item.isHuman, true);
      assert.equal(item.status, 'parked');

      await fs.rm(tmpDir, { recursive: true });
    });
  });

  describe('getAllItems', () => {
    it('flattens items with phase and group metadata', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const items = reader.getAllItems(roadmap);

      assert.ok(items.length > 0);

      const first = items[0];
      assert.equal(first.id, 'setup-db');
      assert.equal(first.phaseNumber, 'I');
      assert.equal(first.phaseLabel, 'Foundation');
      assert.equal(first.groupLetter, 'A');
      assert.equal(first.groupLabel, 'Core Setup');
    });

    it('includes all items across all phases', () => {
      const roadmap = reader.parseContent(SAMPLE_ROADMAP);
      const items = reader.getAllItems(roadmap);
      // 3 in Phase I Group A + 1 in Phase I Group B + 2 in Phase II + 1 in Phase III = 7
      assert.equal(items.length, 7);
    });
  });
});
