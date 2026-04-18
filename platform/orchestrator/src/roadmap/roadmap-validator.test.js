const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { RoadmapReader } = require('./roadmap-reader');
const { RoadmapValidator } = require('./roadmap-validator');

const reader = new RoadmapReader('/tmp/fake-project');

const VALID_ROADMAP = `# Roadmap: Test Project

## Phase I: Foundation
### Group A: Core Setup
- [ ] \`setup-db\` — Initialize database schema
- [x] \`setup-auth\` — Add authentication module

### Group B: API Layer
- [ ] \`api-routes\` — Create REST endpoints

### Group Z: User Testing
- [ ] \`test-phase-1\` — [HUMAN] Verify database and API setup works

## Phase II: Features
<!-- depends: Phase I -->
### Group A: User Features
- [ ] \`user-profile\` — User profile page
- [ ] \`user-settings\` — User settings page

### Group Z: User Testing
- [ ] \`test-phase-2\` — [HUMAN] Verify user features work end-to-end
`;

describe('RoadmapValidator', () => {
  describe('valid roadmap', () => {
    it('passes with no errors or warnings', () => {
      const roadmap = reader.parseContent(VALID_ROADMAP);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.warnings, []);
    });
  });

  describe('ID format', () => {
    it('rejects uppercase IDs', () => {
      const roadmap = reader.parseContent(`# Roadmap: Bad
## Phase I: Test
### Group A: Work
- [ ] \`SetupDB\` — Bad ID
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes('SetupDB'));
      assert.ok(result.errors[0].includes('kebab-case'));
    });

    it('rejects IDs with spaces', () => {
      const roadmap = reader.parseContent(`# Roadmap: Bad
## Phase I: Test
### Group A: Work
- [ ] \`setup db\` — Bad ID
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('setup db'));
    });

    it('rejects single-character IDs', () => {
      const roadmap = reader.parseContent(`# Roadmap: Bad
## Phase I: Test
### Group A: Work
- [ ] \`a\` — Too short
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('"a"'));
    });

    it('rejects IDs starting with a number', () => {
      const roadmap = reader.parseContent(`# Roadmap: Bad
## Phase I: Test
### Group A: Work
- [ ] \`1-setup\` — Starts with number
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('1-setup'));
    });

    it('accepts valid kebab-case IDs', () => {
      const roadmap = reader.parseContent(`# Roadmap: Good
## Phase I: Test
### Group A: Work
- [ ] \`setup-db\` — Good
- [ ] \`api-v2-routes\` — Also good
- [ ] \`ab\` — Minimal valid
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });
  });

  describe('ID uniqueness', () => {
    it('detects duplicate IDs within the same phase', () => {
      const roadmap = reader.parseContent(`# Roadmap: Dup
## Phase I: Test
### Group A: First
- [ ] \`setup-db\` — First occurrence
### Group B: Second
- [ ] \`setup-db\` — Duplicate
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes('Duplicate'));
      assert.ok(result.errors[0].includes('setup-db'));
      assert.ok(result.errors[0].includes('Phase I Group B'));
      assert.ok(result.errors[0].includes('Phase I Group A'));
    });

    it('detects duplicate IDs across phases', () => {
      const roadmap = reader.parseContent(`# Roadmap: Dup
## Phase I: First
### Group A: Work
- [ ] \`setup-db\` — In phase I
## Phase II: Second
### Group A: Work
- [ ] \`setup-db\` — Duplicate in phase II
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('Duplicate'));
      assert.ok(result.errors[0].includes('Phase II Group A'));
      assert.ok(result.errors[0].includes('Phase I Group A'));
    });
  });

  describe('dependency validity', () => {
    it('detects reference to non-existent phase', () => {
      const roadmap = reader.parseContent(`# Roadmap: BadDep
## Phase I: First
### Group A: Work
- [ ] \`setup-db\` — Work
## Phase II: Second
<!-- depends: Phase IX -->
### Group A: Work
- [ ] \`api-routes\` — Work
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes('Phase II'));
      assert.ok(result.errors[0].includes('Phase IX'));
      assert.ok(result.errors[0].includes('does not exist'));
    });

    it('passes when all dependencies reference valid phases', () => {
      const roadmap = reader.parseContent(`# Roadmap: GoodDep
## Phase I: First
### Group A: Work
- [ ] \`setup-db\` — Work
## Phase II: Second
<!-- depends: Phase I -->
### Group A: Work
- [ ] \`api-routes\` — Work
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, true);
    });

    it('detects invalid dep in multi-dependency list', () => {
      const roadmap = reader.parseContent(`# Roadmap: BadMulti
## Phase I: First
### Group A: Work
- [ ] \`setup-db\` — Work
## Phase II: Second
### Group A: Work
- [ ] \`api-routes\` — Work
## Phase III: Third
<!-- depends: Phase I, Phase V -->
### Group A: Work
- [ ] \`ui-shell\` — Work
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors[0].includes('Phase V'));
      assert.ok(result.errors[0].includes('does not exist'));
    });
  });

  describe('group size warning', () => {
    it('warns when group has more than 10 items', () => {
      const roadmap = reader.parseContent(`# Roadmap: Big
## Phase I: Test
### Group A: Big Group
- [ ] \`item-aa\` — One
- [ ] \`item-bb\` — Two
- [ ] \`item-cc\` — Three
- [ ] \`item-dd\` — Four
- [ ] \`item-ee\` — Five
- [ ] \`item-ff\` — Six
- [ ] \`item-gg\` — Seven
- [ ] \`item-hh\` — Eight
- [ ] \`item-ii\` — Nine
- [ ] \`item-jj\` — Ten
- [ ] \`item-kk\` — Eleven
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('11 items')));
      assert.ok(result.warnings.some(w => w.includes('max recommended: 10')));
    });

    it('does not warn about group size for groups with 10 or fewer items', () => {
      const roadmap = reader.parseContent(VALID_ROADMAP);
      const result = RoadmapValidator.validate(roadmap);
      assert.ok(!result.warnings.some(w => w.includes('items (max')));
    });
  });

  describe('empty phase error', () => {
    it('errors when a phase has zero items', () => {
      const roadmap = reader.parseContent(`# Roadmap: Empty
## Phase I: Has Items
### Group A: Work
- [ ] \`setup-db\` — Work
## Phase II: Empty Phase
`);
      // Phase II has no groups/items — parser creates it with empty groups array
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Phase II') && e.includes('no items')));
    });
  });

  describe('structural emptiness', () => {
    it('errors when roadmap has zero phases', () => {
      const roadmap = { phases: [] };
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('No phases found')));
    });

    it('errors when phases exist but have zero total items', () => {
      const roadmap = reader.parseContent(`# Roadmap: NoItems
## Phase I: Empty
## Phase II: Also Empty
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('No items found')));
    });
  });

  describe('Group Z checkpoint warning', () => {
    it('warns when no phase has a Group Z', () => {
      const roadmap = reader.parseContent(`# Roadmap: NoGroupZ
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [ ] \`setup-auth\` — [HUMAN] Set up auth service
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.ok(result.warnings.some(w => w.includes('Group Z')));
    });

    it('does not warn when a phase has Group Z', () => {
      const roadmap = reader.parseContent(`# Roadmap: HasGroupZ
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
### Group Z: User Testing
- [ ] \`test-phase-1\` — [HUMAN] Verify setup works
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.ok(!result.warnings.some(w => w.includes('Group Z')));
    });
  });

  describe('[HUMAN] marker warning', () => {
    it('warns when no item has [HUMAN] marker', () => {
      const roadmap = reader.parseContent(`# Roadmap: NoHuman
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [ ] \`setup-auth\` — Add authentication
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.ok(result.warnings.some(w => w.includes('[HUMAN]')));
    });

    it('does not warn when at least one item has [HUMAN]', () => {
      const roadmap = reader.parseContent(`# Roadmap: HasHuman
## Phase I: Foundation
### Group A: Core
- [ ] \`setup-db\` — Initialize database
- [ ] \`get-api-keys\` — [HUMAN] Obtain API keys for the service
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.ok(!result.warnings.some(w => w.includes('[HUMAN]')));
    });

    it('does not warn about [HUMAN] when roadmap has zero items', () => {
      const roadmap = { phases: [] };
      const result = RoadmapValidator.validate(roadmap);
      // Should have "No phases found" error but not the [HUMAN] warning
      assert.ok(!result.warnings.some(w => w.includes('[HUMAN]')));
    });
  });

  describe('multiple errors', () => {
    it('accumulates all errors without fail-fast', () => {
      const roadmap = reader.parseContent(`# Roadmap: MultiError
## Phase I: Test
### Group A: Work
- [ ] \`BadId\` — Uppercase
- [ ] \`x\` — Too short
- [ ] \`setup-db\` — Valid
- [ ] \`setup-db\` — Duplicate
## Phase II: More
<!-- depends: Phase X -->
### Group A: Work
- [ ] \`2bad\` — Starts with number
`);
      const result = RoadmapValidator.validate(roadmap);
      assert.equal(result.valid, false);
      // BadId (format) + x (format) + setup-db (dup) + Phase X (dep) + 2bad (format) = 5
      assert.equal(result.errors.length, 5);
    });
  });
});
