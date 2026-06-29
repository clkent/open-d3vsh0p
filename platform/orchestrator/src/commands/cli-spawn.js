const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

/**
 * Build CLI args array for the claude command.
 * Pure function — easy to test without spawning a process.
 */
function buildClaudeArgs({ appendSystemPrompt, model, sessionId, resume, continueSession, name, initialPrompt }) {
  const args = ['--dangerously-skip-permissions'];

  if (resume) {
    args.push('--resume', resume);
  } else if (continueSession) {
    args.push('--continue');
  } else {
    if (appendSystemPrompt) {
      args.push('--append-system-prompt', appendSystemPrompt);
    }
    if (sessionId) {
      args.push('--session-id', sessionId);
    }
  }

  if (model) {
    args.push('--model', model);
  }

  if (name) {
    args.push('--name', name);
  }

  // Positional prompt must come last
  if (initialPrompt) {
    args.push(initialPrompt);
  }

  return args;
}

/**
 * Spawn a real Claude Code terminal session with stdio: 'inherit'.
 * Returns a promise that resolves with the exit code when the user exits.
 */
function spawnClaudeTerminal({ projectDir, appendSystemPrompt, model, sessionId, resume, continueSession, name, initialPrompt }) {
  const args = buildClaudeArgs({ appendSystemPrompt, model, sessionId, resume, continueSession, name, initialPrompt });

  const proc = spawn('claude', args, {
    stdio: 'inherit',
    cwd: projectDir,
    env: { ...process.env }
  });

  return new Promise((resolve, reject) => {
    proc.on('exit', (code) => resolve(code ?? 0));
    proc.on('error', reject);
  });
}

/**
 * Save a CLI session ID for future resume.
 * @param {string} stateDir - Directory to save state in
 * @param {string} sessionId - Claude session ID
 * @param {string} type - Session type (e.g. 'talk', 'kickoff', 'pair')
 */
async function saveCliSession(stateDir, sessionId, type) {
  if (!sessionId) return;
  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, `${type}-session.json`),
      JSON.stringify({ sessionId, savedAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // Best effort
  }
}

/**
 * Load a previously saved CLI session ID for resume.
 * @param {string} stateDir - Directory to load state from
 * @param {string} type - Session type (e.g. 'talk', 'kickoff', 'pair')
 * @returns {Promise<string|null>} Session ID or null
 */
async function loadCliSession(stateDir, type) {
  try {
    const raw = await fs.readFile(path.join(stateDir, `${type}-session.json`), 'utf-8');
    const state = JSON.parse(raw);
    return state.sessionId || null;
  } catch {
    return null;
  }
}

module.exports = { buildClaudeArgs, spawnClaudeTerminal, saveCliSession, loadCliSession };
