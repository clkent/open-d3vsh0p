const fs = require('fs/promises');
const path = require('path');
const { buildPlist, plistLabel, plistPath } = require('./plist-template');
const { getEnabledWindows } = require('./window-config');
const { execFile: exec } = require('../infra/exec-utils');

/**
 * Install launchd plists for all enabled windows of a project.
 */
async function installPlists(projectId, schedule, logDir) {
  const enabledWindows = getEnabledWindows(schedule);
  const installed = [];

  await fs.mkdir(logDir, { recursive: true });

  for (const win of enabledWindows) {
    const xml = buildPlist({
      projectId,
      windowName: win.name,
      startHour: win.startHour,
      logDir
    });

    const filePath = plistPath(projectId, win.name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, xml);

    // Load the plist
    try {
      await exec('launchctl', ['load', filePath]);
      installed.push({ window: win.name, path: filePath, status: 'loaded' });
    } catch (err) {
      installed.push({ window: win.name, path: filePath, status: 'load_failed', error: err.message });
    }
  }

  // Also install cadence plists if enabled
  if (schedule.cadence) {
    for (const [cadenceName, cadenceConfig] of Object.entries(schedule.cadence)) {
      if (!cadenceConfig.enabled) continue;

      const xml = buildPlist({
        projectId,
        windowName: cadenceName,
        startHour: cadenceConfig.hour,
        logDir
      });

      const filePath = plistPath(projectId, cadenceName);
      await fs.writeFile(filePath, xml);

      try {
        await exec('launchctl', ['load', filePath]);
        installed.push({ window: cadenceName, path: filePath, status: 'loaded' });
      } catch (err) {
        installed.push({ window: cadenceName, path: filePath, status: 'load_failed', error: err.message });
      }
    }
  }

  return installed;
}

/**
 * Remove launchd plists for all windows of a project.
 */
async function removePlists(projectId, schedule) {
  const removed = [];
  const allNames = [...Object.keys(schedule.windows)];

  if (schedule.cadence) {
    allNames.push(...Object.keys(schedule.cadence));
  }

  for (const name of allNames) {
    const filePath = plistPath(projectId, name);

    try {
      await fs.access(filePath);
    } catch {
      // Plist doesn't exist, skip
      continue;
    }

    // Unload first
    try {
      await exec('launchctl', ['unload', filePath]);
    } catch {
      // May already be unloaded
    }

    // Delete the file
    try {
      await fs.unlink(filePath);
      removed.push({ window: name, path: filePath, status: 'removed' });
    } catch (err) {
      removed.push({ window: name, path: filePath, status: 'remove_failed', error: err.message });
    }
  }

  return removed;
}

/**
 * Pause (unload) all installed plists for a project without deleting them.
 */
async function pausePlists(projectId, schedule) {
  const results = [];
  const allNames = [...Object.keys(schedule.windows)];
  if (schedule.cadence) {
    allNames.push(...Object.keys(schedule.cadence));
  }

  for (const name of allNames) {
    const filePath = plistPath(projectId, name);

    try {
      await fs.access(filePath);
    } catch {
      results.push({ window: name, status: 'not_installed' });
      continue;
    }

    // Check if already unloaded
    const label = plistLabel(projectId, name);
    let isLoaded = false;
    try {
      const { stdout } = await exec('launchctl', ['list']);
      isLoaded = stdout.includes(label);
    } catch {
      // Can't determine — try unloading anyway
      isLoaded = true;
    }

    if (!isLoaded) {
      results.push({ window: name, status: 'already_paused' });
      continue;
    }

    try {
      await exec('launchctl', ['unload', filePath]);
      results.push({ window: name, status: 'paused' });
    } catch (err) {
      results.push({ window: name, status: 'pause_failed', error: err.message });
    }
  }

  return results;
}

/**
 * Resume (reload) all installed but unloaded plists for a project.
 */
async function resumePlists(projectId, schedule) {
  const results = [];
  const allNames = [...Object.keys(schedule.windows)];
  if (schedule.cadence) {
    allNames.push(...Object.keys(schedule.cadence));
  }

  for (const name of allNames) {
    const filePath = plistPath(projectId, name);

    try {
      await fs.access(filePath);
    } catch {
      results.push({ window: name, status: 'not_installed' });
      continue;
    }

    // Check if already loaded
    const label = plistLabel(projectId, name);
    let isLoaded = false;
    try {
      const { stdout } = await exec('launchctl', ['list']);
      isLoaded = stdout.includes(label);
    } catch {
      // Can't determine — try loading anyway
    }

    if (isLoaded) {
      results.push({ window: name, status: 'already_loaded' });
      continue;
    }

    try {
      await exec('launchctl', ['load', filePath]);
      results.push({ window: name, status: 'resumed' });
    } catch (err) {
      results.push({ window: name, status: 'resume_failed', error: err.message });
    }
  }

  return results;
}

/**
 * Get status of installed plists for a project.
 */
async function getStatus(projectId, schedule) {
  const statuses = [];
  const allEntries = [
    ...Object.entries(schedule.windows).map(([name, win]) => ({
      name,
      enabled: win.enabled,
      startHour: win.startHour,
      type: 'window'
    })),
    ...Object.entries(schedule.cadence || {}).map(([name, cfg]) => ({
      name,
      enabled: cfg.enabled,
      startHour: cfg.hour,
      type: 'cadence'
    }))
  ];

  for (const entry of allEntries) {
    const filePath = plistPath(projectId, entry.name);
    let installed = false;
    let loaded = false;

    try {
      await fs.access(filePath);
      installed = true;
    } catch {
      // Not installed
    }

    if (installed) {
      try {
        const label = plistLabel(projectId, entry.name);
        const { stdout } = await exec('launchctl', ['list']);
        loaded = stdout.includes(label);
      } catch {
        // Can't determine load status
      }
    }

    statuses.push({
      name: entry.name,
      type: entry.type,
      enabled: entry.enabled,
      installed,
      loaded,
      paused: installed && !loaded,
      startHour: entry.startHour,
      plistPath: filePath
    });
  }

  return statuses;
}

/**
 * Check if running on macOS.
 */
function isMacOS() {
  return process.platform === 'darwin';
}

module.exports = { installPlists, removePlists, pausePlists, resumePlists, getStatus, isMacOS };
