const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFile, exec } = require('./exec-utils');

describe('exec-utils', () => {
  describe('execFile', () => {
    it('executes a command and returns stdout', async () => {
      const { stdout } = await execFile('echo', ['hello']);
      assert.equal(stdout.trim(), 'hello');
    });

    it('rejects on invalid command', async () => {
      await assert.rejects(
        () => execFile('nonexistent-command-xyz', []),
        (err) => err.code === 'ENOENT'
      );
    });
  });

  describe('exec', () => {
    it('executes a shell command and returns stdout', async () => {
      const { stdout } = await exec('echo hello');
      assert.equal(stdout.trim(), 'hello');
    });

    it('returns stderr for stderr output', async () => {
      const { stderr } = await exec('echo error >&2');
      assert.equal(stderr.trim(), 'error');
    });
  });
});
