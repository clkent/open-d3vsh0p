const { spawn: childSpawn } = require('child_process');

/** A server that dies this fast never served a session — likely an auth/eligibility failure. */
const RAPID_EXIT_MS = 15 * 1000;
/** Consecutive rapid exits before giving up with guidance. */
const MAX_RAPID_EXITS = 3;
/** Restart backoff (ms) after a normal exit, e.g. the ~10 min network give-up. */
const BACKOFF_MS = [5 * 1000, 15 * 1000, 60 * 1000, 5 * 60 * 1000];

const GUIDANCE = [
  'The Remote Control server keeps exiting immediately. Usual causes:',
  '  - not signed in to claude.ai in this environment: run `claude auth login`',
  '  - a token from `claude setup-token` / CLAUDE_CODE_OAUTH_TOKEN (cannot establish Remote Control)',
  '  - Remote Control disabled for a Team/Enterprise org (an Owner must enable it)',
  'Run `claude doctor` for the specific eligibility check that failed.'
];

/**
 * Run `claude remote-control` in the control directory and keep it running.
 * Server mode exits on its own after a long network outage; each restart
 * passes --continue so the operator's control session is resumed rather
 * than recreated. Rapid consecutive exits mean the account can't use Remote
 * Control — stop and say so instead of looping. SIGINT/SIGTERM stop the loop.
 *
 * @returns {Promise<number>} exit code for the CLI
 */
async function runControlServer({ controlDir, serverName, deps = {} }) {
  const {
    spawn = childSpawn,
    log = console.log,
    now = Date.now,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    signals = process
  } = deps;

  let child = null;
  let stopping = false;
  let served = false; // a session was created at least once → resume it with --continue
  let attempt = 0;
  let rapidExits = 0;

  const stop = () => {
    stopping = true;
    if (child) child.kill('SIGTERM');
  };
  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);

  try {
    while (!stopping) {
      const args = ['remote-control', '--name', serverName, '--spawn', 'session'];
      if (served) args.push('--continue');

      const startedAt = now();
      child = spawn('claude', args, { cwd: controlDir, stdio: 'inherit', env: { ...process.env } });
      const code = await new Promise((resolve) => {
        child.on('exit', (c) => resolve(c ?? 0));
        child.on('error', () => resolve(-1));
      });
      child = null;
      if (stopping) break;

      const ranMs = now() - startedAt;
      if (ranMs < RAPID_EXIT_MS) {
        rapidExits++;
        if (rapidExits >= MAX_RAPID_EXITS) {
          log('');
          for (const line of GUIDANCE) log(`  ${line}`);
          log('');
          return 1;
        }
      } else {
        rapidExits = 0;
        attempt = 0;
        served = true;
      }

      const waitMs = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt++;
      log(`  ~ [remote] control server exited (code ${code}) — restarting in ${Math.round(waitMs / 1000)}s${served ? ' with --continue' : ''}`);
      await sleep(waitMs);
    }
    return 0;
  } finally {
    signals.off('SIGINT', stop);
    signals.off('SIGTERM', stop);
  }
}

module.exports = { runControlServer, RAPID_EXIT_MS, MAX_RAPID_EXITS, BACKOFF_MS };
