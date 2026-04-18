const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { ActionResolver, ENV_KEYWORD_PATTERN } = require('./action-resolver');

const ROADMAP_WITH_HUMAN = `# Roadmap: Test Project

## Phase I: Foundation
### Group A: Setup
- [x] \`auto-task\` — Automated setup task
- [ ] \`api-keys-setup\` — [HUMAN] Obtain API keys for external services
- [!] \`manual-review\` — [HUMAN] Conduct security review and penetration testing

## Phase II: Build
<!-- depends: Phase I -->
### Group A: Features
- [ ] \`feature-a\` — Build feature A
- [ ] \`env-config\` — [HUMAN] Set up production environment variables and configure deployment
`;

const ROADMAP_NO_HUMAN = `# Roadmap: Clean Project

## Phase I: Foundation
### Group A: Setup
- [x] \`auto-task\` — Automated setup task
- [ ] \`feature-b\` — Build feature B
`;

const ROADMAP_ALL_COMPLETE = `# Roadmap: Done Project

## Phase I: Done
### Group A: Done
- [x] \`manual-done\` — [HUMAN] Already completed manual task
`;

describe('ActionResolver', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'action-resolver-test-'));
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('analyze', () => {
    it('returns env_setup items when keywords match and .env.example exists', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);
      await fs.writeFile(path.join(tmpDir, '.env.example'), 'API_KEY=your_key_here\n');

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      const envItems = result.items.filter(i => i.actionType === 'env_setup');
      assert.ok(envItems.length >= 1);
      // api-keys-setup should be env_setup
      const apiItem = result.items.find(i => i.id === 'api-keys-setup');
      assert.equal(apiItem.actionType, 'env_setup');
      assert.ok(apiItem.envDetails);
      assert.ok(Array.isArray(apiItem.envDetails.missingKeys));
    });

    it('returns manual items for non-env HUMAN items', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);
      await fs.writeFile(path.join(tmpDir, '.env.example'), 'API_KEY=your_key_here\n');

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      const reviewItem = result.items.find(i => i.id === 'manual-review');
      assert.equal(reviewItem.actionType, 'manual');
      assert.equal(reviewItem.envDetails, undefined);
    });

    it('returns empty items when no incomplete HUMAN items exist', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_NO_HUMAN);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();
      assert.equal(result.items.length, 0);
    });

    it('excludes completed HUMAN items', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_ALL_COMPLETE);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();
      assert.equal(result.items.length, 0);
    });

    it('throws with code NO_ROADMAP when roadmap is missing', async () => {
      const resolver = new ActionResolver(tmpDir);
      await assert.rejects(
        () => resolver.analyze(),
        (err) => {
          assert.equal(err.code, 'NO_ROADMAP');
          return true;
        }
      );
    });

    it('strips [HUMAN] tag from description', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      const apiItem = result.items.find(i => i.id === 'api-keys-setup');
      assert.ok(!apiItem.description.includes('[HUMAN]'));
    });

    it('includes phase metadata on items', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      const apiItem = result.items.find(i => i.id === 'api-keys-setup');
      assert.equal(apiItem.phaseNumber, 'I');
      assert.equal(apiItem.phaseLabel, 'Foundation');
    });

    it('only returns items from actionable phases', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      // Phase I has pending items, so Phase II is blocked
      // env-config is in Phase II and should NOT appear
      const envConfig = result.items.find(i => i.id === 'env-config');
      assert.equal(envConfig, undefined);
      // Only Phase I items should appear
      assert.ok(result.items.every(i => i.phaseNumber === 'I'));
    });

    it('returns correct deferredCount', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      // env-config in Phase II is deferred
      assert.equal(result.deferredCount, 1);
    });

    it('includes group metadata on items', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      const apiItem = result.items.find(i => i.id === 'api-keys-setup');
      assert.equal(apiItem.groupLetter, 'A');
      assert.equal(apiItem.groupLabel, 'Setup');
    });

    it('returns all phases actionable when deps are satisfied', async () => {
      const allSatisfied = `# Roadmap: Satisfied
## Phase I: Foundation
### Group A: Setup
- [x] \`auto-task\` — Automated setup task
- [x] \`api-keys-setup\` — [HUMAN] Obtain API keys for external services
## Phase II: Build
<!-- depends: Phase I -->
### Group A: Features
- [ ] \`env-config\` — [HUMAN] Set up production environment variables
`;
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), allSatisfied);

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      // Phase I is done, Phase II is actionable
      const envConfig = result.items.find(i => i.id === 'env-config');
      assert.ok(envConfig);
      assert.equal(envConfig.phaseNumber, 'II');
      assert.equal(result.deferredCount, 0);
    });

    it('classifies env items as manual when no .env.example exists', async () => {
      await fs.writeFile(path.join(tmpDir, 'openspec', 'roadmap.md'), ROADMAP_WITH_HUMAN);
      // No .env.example

      const resolver = new ActionResolver(tmpDir);
      const result = await resolver.analyze();

      const apiItem = result.items.find(i => i.id === 'api-keys-setup');
      assert.equal(apiItem.actionType, 'manual');
    });
  });

  describe('ENV_KEYWORD_PATTERN', () => {
    it('matches api key descriptions', () => {
      assert.ok(ENV_KEYWORD_PATTERN.test('Obtain API keys for services'));
      assert.ok(ENV_KEYWORD_PATTERN.test('Set up environment variables'));
      assert.ok(ENV_KEYWORD_PATTERN.test('Configure .env file'));
      assert.ok(ENV_KEYWORD_PATTERN.test('Manage credentials for deployment'));
    });

    it('does not match unrelated descriptions', () => {
      assert.ok(!ENV_KEYWORD_PATTERN.test('Test and fix issues across devices'));
      assert.ok(!ENV_KEYWORD_PATTERN.test('Conduct security review'));
      assert.ok(!ENV_KEYWORD_PATTERN.test('Complete launch checklist'));
    });
  });
});
