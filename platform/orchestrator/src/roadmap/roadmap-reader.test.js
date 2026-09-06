const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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

    it('extracts phase references and ignores a trailing note', () => {
      const content = `# Roadmap: Test
## Phase II: Two
### Group A: A
- [ ] \`a\` — pending
## Phase III: Three
<!-- depends: Phase II; blocked on a vendor account -->
### Group A: B
- [ ] \`b\` — pending
`;
      const roadmap = reader.parseContent(content);
      assert.deepEqual(roadmap.phases[1].depends, ['II']);
      assert.deepEqual(reader.getActionablePhaseNumbers(roadmap), ['II']);
    });

    it('extracts multiple references with text between them', () => {
      const content = `# Roadmap: Test
## Phase IV: Four
### Group A: A
- [x] \`a\` — done
## Phase V: Five
<!-- depends: Phase IV -->
### Group A: B
- [x] \`b\` — done
## Phase VI: Six
<!-- depends: Phase IV and Phase V -->
### Group A: C
- [ ] \`c\` — pending
`;
      const roadmap = reader.parseContent(content);
      assert.deepEqual(roadmap.phases[2].depends, ['IV', 'V']);
      assert.deepEqual(reader.getActionablePhaseNumbers(roadmap), ['IV', 'V', 'VI']);
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

    it('blocks a phase whose dependency names no phase in the roadmap (fail closed)', () => {
      const content = `# Roadmap: Test
## Phase I: One
### Group A: A
- [x] \`a\` — done
## Phase II: Two
<!-- depends: Phase IX -->
### Group A: B
- [ ] \`b\` — pending
`;
      const roadmap = reader.parseContent(content);
      const actionable = reader.getActionablePhaseNumbers(roadmap);
      assert.deepEqual(actionable, ['I']);
    });

    it('a depends comment with no phase references means no dependencies', () => {
      const content = `# Roadmap: Test
## Phase I: One
### Group A: A
- [ ] \`a\` — pending
## Phase II: Two
<!-- depends: none -->
### Group A: B
- [ ] \`b\` — pending
`;
      const roadmap = reader.parseContent(content);
      assert.deepEqual(roadmap.phases[1].depends, []);
      assert.deepEqual(reader.getActionablePhaseNumbers(roadmap), ['I', 'II']);
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
