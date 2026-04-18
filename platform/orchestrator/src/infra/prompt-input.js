/**
 * Read multi-line input from a readline interface.
 * Collects lines until user enters an empty line.
 * Single-line: type, Enter, Enter. Multi-line: type lines, blank line to submit.
 *
 * @param {readline.Interface} rl - readline interface
 * @param {string} prompt - prompt shown for the first line
 * @param {string} continuation - prompt shown for subsequent lines
 * @returns {Promise<string>} trimmed input joined with \n, or '' if empty
 */
function readMultiLineInput(rl, prompt = '\n  You: ', continuation = '    > ') {
  return new Promise((resolve) => {
    const lines = [];

    const collectLine = () => {
      rl.question(lines.length === 0 ? prompt : continuation, (line) => {
        if (line.trim() === '' && lines.length > 0) {
          resolve(lines.join('\n'));
          return;
        }
        if (line.trim() === '' && lines.length === 0) {
          resolve('');
          return;
        }
        lines.push(line);
        collectLine();
      });
    };

    collectLine();
  });
}

module.exports = { readMultiLineInput };
