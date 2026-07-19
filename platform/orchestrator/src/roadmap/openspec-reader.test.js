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

});
