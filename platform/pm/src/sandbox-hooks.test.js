const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createWriteSandbox } = require('./sandbox-hooks');

describe('createWriteSandbox', () => {
  const projectDir = '/Users/dev/projects/my-app';
  const hooks = createWriteSandbox(projectDir);
  const hook = hooks.preToolUse[0];

  describe('Write tool', () => {
    it('allows writes inside project directory', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/projects/my-app/src/index.ts' }
      });
      assert.equal(result, undefined, 'should not block');
    });

    it('allows writes to nested subdirectories', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/projects/my-app/openspec/specs/auth/spec.md' }
      });
      assert.equal(result, undefined);
    });

    it('blocks writes outside project directory', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/devshop/platform/orchestrator/src/microcycle.js' }
      });
      assert.equal(result.decision, 'block');
      assert.ok(result.message.includes('writes restricted to'));
    });

    it('blocks writes to parent directory', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/projects/other-project/src/index.ts' }
      });
      assert.equal(result.decision, 'block');
    });

    it('blocks writes to root', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/etc/passwd' }
      });
      assert.equal(result.decision, 'block');
    });
  });

  describe('Edit tool', () => {
    it('allows edits inside project directory', () => {
      const result = hook({
        tool: 'Edit',
        input: { file_path: '/Users/dev/projects/my-app/package.json' }
      });
      assert.equal(result, undefined);
    });

    it('blocks edits outside project directory', () => {
      const result = hook({
        tool: 'Edit',
        input: { file_path: '/Users/dev/devshop/CLAUDE.md' }
      });
      assert.equal(result.decision, 'block');
    });
  });

  describe('path traversal', () => {
    it('blocks path traversal with ../ segments', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/projects/my-app/../../devshop/package.json' }
      });
      assert.equal(result.decision, 'block');
    });

    it('blocks deep path traversal', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/projects/my-app/src/../../../devshop/secret.txt' }
      });
      assert.equal(result.decision, 'block');
    });

    it('allows ../ that stays within project dir', () => {
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/projects/my-app/src/../openspec/roadmap.md' }
      });
      assert.equal(result, undefined);
    });
  });

  describe('other tools', () => {
    it('allows Read tool without restriction', () => {
      const result = hook({
        tool: 'Read',
        input: { file_path: '/Users/dev/devshop/platform/orchestrator/src/microcycle.js' }
      });
      assert.equal(result, undefined);
    });

    it('allows Bash tool without restriction', () => {
      const result = hook({
        tool: 'Bash',
        input: { command: 'ls /' }
      });
      assert.equal(result, undefined);
    });

    it('allows Glob tool without restriction', () => {
      const result = hook({
        tool: 'Glob',
        input: { pattern: '**/*.js' }
      });
      assert.equal(result, undefined);
    });
  });

  describe('edge cases', () => {
    it('blocks when no file path provided', () => {
      const result = hook({
        tool: 'Write',
        input: {}
      });
      assert.equal(result.decision, 'block');
      assert.ok(result.message.includes('no file path'));
    });

    it('handles project dir that is a prefix of another dir', () => {
      // /Users/dev/projects/my-app should NOT allow writes to /Users/dev/projects/my-app-other
      const result = hook({
        tool: 'Write',
        input: { file_path: '/Users/dev/projects/my-app-other/src/index.ts' }
      });
      assert.equal(result.decision, 'block');
    });
  });
});
