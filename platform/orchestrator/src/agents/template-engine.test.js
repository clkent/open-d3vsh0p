const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');

describe('TemplateEngine', () => {
  let TemplateEngine, engine;
  let originalReadFile;

  // In-memory file system for mocking
  const files = {
    '/templates/test-agent/system-prompt.md': 'Hello {{NAME}}, you are {{ROLE}}.',
    '/templates/test-agent/config.json': '{"model":"test-model","timeout":1000}',
    '/templates/partial-agent/system-prompt.md': 'Start {{>common_header}} end.',
    '/templates/_shared/common_header.md': 'SHARED HEADER CONTENT\n',
    '/templates/multi-partial/system-prompt.md': '{{>common_header}} middle {{>common_footer}}',
    '/templates/_shared/common_footer.md': 'SHARED FOOTER\n',
    '/templates/vars-after-partial/system-prompt.md': '{{>common_header}} {{PROJECT_ID}}',
    '/templates/gotchas-agent/system-prompt.md': '{{>project-gotchas}} done',
    '/templates/_shared/project-gotchas.md': '## Project Gotchas\n\n{{PROJECT_GOTCHAS}}\n',
    '/templates/design-agent/system-prompt.md': 'Start {{>design-skills}} End',
    '/templates/_shared/design-skills.md': '{{DESIGN_SKILLS_SECTION}}',
  };

  beforeEach(() => {
    originalReadFile = fs.readFile;
    fs.readFile = async (filePath, ...args) => {
      const content = files[filePath];
      if (content !== undefined) return content;
      throw new Error(`ENOENT: no such file: ${filePath}`);
    };

    delete require.cache[require.resolve('./template-engine')];
    ({ TemplateEngine } = require('./template-engine'));
    engine = new TemplateEngine('/templates');
  });

  afterEach(() => {
    fs.readFile = originalReadFile;
  });

  describe('renderString', () => {
    it('replaces a single variable', () => {
      assert.equal(engine.renderString('Hi {{NAME}}!', { NAME: 'World' }), 'Hi World!');
    });

    it('replaces multiple variables', () => {
      const result = engine.renderString('{{A}} and {{B}}', { A: 'one', B: 'two' });
      assert.equal(result, 'one and two');
    });

    it('replaces repeated occurrences of the same variable', () => {
      const result = engine.renderString('{{X}} {{X}} {{X}}', { X: 'hi' });
      assert.equal(result, 'hi hi hi');
    });

    it('leaves unreferenced placeholders unchanged', () => {
      const result = engine.renderString('{{A}} {{B}}', { A: 'yes' });
      assert.equal(result, 'yes {{B}}');
    });

    it('handles empty vars', () => {
      const result = engine.renderString('no vars here', {});
      assert.equal(result, 'no vars here');
    });

    it('handles empty template', () => {
      const result = engine.renderString('', { A: '1' });
      assert.equal(result, '');
    });

    it('escapes template syntax in variable values', () => {
      const result = engine.renderString('Hello {{NAME}}', { NAME: 'test {{INJECTED}}' });
      assert.equal(result, 'Hello test \\{\\{INJECTED\\}\\}');
    });

    it('does not expand escaped template vars in values', () => {
      const result = engine.renderString('{{A}} and {{B}}', {
        A: 'value with {{B}}',
        B: 'real-B'
      });
      // A's value has {{B}} escaped, so B in A's value is not expanded
      assert.equal(result, 'value with \\{\\{B\\}\\} and real-B');
    });
  });

  describe('renderAgentPrompt', () => {
    it('reads template and replaces variables', async () => {
      const result = await engine.renderAgentPrompt('test-agent', {
        NAME: 'Claude',
        ROLE: 'assistant'
      });
      assert.equal(result, 'Hello Claude, you are assistant.');
    });

    it('resolves {{>partial}} includes', async () => {
      const result = await engine.renderAgentPrompt('partial-agent', {});
      assert.equal(result, 'Start SHARED HEADER CONTENT end.');
    });

    it('replaces variables after partials are resolved', async () => {
      // common_header content doesn't have vars, but PROJECT_ID should still be replaced
      const result = await engine.renderAgentPrompt('vars-after-partial', {
        PROJECT_ID: 'proj-42'
      });
      assert.equal(result, 'SHARED HEADER CONTENT proj-42');
    });

    it('resolves multiple partials', async () => {
      const result = await engine.renderAgentPrompt('multi-partial', {});
      assert.equal(result, 'SHARED HEADER CONTENT middle SHARED FOOTER');
    });

    it('resolves project-gotchas partial with PROJECT_GOTCHAS variable', async () => {
      const result = await engine.renderAgentPrompt('gotchas-agent', {
        PROJECT_GOTCHAS: '- Never use require() for ESM'
      });
      assert.ok(result.includes('## Project Gotchas'));
      assert.ok(result.includes('- Never use require() for ESM'));
      assert.ok(result.includes('done'));
    });
  });

  describe('getAgentConfig', () => {
    it('returns parsed JSON config', async () => {
      const config = await engine.getAgentConfig('test-agent');
      assert.deepEqual(config, { model: 'test-model', timeout: 1000 });
    });

    it('returns empty object when config is missing', async () => {
      const config = await engine.getAgentConfig('nonexistent-agent');
      assert.deepEqual(config, {});
    });
  });

  describe('design-skills partial', () => {
    it('renders design instructions when DESIGN_SKILLS_SECTION is provided', async () => {
      const result = await engine.renderAgentPrompt('design-agent', {
        DESIGN_SKILLS_SECTION: '## Design Skills\nRun /polish on .tsx files'
      });
      assert.equal(result, 'Start ## Design Skills\nRun /polish on .tsx files End');
    });

    it('renders empty when DESIGN_SKILLS_SECTION is empty string', async () => {
      const result = await engine.renderAgentPrompt('design-agent', {
        DESIGN_SKILLS_SECTION: ''
      });
      assert.equal(result, 'Start  End');
    });
  });

  describe('partial caching', () => {
    it('first access reads disk', async () => {
      let readCount = 0;
      const mockReadFile = fs.readFile;
      fs.readFile = async (filePath, ...args) => {
        if (filePath.includes('_shared/')) readCount++;
        return mockReadFile(filePath, ...args);
      };

      await engine.renderAgentPrompt('partial-agent', {});
      assert.equal(readCount, 1);

      fs.readFile = mockReadFile;
    });

    it('second access uses cache (no additional disk read)', async () => {
      let readCount = 0;
      const mockReadFile = fs.readFile;
      fs.readFile = async (filePath, ...args) => {
        if (filePath.includes('_shared/common_header')) readCount++;
        return mockReadFile(filePath, ...args);
      };

      await engine.renderAgentPrompt('partial-agent', {});
      await engine.renderAgentPrompt('partial-agent', {});
      // Only 1 read of the partial (first was cached)
      assert.equal(readCount, 1);

      fs.readFile = mockReadFile;
    });
  });
});
