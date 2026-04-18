const { spawn } = require('child_process');
const http = require('http');

const DEFAULT_TIMEOUT_SECONDS = 10;
const POLL_INTERVAL_MS = 1000;
const KILL_GRACE_MS = 2000;

/**
 * Spawns a dev server, polls for an HTTP response, and kills the process.
 * Returns { available, responseTimeMs?, reason?, exitCode? }
 */
async function checkPreview({ command, port, timeoutSeconds, workingDir }) {
  const timeout = (timeoutSeconds || DEFAULT_TIMEOUT_SECONDS) * 1000;
  const startTime = Date.now();

  // Split command into program and args (handles "npm run dev" etc.)
  const parts = command.split(/\s+/);
  const prog = parts[0];
  const args = parts.slice(1);

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const child = spawn(prog, args, {
      cwd: workingDir,
      detached: false,
      stdio: 'ignore',
      env: { ...process.env }
    });

    function cleanup(result) {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      killProcess(child);
      resolve(result);
    }

    // Handle process exit before we get a response
    child.on('error', (err) => {
      cleanup({ available: false, reason: 'spawn_error' });
    });

    child.on('exit', (code) => {
      cleanup({ available: false, reason: 'process_exit', exitCode: code });
    });

    // Poll for HTTP response
    pollTimer = setInterval(() => {
      if (settled) return;

      const req = http.get(`http://localhost:${port}`, (res) => {
        // Any status code means the server is alive
        const elapsed = Date.now() - startTime;
        cleanup({ available: true, responseTimeMs: elapsed });
      });

      req.on('error', () => {
        // Server not ready yet — keep polling
      });

      req.setTimeout(800, () => {
        req.destroy();
      });
    }, POLL_INTERVAL_MS);

    // Hard timeout
    timeoutTimer = setTimeout(() => {
      cleanup({ available: false, reason: 'timeout' });
    }, timeout);
  });
}

function killProcess(child) {
  if (!child || child.killed) return;

  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }

  // SIGKILL fallback after grace period
  setTimeout(() => {
    try {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    } catch {
      // Process already gone
    }
  }, KILL_GRACE_MS);
}

module.exports = { checkPreview };
