const path = require('path');
const { getEnabledWindows } = require('./window-config');
const { execFile: exec } = require('../infra/exec-utils');

const DEVSHOP_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CRON_TAG_PREFIX = '# devshop:';

/**
 * Build a crontab entry for a window.
 */
function buildCronEntry(projectId, windowName, startHour, logDir) {
  const node = process.execPath;
  const indexJs = path.join(DEVSHOP_ROOT, 'platform', 'orchestrator', 'src', 'index.js');
  const stdoutLog = path.join(logDir, `${windowName}-stdout.log`);

  let command;
  if (windowName === 'weekly' || windowName === 'monthly') {
    command = `${node} ${indexJs} cadence run ${projectId} --type ${windowName}`;
  } else {
    command = `${node} ${indexJs} run ${projectId} --window ${windowName}`;
  }

  return `${CRON_TAG_PREFIX}${projectId}:${windowName}\n0 ${startHour} * * * ${command} >> ${stdoutLog} 2>&1`;
}

/**
 * Build a crontab entry for a cadence (weekly/monthly).
 */
function buildCadenceCronEntry(projectId, cadenceName, config, logDir) {
  const node = process.execPath;
  const indexJs = path.join(DEVSHOP_ROOT, 'platform', 'orchestrator', 'src', 'index.js');
  const stdoutLog = path.join(logDir, `${cadenceName}-stdout.log`);
  const command = `${node} ${indexJs} cadence run ${projectId} --type ${cadenceName}`;

  let schedule;
  if (cadenceName === 'weekly') {
    schedule = `0 ${config.hour} * * ${config.dayOfWeek}`;
  } else if (cadenceName === 'monthly') {
    schedule = `0 ${config.hour} ${config.dayOfMonth} * *`;
  } else {
    schedule = `0 ${config.hour} * * *`;
  }

  return `${CRON_TAG_PREFIX}${projectId}:${cadenceName}\n${schedule} ${command} >> ${stdoutLog} 2>&1`;
}

/**
 * Get the current crontab.
 */
async function getCurrentCrontab() {
  try {
    const { stdout } = await exec('crontab', ['-l']);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Set the crontab.
 */
async function setCrontab(content) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn('crontab', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`crontab failed: ${stderr}`));
    });
    proc.stdin.write(content);
    proc.stdin.end();
  });
}

/**
 * Install cron entries for all enabled windows of a project.
 */
async function installCron(projectId, schedule, logDir) {
  const current = await getCurrentCrontab();
  const cleaned = removeProjectEntries(current, projectId);
  const entries = [];

  const enabledWindows = getEnabledWindows(schedule);
  for (const win of enabledWindows) {
    entries.push(buildCronEntry(projectId, win.name, win.startHour, logDir));
  }

  if (schedule.cadence) {
    for (const [name, config] of Object.entries(schedule.cadence)) {
      if (!config.enabled) continue;
      entries.push(buildCadenceCronEntry(projectId, name, config, logDir));
    }
  }

  const newCrontab = cleaned.trim() + '\n\n' + entries.join('\n') + '\n';
  await setCrontab(newCrontab);

  return entries.map(e => {
    const lines = e.split('\n');
    return { tag: lines[0], schedule: lines[1] };
  });
}

/**
 * Remove cron entries for a project.
 */
async function removeCron(projectId) {
  const current = await getCurrentCrontab();
  const cleaned = removeProjectEntries(current, projectId);
  await setCrontab(cleaned);
}

/**
 * Remove all DevShop cron entries for a specific project.
 */
function removeProjectEntries(crontab, projectId) {
  const lines = crontab.split('\n');
  const result = [];
  let skip = false;

  for (const line of lines) {
    if (line.startsWith(`${CRON_TAG_PREFIX}${projectId}:`)) {
      skip = true;
      continue;
    }
    if (skip) {
      skip = false;
      continue;
    }
    result.push(line);
  }

  return result.join('\n');
}

const PAUSED_PREFIX = '# PAUSED:';

/**
 * Pause cron entries for a project by adding a comment prefix.
 */
async function pauseCron(projectId) {
  const current = await getCurrentCrontab();
  const lines = current.split('\n');
  const results = [];
  let pausedCount = 0;
  let foundAny = false;
  let nextTag = null;

  const output = [];
  for (const line of lines) {
    if (line.startsWith(`${CRON_TAG_PREFIX}${projectId}:`)) {
      foundAny = true;
      nextTag = line.replace(`${CRON_TAG_PREFIX}${projectId}:`, '');
      output.push(line);
      continue;
    }
    if (nextTag) {
      if (line.startsWith(PAUSED_PREFIX)) {
        results.push({ window: nextTag, status: 'already_paused' });
        output.push(line);
      } else {
        results.push({ window: nextTag, status: 'paused' });
        output.push(`${PAUSED_PREFIX}${line}`);
        pausedCount++;
      }
      nextTag = null;
      continue;
    }
    output.push(line);
  }

  if (!foundAny) {
    return { results: [], installed: false };
  }

  await setCrontab(output.join('\n'));
  return { results, installed: true, pausedCount };
}

/**
 * Resume paused cron entries for a project by removing the comment prefix.
 */
async function resumeCron(projectId) {
  const current = await getCurrentCrontab();
  const lines = current.split('\n');
  const results = [];
  let resumedCount = 0;
  let foundAny = false;
  let nextTag = null;

  const output = [];
  for (const line of lines) {
    if (line.startsWith(`${CRON_TAG_PREFIX}${projectId}:`)) {
      foundAny = true;
      nextTag = line.replace(`${CRON_TAG_PREFIX}${projectId}:`, '');
      output.push(line);
      continue;
    }
    if (nextTag) {
      if (line.startsWith(PAUSED_PREFIX)) {
        results.push({ window: nextTag, status: 'resumed' });
        output.push(line.slice(PAUSED_PREFIX.length));
        resumedCount++;
      } else {
        results.push({ window: nextTag, status: 'already_running' });
        output.push(line);
      }
      nextTag = null;
      continue;
    }
    output.push(line);
  }

  if (!foundAny) {
    return { results: [], installed: false };
  }

  await setCrontab(output.join('\n'));
  return { results, installed: true, resumedCount };
}

/**
 * Get cron entries for a project.
 */
async function getCronStatus(projectId) {
  const current = await getCurrentCrontab();
  const lines = current.split('\n');
  const entries = [];
  let nextTag = null;

  for (const line of lines) {
    if (line.startsWith(`${CRON_TAG_PREFIX}${projectId}:`)) {
      nextTag = line.replace(`${CRON_TAG_PREFIX}${projectId}:`, '');
      continue;
    }
    if (nextTag) {
      const paused = line.startsWith(PAUSED_PREFIX);
      const schedule = paused ? line.slice(PAUSED_PREFIX.length).trim() : line.trim();
      entries.push({ window: nextTag, schedule, paused });
      nextTag = null;
    }
  }

  return entries;
}

module.exports = { installCron, removeCron, pauseCron, resumeCron, getCronStatus, buildCronEntry, removeProjectEntries, PAUSED_PREFIX };
