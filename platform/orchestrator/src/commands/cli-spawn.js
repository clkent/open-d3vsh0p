const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

/**
 * Build CLI args array for the claude command.
 * Pure function — easy to test without spawning a process.
 */
function buildClaudeArgs({ appendSystemPrompt, model, sessionId, resume, continueSession, name, remoteControl, initialPrompt }) {
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

  // Remote Control: the same session is also reachable from the Claude app.
  // `--remote-control` takes an optional display name, so a name is always
  // supplied — otherwise the positional prompt would be consumed as the name.
  if (remoteControl) {
    args.push('--remote-control', name || 'd3vsh0p');
  }

  // Positional prompt must come last
  if (initialPrompt) {
    args.push(initialPrompt);
  }

  return args;
}

/**
 * Spawn a real Claude Code terminal session with stdio: 'inherit'.
 * Returns { promise, proc } where promise resolves with the exit code
 * and proc is the child process (for timeout killing).
 */
function spawnClaudeTerminal({ projectDir, appendSystemPrompt, model, sessionId, resume, continueSession, name, remoteControl, initialPrompt }) {
  const args = buildClaudeArgs({ appendSystemPrompt, model, sessionId, resume, continueSession, name, remoteControl, initialPrompt });

  const proc = spawn('claude', args, {
    stdio: 'inherit',
    cwd: projectDir,
    env: { ...process.env }
  });

  const promise = new Promise((resolve, reject) => {
    proc.on('exit', (code) => resolve(code ?? 0));
    proc.on('error', reject);
  });

  return { promise, proc };
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
    const { isValidSessionId } = require('./limit-resume');
    if (!isValidSessionId(state.sessionId)) {
      // Saved state is untrusted local runtime data — a non-UUID value must
      // never reach a file path or a `claude --resume` argument.
      if (state.sessionId) {
        console.warn(`  ~ [session] Ignoring invalid saved session ID in ${type}-session.json — starting fresh.`);
      }
      return null;
    }
    return state.sessionId;
  } catch {
    return null;
  }
}

module.exports = { buildClaudeArgs, spawnClaudeTerminal, saveCliSession, loadCliSession };
