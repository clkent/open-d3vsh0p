const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('child_process');
const path = require('path');
const { buildClaudeArgs } = require('./cli-spawn');

describe('buildClaudeArgs — Remote Control', () => {
  it('omits --remote-control by default', () => {
    const args = buildClaudeArgs({ name: 'Morgan — my-app', initialPrompt: 'go' });
    assert.ok(!args.includes('--remote-control'));
  });

  it('adds --remote-control followed by the session name when enabled', () => {
    const args = buildClaudeArgs({ name: 'Morgan — my-app', remoteControl: true, initialPrompt: 'go' });
    const i = args.indexOf('--remote-control');
    assert.ok(i >= 0);
    assert.equal(args[i + 1], 'Morgan — my-app');
  });

  it('always supplies a name value so the positional prompt is not consumed as the name', () => {
    const args = buildClaudeArgs({ remoteControl: true, initialPrompt: 'Read the roadmap' });
    const i = args.indexOf('--remote-control');
    assert.equal(args[i + 1], 'd3vsh0p');
    assert.equal(args[args.length - 1], 'Read the roadmap');
  });

  it('keeps the flag on --resume respawns', () => {
    const args = buildClaudeArgs({ resume: '550e8400-e29b-41d4-a716-446655440000', name: 'Morgan — my-app', remoteControl: true, initialPrompt: 'continue' });
    assert.ok(args.includes('--resume'));
    assert.ok(args.includes('--remote-control'));
    assert.equal(args[args.length - 1], 'continue');
  });

  it('is false-y safe: null and undefined both disable it', () => {
    assert.ok(!buildClaudeArgs({ name: 'x', remoteControl: null }).includes('--remote-control'));
    assert.ok(!buildClaudeArgs({ name: 'x', remoteControl: undefined }).includes('--remote-control'));
  });
});

describe('--remote-control CLI flag', () => {
  it('is documented in CLI help output', async () => {
    const indexPath = path.join(__dirname, '..', 'index.js');
    const stdout = await new Promise((resolve, reject) => {
      execFile('node', [indexPath, 'help'], (err, out) => err ? reject(err) : resolve(out));
    });
    assert.match(stdout, /--remote-control\s+Also expose the session in the Claude app/);
  });
});
