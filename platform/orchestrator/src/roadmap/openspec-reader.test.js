const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');

describe('OpenSpecReader', () => {
  let OpenSpecReader, reader;
  let originalReadFile;
  let originalAccess;

  const SAMPLE_PROJECT_MD = `# My Cool Project

## Tech Stack
- Node.js
- React
- PostgreSQL

## Requirements

### User Authentication
- Support email/password login
- Add session management
- Hash passwords with bcrypt

### Dashboard Widget
- Show summary stats
- Real-time updates via WebSocket

### API Rate Limiting
- Limit to 100 requests per minute
- Return 429 status when exceeded

## Deployment
Some deployment notes.
`;

  beforeEach(() => {
    originalReadFile = fs.readFile;
    originalAccess = fs.access;
    fs.readFile = async (filePath) => {
      if (filePath.includes('project.md')) return SAMPLE_PROJECT_MD;
      throw new Error(`ENOENT: no such file: ${filePath}`);
    };
    fs.access = async () => { throw new Error('ENOENT'); };

    delete require.cache[require.resolve('./openspec-reader')];
    ({ OpenSpecReader } = require('./openspec-reader'));
    reader = new OpenSpecReader('/fake/project');
  });

  afterEach(() => {
    fs.readFile = originalReadFile;
    fs.access = originalAccess;
  });

  describe('getRequirements', () => {
    it('parses a single requirement', async () => {
      fs.readFile = async () => `# P\n## Requirements\n### Login\n- Support login\n`;
      reader = new OpenSpecReader('/fake');
      const reqs = await reader.getRequirements();
      assert.equal(reqs.length, 1);
      assert.equal(reqs[0].name, 'Login');
    });

    it('parses multiple requirements', async () => {
      const reqs = await reader.getRequirements();
      assert.equal(reqs.length, 3);
    });

    it('generates correct kebab-case IDs', async () => {
      const reqs = await reader.getRequirements();
      assert.equal(reqs[0].id, 'user-authentication');
      assert.equal(reqs[1].id, 'dashboard-widget');
      assert.equal(reqs[2].id, 'api-rate-limiting');
    });

    it('generates correct changeName format', async () => {
      const reqs = await reader.getRequirements();
      assert.equal(reqs[0].changeName, 'add-user-authentication');
    });

    it('collects bullets under each requirement', async () => {
      const reqs = await reader.getRequirements();
      assert.equal(reqs[0].bullets.length, 3);
      assert.equal(reqs[0].bullets[0], 'Support email/password login');
      assert.equal(reqs[1].bullets.length, 2);
    });

    it('ignores non-Requirements sections', async () => {
      fs.readFile = async () => `# P\n## Other Section\n### Not A Req\n- bullet\n## Requirements\n### Real Req\n- real bullet\n`;
      reader = new OpenSpecReader('/fake');
      const reqs = await reader.getRequirements();
      assert.equal(reqs.length, 1);
      assert.equal(reqs[0].name, 'Real Req');
    });

    it('stops at next ## section', async () => {
      const reqs = await reader.getRequirements();
      // Should not include anything from ## Deployment
      assert.equal(reqs.length, 3);
    });

    it('handles empty requirements section', async () => {
      fs.readFile = async () => `# P\n## Requirements\n## Other\n`;
      reader = new OpenSpecReader('/fake');
      const reqs = await reader.getRequirements();
      assert.equal(reqs.length, 0);
    });

    it('handles no bullets under a requirement', async () => {
      fs.readFile = async () => `# P\n## Requirements\n### Empty Req\n`;
      reader = new OpenSpecReader('/fake');
      const reqs = await reader.getRequirements();
      assert.equal(reqs.length, 1);
      assert.deepEqual(reqs[0].bullets, []);
    });
  });

  describe('getNextRequirement', () => {
    it('returns first requirement when none completed', async () => {
      const state = { requirements: { completed: [], parked: [] } };
      const next = await reader.getNextRequirement(state);
      assert.equal(next.id, 'user-authentication');
    });

    it('skips completed requirements', async () => {
      const state = { requirements: { completed: ['user-authentication'], parked: [] } };
      const next = await reader.getNextRequirement(state);
      assert.equal(next.id, 'dashboard-widget');
    });

    it('skips parked requirements (string format)', async () => {
      const state = { requirements: { completed: [], parked: ['user-authentication'] } };
      const next = await reader.getNextRequirement(state);
      assert.equal(next.id, 'dashboard-widget');
    });

    it('skips parked requirements (object format)', async () => {
      const state = {
        requirements: {
          completed: [],
          parked: [{ id: 'user-authentication', reason: 'too complex' }]
        }
      };
      const next = await reader.getNextRequirement(state);
      assert.equal(next.id, 'dashboard-widget');
    });

    it('respects targetRequirements filter', async () => {
      const state = {
        requirements: { completed: [], parked: [] },
        targetRequirements: ['api-rate-limiting']
      };
      const next = await reader.getNextRequirement(state);
      assert.equal(next.id, 'api-rate-limiting');
    });

    it('returns null when all requirements are done', async () => {
      const state = {
        requirements: {
          completed: ['user-authentication', 'dashboard-widget', 'api-rate-limiting'],
          parked: []
        }
      };
      const next = await reader.getNextRequirement(state);
      assert.equal(next, null);
    });
  });

  describe('getRequirementById', () => {
    it('returns matching requirement', async () => {
      const req = await reader.getRequirementById('dashboard-widget');
      assert.equal(req.name, 'Dashboard Widget');
      assert.equal(req.bullets.length, 2);
    });

    it('returns null when no match', async () => {
      const req = await reader.getRequirementById('nonexistent');
      assert.equal(req, null);
    });
  });

  describe('parseProjectName', () => {
    it('extracts name from first heading', async () => {
      const name = await reader.parseProjectName();
      assert.equal(name, 'My Cool Project');
    });

    it('returns default when no heading found', async () => {
      fs.readFile = async () => 'No heading here\nJust text.';
      reader = new OpenSpecReader('/fake');
      const name = await reader.parseProjectName();
      assert.equal(name, 'Unknown Project');
    });
  });

  describe('parseTechStack', () => {
    it('extracts bullets from Tech Stack section', async () => {
      const tech = await reader.parseTechStack();
      assert.equal(tech, 'Node.js, React, PostgreSQL');
    });

    it('returns default when no Tech Stack section', async () => {
      fs.readFile = async () => '# P\n## Requirements\n### R\n- bullet\n';
      reader = new OpenSpecReader('/fake');
      const tech = await reader.parseTechStack();
      assert.equal(tech, 'Not specified');
    });
  });

  describe('buildReviewPrompt', () => {
    it('includes phase context when items are provided', async () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const phaseContext = [
        { id: 'user-registration', description: 'User registration form' },
        { id: 'password-reset', description: 'Password reset flow' }
      ];
      const prompt = reader.buildReviewPrompt(req, 'diff here', '1 file changed', phaseContext);
      assert.ok(prompt.includes('## Other Work Merged This Phase'));
      assert.ok(prompt.includes('`user-registration`: User registration form'));
      assert.ok(prompt.includes('`password-reset`: Password reset flow'));
    });

    it('omits phase context section when no items', async () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildReviewPrompt(req, 'diff here', '1 file changed', []);
      assert.ok(!prompt.includes('Other Work Merged This Phase'));
    });

    it('omits phase context section when not provided', async () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildReviewPrompt(req, 'diff here', '1 file changed');
      assert.ok(!prompt.includes('Other Work Merged This Phase'));
    });

    it('includes requirement bullets and diff', async () => {
      const req = { name: 'Login', bullets: ['Support login', 'Hash passwords'] };
      const prompt = reader.buildReviewPrompt(req, 'my diff', '2 files changed');
      assert.ok(prompt.includes('Support login'));
      assert.ok(prompt.includes('Hash passwords'));
      assert.ok(prompt.includes('my diff'));
      assert.ok(prompt.includes('2 files changed'));
    });
  });

  describe('buildPreflightPrompt', () => {
    it('produces structured planning prompt', () => {
      const req = { name: 'Login', bullets: ['Support login', 'Hash passwords'] };
      const prompt = reader.buildPreflightPrompt(req);
      assert.ok(prompt.includes('## Pre-Implementation Planning'));
      assert.ok(prompt.includes('Login'));
      assert.ok(prompt.includes('Support login'));
      assert.ok(prompt.includes('Files to modify/create'));
      assert.ok(prompt.includes('Files to read first'));
      assert.ok(prompt.includes('Risks'));
      assert.ok(prompt.includes('Approach'));
      assert.ok(prompt.includes('under 200 words'));
    });

    it('works without extra arguments', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildPreflightPrompt(req);
      assert.ok(prompt.includes('## Pre-Implementation Planning'));
    });
  });

  describe('buildImplementationPrompt', () => {
    it('works without optional arguments', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildImplementationPrompt(req);
      assert.ok(prompt.includes('## Your Assignment'));
      assert.ok(prompt.includes('## Instructions'));
      assert.ok(!prompt.includes('## Your Pre-Implementation Plan'));
    });

    it('injects preflightPlan before instructions', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const plan = '1. Modify src/auth.js\n2. Read src/index.js\n3. Risk: none\n4. Add login route';
      const prompt = reader.buildImplementationPrompt(req, plan);
      assert.ok(prompt.includes('## Your Pre-Implementation Plan'));
      assert.ok(prompt.includes('Modify src/auth.js'));
      assert.ok(prompt.includes('Follow the plan above'));
      const planIdx = prompt.indexOf('## Your Pre-Implementation Plan');
      const instructionsIdx = prompt.indexOf('## Instructions');
      assert.ok(planIdx < instructionsIdx, 'plan should be before instructions');
    });

    it('works without preflightPlan', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildImplementationPrompt(req, null);
      assert.ok(!prompt.includes('## Your Pre-Implementation Plan'));
    });

    it('includes peer context section when peerContext is provided', () => {
      const req = { name: 'Login', bullets: ['Support login', 'Add auth route'] };
      const peerContext = [
        { personaName: 'Taylor', requirementName: 'User Profile', bullets: ['Show profile page', 'Edit profile'] }
      ];
      const prompt = reader.buildImplementationPrompt(req, null, peerContext);
      assert.ok(prompt.includes('## Parallel Work (Other Agents)'));
      assert.ok(prompt.includes('Taylor'));
      assert.ok(prompt.includes('User Profile'));
      assert.ok(prompt.includes('Show profile page'));
    });

    it('omits peer context when peerContext is empty', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildImplementationPrompt(req, null, []);
      assert.ok(!prompt.includes('## Parallel Work'));
    });

    it('includes phase context section when phaseContext is provided', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const phaseCtx = [
        { id: 'database-schema', description: 'Database schema setup' }
      ];
      const prompt = reader.buildImplementationPrompt(req, null, null, phaseCtx);
      assert.ok(prompt.includes('## Already Completed This Phase'));
      assert.ok(prompt.includes('database-schema'));
      assert.ok(prompt.includes('Database schema setup'));
    });

    it('omits phase context when phaseContext is empty', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildImplementationPrompt(req, null, null, []);
      assert.ok(!prompt.includes('## Already Completed This Phase'));
    });

    it('includes shared file warning when keyword overlap exists', () => {
      const req = { name: 'Auth', bullets: ['Add auth route', 'Add API endpoint'] };
      const peerContext = [
        { personaName: 'Sam', requirementName: 'Profile API', bullets: ['Add profile API endpoint'] }
      ];
      const prompt = reader.buildImplementationPrompt(req, null, peerContext);
      assert.ok(prompt.includes('Shared file warning'));
      assert.ok(prompt.includes('route') || prompt.includes('api') || prompt.includes('endpoint'));
    });
  });

  describe('_detectSharedFileKeywords', () => {
    it('returns warning when keywords overlap', () => {
      const result = OpenSpecReader._detectSharedFileKeywords(
        ['Add user route', 'Create API handler'],
        ['Add admin route', 'Build API controller']
      );
      assert.ok(result.includes('Shared file warning'));
      assert.ok(result.includes('route'));
      assert.ok(result.includes('api'));
    });

    it('returns empty string when no overlap', () => {
      const result = OpenSpecReader._detectSharedFileKeywords(
        ['Send email notifications'],
        ['Run database migration']
      );
      assert.equal(result, '');
    });

    it('handles empty arrays', () => {
      assert.equal(OpenSpecReader._detectSharedFileKeywords([], []), '');
      assert.equal(OpenSpecReader._detectSharedFileKeywords(null, null), '');
    });
  });

  describe('buildRetryPrompt', () => {
    it('produces retry prompt with error context', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildRetryPrompt(req, 'Tests failed');
      assert.ok(prompt.includes('## Previous Attempt Results'));
      assert.ok(prompt.includes('Tests failed'));
    });

    it('includes strategy-shift recommendation on attempt 2', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildRetryPrompt(req, 'Tests failed', 2, []);
      assert.ok(prompt.includes('## Strategy Shift Recommended'));
      assert.ok(prompt.includes('consider whether a fundamentally different strategy'));
      assert.ok(!prompt.includes('## Strategy Shift Required'));
    });

    it('includes strategy-shift requirement on attempt 3', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildRetryPrompt(req, 'Tests failed', 3, []);
      assert.ok(prompt.includes('## Strategy Shift Required'));
      assert.ok(prompt.includes('This is your final attempt'));
      assert.ok(prompt.includes('You MUST try a significantly different strategy'));
    });

    it('includes attempt history section when history is non-empty', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const history = [
        { attempt: 1, error: 'TypeError: Cannot read property', type: 'implementation' },
        { attempt: 2, error: 'Test timeout after 5000ms', type: 'test' }
      ];
      const prompt = reader.buildRetryPrompt(req, 'Still failing', 3, history);
      assert.ok(prompt.includes('## Attempt History'));
      assert.ok(prompt.includes('Attempt 1: TypeError: Cannot read property'));
      assert.ok(prompt.includes('Attempt 2: Test timeout after 5000ms'));
      assert.ok(prompt.includes('different failure modes'));
    });

    it('notes consistent failure type in history section', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const history = [
        { attempt: 1, error: 'TypeError: x is undefined', type: 'test' },
        { attempt: 2, error: 'TypeError: y is null', type: 'test' }
      ];
      const prompt = reader.buildRetryPrompt(req, 'Still failing', 3, history);
      assert.ok(prompt.includes('same type of failure'));
    });

    it('omits strategy-shift and history when attemptNumber not provided', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildRetryPrompt(req, 'Tests failed');
      assert.ok(!prompt.includes('## Strategy Shift'));
      assert.ok(!prompt.includes('## Attempt History'));
      assert.ok(prompt.includes('## Previous Attempt Results'));
    });

    it('truncates error context longer than 2000 chars', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const longError = 'x'.repeat(3000);
      const prompt = reader.buildRetryPrompt(req, longError, 2, []);
      assert.ok(prompt.includes('... (truncated, 1000 chars omitted)'));
      assert.ok(!prompt.includes('x'.repeat(3000)));
    });

    it('does not truncate error context under 2000 chars', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const shortError = 'x'.repeat(1500);
      const prompt = reader.buildRetryPrompt(req, shortError, 2, []);
      assert.ok(!prompt.includes('truncated'));
      assert.ok(prompt.includes(shortError));
    });

    it('collapses older attempt history when 3+ entries', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const history = [
        { attempt: 1, error: 'TypeError: x', type: 'implementation' },
        { attempt: 2, error: 'Tests failed: y', type: 'test' },
        { attempt: 3, error: 'Import error: z', type: 'implementation' }
      ];
      const prompt = reader.buildRetryPrompt(req, 'Still failing', 4, history);
      assert.ok(prompt.includes('Attempts 1-1:'));
      assert.ok(prompt.includes('Attempt 2: Tests failed: y'));
      assert.ok(prompt.includes('Attempt 3: Import error: z'));
      // Should NOT show "Attempt 1:" individually
      assert.ok(!prompt.includes('- Attempt 1: TypeError'));
    });

    it('does not collapse history when fewer than 3 entries', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const history = [
        { attempt: 1, error: 'TypeError: x', type: 'implementation' },
        { attempt: 2, error: 'Tests failed: y', type: 'test' }
      ];
      const prompt = reader.buildRetryPrompt(req, 'Still failing', 3, history);
      assert.ok(prompt.includes('Attempt 1: TypeError: x'));
      assert.ok(prompt.includes('Attempt 2: Tests failed: y'));
      assert.ok(!prompt.includes('Attempts 1-'));
    });
  });

  describe('parseConventions', () => {
    it('returns file contents when conventions.md exists', async () => {
      const conventionsContent = '# Project Conventions\n\n## Testing\n- Framework: Jest\n';
      fs.readFile = async (filePath) => {
        if (filePath.includes('conventions.md')) return conventionsContent;
        if (filePath.includes('project.md')) return SAMPLE_PROJECT_MD;
        throw new Error(`ENOENT: no such file: ${filePath}`);
      };
      reader = new OpenSpecReader('/fake/project');
      const result = await reader.parseConventions();
      assert.equal(result, conventionsContent);
    });

    it('returns null when conventions.md does not exist', async () => {
      const result = await reader.parseConventions();
      assert.equal(result, null);
    });
  });

  describe('parseGotchas', () => {
    it('returns file contents when gotchas.md exists', async () => {
      const gotchasContent = '# Gotchas\n\n- Do not use require() for ESM modules\n';
      fs.readFile = async (filePath) => {
        if (filePath.includes('gotchas.md')) return gotchasContent;
        if (filePath.includes('project.md')) return SAMPLE_PROJECT_MD;
        throw new Error(`ENOENT: no such file: ${filePath}`);
      };
      reader = new OpenSpecReader('/fake/project');
      const result = await reader.parseGotchas();
      assert.equal(result, gotchasContent);
    });

    it('returns null when gotchas.md does not exist', async () => {
      const result = await reader.parseGotchas();
      assert.equal(result, null);
    });
  });

  describe('hasDesignSkills', () => {
    it('returns true when .claude/skills/frontend-design exists', async () => {
      fs.access = async (p) => {
        if (p.includes('.claude/skills/frontend-design')) return;
        throw new Error('ENOENT');
      };
      const result = await reader.hasDesignSkills();
      assert.equal(result, true);
    });

    it('returns false when .claude/skills/frontend-design does not exist', async () => {
      fs.access = async () => { throw new Error('ENOENT'); };
      const result = await reader.hasDesignSkills();
      assert.equal(result, false);
    });
  });

  describe('getDesignSkillsSection', () => {
    it('returns design instructions when skills are present', async () => {
      fs.access = async () => {};
      const result = await reader.getDesignSkillsSection();
      assert.ok(result.includes('/polish'));
      assert.ok(result.includes('/audit'));
      assert.ok(result.includes('.tsx'));
    });

    it('returns empty string when skills are absent', async () => {
      fs.access = async () => { throw new Error('ENOENT'); };
      const result = await reader.getDesignSkillsSection();
      assert.equal(result, '');
    });
  });

  describe('buildReviewPrompt with design skills', () => {
    it('includes design quality section when designSkillsSection is provided', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildReviewPrompt(req, 'diff', '1 file', [], 'design skills present');
      assert.ok(prompt.includes('## Design Quality Review'));
      assert.ok(prompt.includes('design_quality'));
      assert.ok(prompt.includes('spacing'));
      assert.ok(prompt.includes('WCAG AA'));
    });

    it('omits design quality section when designSkillsSection is empty', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildReviewPrompt(req, 'diff', '1 file', [], '');
      assert.ok(!prompt.includes('## Design Quality Review'));
      assert.ok(!prompt.includes('design_quality'));
    });

    it('omits design quality section when designSkillsSection is not provided', () => {
      const req = { name: 'Login', bullets: ['Support login'] };
      const prompt = reader.buildReviewPrompt(req, 'diff', '1 file');
      assert.ok(!prompt.includes('## Design Quality Review'));
    });
  });
});
