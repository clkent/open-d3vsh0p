const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readMultiLineInput } = require('./prompt-input');

/**
 * Create a fake readline interface that feeds answers in sequence.
 * Each call to rl.question() pops the next answer and calls the callback.
 */
function fakeRl(answers) {
  const prompts = [];
  return {
    rl: {
      question(prompt, cb) {
        prompts.push(prompt);
        const answer = answers.shift();
        cb(answer);
      }
    },
    prompts
  };
}

describe('readMultiLineInput', () => {
  it('returns single line when followed by blank line', async () => {
    const { rl } = fakeRl(['hello world', '']);
    const result = await readMultiLineInput(rl);
    assert.equal(result, 'hello world');
  });

  it('returns multiple lines joined with newline', async () => {
    const { rl } = fakeRl(['line one', 'line two', 'line three', '']);
    const result = await readMultiLineInput(rl);
    assert.equal(result, 'line one\nline two\nline three');
  });

  it('returns empty string on immediate blank line', async () => {
    const { rl } = fakeRl(['']);
    const result = await readMultiLineInput(rl);
    assert.equal(result, '');
  });

  it('returns empty string for whitespace-only first line', async () => {
    const { rl } = fakeRl(['   ']);
    const result = await readMultiLineInput(rl);
    assert.equal(result, '');
  });

  it('command words on first line are returned as-is', async () => {
    const { rl } = fakeRl(['done', '']);
    const result = await readMultiLineInput(rl);
    assert.equal(result, 'done');
  });

  it('uses custom prompt for first line and continuation for rest', async () => {
    const { rl, prompts } = fakeRl(['a', 'b', '']);
    await readMultiLineInput(rl, '> ', '... ');
    assert.equal(prompts[0], '> ');
    assert.equal(prompts[1], '... ');
    assert.equal(prompts[2], '... ');
  });

  it('uses default prompts when not specified', async () => {
    const { rl, prompts } = fakeRl(['text', '']);
    await readMultiLineInput(rl);
    assert.equal(prompts[0], '\n  You: ');
    assert.equal(prompts[1], '    > ');
  });

  it('preserves leading/trailing whitespace within lines', async () => {
    const { rl } = fakeRl(['  indented', 'trailing  ', '']);
    const result = await readMultiLineInput(rl);
    assert.equal(result, '  indented\ntrailing  ');
  });
});
