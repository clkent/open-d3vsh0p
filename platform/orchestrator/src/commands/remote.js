const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('../infra/exec-utils');
const { loadRegistry, resolveProject, DEVSHOP_ROOT } = require('../infra/registry');
const { loadConfig } = require('../infra/config');
const { Tmux, sessionName, isValidId, LAUNCH_COMMANDS, CONTROL_SESSION } = require('../remote/tmux');
const { ensureControlDir, CONTROL_DIR } = require('../remote/control-dir');
const { runControlServer } = require('../remote/server');
const { REMOTE_LABEL, INDEX_JS, remotePlistPath, buildRemotePlist } = require('../remote/remote-plist');

const SUBCOMMANDS = ['start', 'install', 'remove', 'status', 'launch', 'sessions', 'stop'];
/** Wait this long for `/exit` to end a session before sending Ctrl-C. */
const STOP_GRACE_MS = 30 * 1000;
const STOP_POLL_MS = 1000;
const SESSION_URL_PATTERN = /https:\/\/claude\.ai\/code\/[A-Za-z0-9_-]+/;

function agentSessionName(command, projectId) {
  if (command === 'kickoff') return `Riley — ${projectId} kickoff`;
  if (command === 'talk') return `Riley — ${projectId}`;
  return `Morgan — ${projectId}`;
}

function defaultDeps() {
  return {
    tmux: new Tmux(),
    exec: execFile,
    log: console.log,
    error: console.error,
    loadRegistry,
    loadConfig,
    ensureControlDir,
    runControlServer,
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    nodePath: process.execPath,
    fs,
    home: require('os').homedir()
  };
}

/**
 * `devshop remote <subcommand> [args] [options]`
 * @param {string} subcommand
 * @param {string[]} args - positional args after the subcommand
 * @param {object} values - parsed CLI options (resume, command)
 */
async function remoteCommand(subcommand, args = [], values = {}, deps = defaultDeps()) {
  switch (subcommand) {
    case 'start': return handleStart(deps);
    case 'install': return handleInstall(deps);
    case 'remove': return handleRemove(deps);
    case 'status': return handleStatus(deps);
    case 'launch': return handleLaunch(args[0], args[1], { resume: !!values.resume }, deps);
    case 'sessions': return handleSessions(deps);
    case 'stop': return handleStop(args[0], { command: values.command || null }, deps);
    default:
      deps.error(`Unknown remote subcommand: ${subcommand || '(none)'}`);
      deps.error(`Available: ${SUBCOMMANDS.join(', ')}`);
      return 1;
  }
}

async function handleLaunch(command, target, { resume }, deps) {
  const { tmux, log, error } = deps;
  if (!LAUNCH_COMMANDS.includes(command)) {
    error(`Cannot launch ${JSON.stringify(command ?? '')}. Allowed: ${LAUNCH_COMMANDS.join(', ')}`);
    return 1;
  }
  if (!target) {
    error(command === 'kickoff' ? 'A new project name is required.' : 'A project ID or name is required.');
    return 1;
  }

  let projectId;
  if (command === 'kickoff') {
    if (!isValidId(target)) {
      error(`Project name must be kebab-case (letters, digits, dashes): ${JSON.stringify(target)}`);
      return 1;
    }
    projectId = target;
  } else {
    const registry = await deps.loadRegistry();
    const project = resolveProject(registry, target); // prints available projects on miss
    if (!project) return 1;
    projectId = project.id;
  }

  const name = sessionName(projectId, command);
  if (await tmux.hasSession(name)) {
    error(`A ${command} session for ${projectId} is already running: ${name}`);
    error(`  Attach: tmux attach -t ${name}`);
    error(`  Stop:   devshop remote stop ${projectId}${command !== 'run' ? ` --command ${command}` : ''}`);
    return 1;
  }

  const argv = [deps.nodePath, INDEX_JS, command, projectId, '--remote-control'];
  if (resume && command !== 'kickoff') argv.push('--resume');
  await tmux.newSession({ name, cwd: DEVSHOP_ROOT, argv, detached: true });

  log(`Started ${command} for ${projectId} in tmux session ${name}`);
  log(`  App session: ${agentSessionName(command, projectId)} (appears in the Claude app in a few seconds)`);
  log(`  Attach:      tmux attach -t ${name}`);
  return 0;
}

async function handleSessions(deps) {
  const { tmux, log } = deps;
  const sessions = (await tmux.listSessions()).filter(s => s.name !== CONTROL_SESSION);
  if (sessions.length === 0) {
    log('No remote sessions');
    return 0;
  }
  for (const s of sessions) {
    const what = s.projectId ? `${s.projectId}  ${s.command}` : '(unrecognized)';
    log(`${s.name}  ${what}  up ${s.age}`);
  }
  return 0;
}

async function handleStop(target, { command }, deps) {
  const { tmux, log, error, sleep } = deps;
  if (!target) {
    error('A project ID or name is required.');
    return 1;
  }
  const registry = await deps.loadRegistry();
  const project = resolveProject(registry, target);
  if (!project) return 1;

  const matching = (await tmux.listSessions())
    .filter(s => s.projectId === project.id && (!command || s.command === command));
  if (matching.length === 0) {
    log(`No remote sessions for ${project.id}`);
    return 0;
  }

  for (const s of matching) {
    // /exit ends the Claude session; the orchestrator then runs its normal
    // post-session path (health check, summary, consolidation).
    await tmux.sendText(s.name, '/exit');
    let ended = false;
    for (let waited = 0; waited < STOP_GRACE_MS; waited += STOP_POLL_MS) {
      await sleep(STOP_POLL_MS);
      if (!(await tmux.hasSession(s.name))) { ended = true; break; }
    }
    if (ended) {
      log(`${s.name}: ended`);
      continue;
    }
    await tmux.sendKey(s.name, 'C-c');
    log(`${s.name}: sent Ctrl-C after ${STOP_GRACE_MS / 1000}s (still shutting down)`);
  }
  return 0;
}

async function resolveServerName(deps) {
  const config = await deps.loadConfig({});
  return config.remoteControl?.serverName || 'd3vsh0p control';
}

/**
 * Remote Control needs a claude.ai login (not an API key or setup-token).
 * `claude auth status` reports that as JSON; check before starting the
 * server so the failure is a sentence, not three silent exits.
 * Returns null when OK, otherwise the reason.
 */
async function authPreflight(deps) {
  let status;
  try {
    const { stdout } = await deps.exec('claude', ['auth', 'status']);
    status = JSON.parse(stdout);
  } catch {
    return null; // older CLI or unparseable output — let the server decide
  }
  if (status.loggedIn === false) return 'not signed in — run `claude auth login` and choose claude.ai';
  if (status.authMethod && status.authMethod !== 'claude.ai') {
    return `signed in via ${status.authMethod}; Remote Control needs a claude.ai login (\`claude auth login\`)`;
  }
  return null;
}

async function handleStart(deps) {
  const { log, error } = deps;
  const authProblem = await authPreflight(deps);
  if (authProblem) {
    error(`  Remote Control unavailable: ${authProblem}`);
    return 1;
  }
  const registry = await deps.loadRegistry();
  const controlDir = await deps.ensureControlDir({ registry });
  const serverName = await resolveServerName(deps);
  log('');
  log('=== DevShop — Remote Control server ===');
  log(`  Control dir: ${controlDir}`);
  log(`  Session:     ${serverName}`);
  log('  Open it from the Claude app (Code tab) or scan the QR code shown by the server.');
  log('  Ctrl+C stops the server.');
  log('=======================================');
  log('');
  return deps.runControlServer({ controlDir, serverName });
}

async function findTmux(deps) {
  const { stdout } = await deps.exec('which', ['tmux']);
  const tmuxPath = stdout.trim();
  if (!tmuxPath) throw new Error('tmux not found on PATH (brew install tmux)');
  return tmuxPath;
}

async function handleInstall(deps) {
  const { log, error } = deps;
  let tmuxPath;
  try {
    tmuxPath = await findTmux(deps);
  } catch (err) {
    error(`  ${err.message}`);
    return 1;
  }
  const registry = await deps.loadRegistry();
  const controlDir = await deps.ensureControlDir({ registry });
  const logDir = path.join(controlDir, 'logs');
  const plistFile = remotePlistPath(deps.home);

  await deps.fs.mkdir(path.dirname(plistFile), { recursive: true });
  await deps.fs.writeFile(plistFile, buildRemotePlist({ nodePath: deps.nodePath, tmuxPath, logDir, home: deps.home }));
  try { await deps.exec('launchctl', ['unload', plistFile]); } catch { /* not loaded yet */ }
  try {
    await deps.exec('launchctl', ['load', plistFile]);
  } catch (err) {
    error(`  launchctl load failed: ${err.message}`);
    return 1;
  }
  log(`Installed ${REMOTE_LABEL}`);
  log(`  Plist:   ${plistFile}`);
  log(`  Logs:    ${logDir}`);
  log(`  The control server starts now and at every login inside tmux session ${CONTROL_SESSION}.`);
  log(`  Check:   devshop remote status`);
  return 0;
}

async function handleRemove(deps) {
  const { log, tmux } = deps;
  const plistFile = remotePlistPath(deps.home);
  try { await deps.exec('launchctl', ['unload', plistFile]); } catch { /* not loaded */ }
  let removed = false;
  try { await deps.fs.unlink(plistFile); removed = true; } catch { /* not installed */ }
  const killed = await tmux.killSession(CONTROL_SESSION);
  log(`${removed ? 'Removed' : 'No'} plist ${plistFile}`);
  log(`${killed ? 'Stopped' : 'No'} control server session ${CONTROL_SESSION}`);
  return 0;
}

async function handleStatus(deps) {
  const { log, tmux } = deps;
  const plistFile = remotePlistPath(deps.home);
  let installed = false;
  try { await deps.fs.access(plistFile); installed = true; } catch { /* absent */ }

  let loaded = false;
  try {
    const { stdout } = await deps.exec('launchctl', ['list']);
    loaded = stdout.split('\n').some(line => line.trim().endsWith(REMOTE_LABEL));
  } catch { /* launchctl unavailable */ }

  const sessionUp = await tmux.hasSession(CONTROL_SESSION);
  let serverAlive = false;
  try {
    await deps.exec('pgrep', ['-f', 'claude remote-control']);
    serverAlive = true;
  } catch { /* no process */ }

  const pane = sessionUp ? await tmux.capturePane(CONTROL_SESSION) : '';
  const url = pane.match(SESSION_URL_PATTERN)?.[0] || null;

  log('=== Remote Control status ===');
  log(`  launchd plist:  ${installed ? 'installed' : 'not installed'}${loaded ? ', loaded' : installed ? ', not loaded' : ''}`);
  log(`  tmux session:   ${sessionUp ? `${CONTROL_SESSION} up` : 'down'}`);
  log(`  server process: ${serverAlive ? 'running' : 'not running'}`);
  log(`  session URL:    ${url || '(not visible yet)'}`);
  log('');
  log('Remote sessions:');
  const sessions = (await tmux.listSessions()).filter(s => s.name !== CONTROL_SESSION);
  if (sessions.length === 0) log('  (none)');
  for (const s of sessions) log(`  ${s.name}  ${s.projectId || '?'}  ${s.command || '?'}  up ${s.age}`);
  log('=============================');
  return 0;
}

module.exports = { remoteCommand, authPreflight, handleLaunch, handleSessions, handleStop, handleStart, handleInstall, handleRemove, handleStatus, agentSessionName, SUBCOMMANDS, STOP_GRACE_MS };
