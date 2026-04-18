const { resolveScheduleConfig, validateScheduleConfig, getEnabledWindows } = require('../scheduler/window-config');
const { getOrchestratorPaths } = require('../session/path-utils');
const { buildPlist, plistPath } = require('../scheduler/plist-template');
const { isMacOS, installPlists, removePlists, pausePlists, resumePlists, getStatus } = require('../scheduler/launchd');
const { installCron, removeCron, pauseCron, resumeCron, getCronStatus } = require('../scheduler/cron');

async function scheduleCommand(project, config, subcommand) {
  const schedule = await resolveScheduleConfig(project);

  // Validate
  const validation = validateScheduleConfig(schedule);
  if (!validation.valid) {
    console.error('Schedule configuration errors:');
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    return 1;
  }

  const { logsDir: logDir } = getOrchestratorPaths(config);

  switch (subcommand) {
    case 'install':
      return await handleInstall(project, schedule, logDir);

    case 'remove':
      return await handleRemove(project, schedule);

    case 'status':
      return await handleStatus(project, schedule);

    case 'pause':
      return await handlePause(project, schedule);

    case 'resume':
      return await handleResume(project, schedule);

    case 'dry-run':
      return await handleDryRun(project, schedule, logDir);

    default:
      console.error(`Unknown schedule subcommand: ${subcommand}`);
      console.error('Available: install, remove, pause, resume, status, dry-run');
      return 1;
  }
}

async function handleInstall(project, schedule, logDir) {
  console.log('');
  console.log(`Installing schedule for ${project.name} (${project.id})...`);
  console.log('');

  let results;
  if (isMacOS()) {
    results = await installPlists(project.id, schedule, logDir);
    console.log('Installed launchd plists:');
  } else {
    results = await installCron(project.id, schedule, logDir);
    console.log('Installed cron entries:');
  }

  for (const r of results) {
    const status = r.status || 'installed';
    const name = r.window || r.tag || 'unknown';
    console.log(`  ${status === 'loaded' || status === 'installed' ? '+' : '!'} ${name}: ${status}`);
    if (r.error) {
      console.log(`    Error: ${r.error}`);
    }
  }

  console.log('');
  return 0;
}

async function handleRemove(project, schedule) {
  console.log('');
  console.log(`Removing schedule for ${project.name} (${project.id})...`);
  console.log('');

  if (isMacOS()) {
    const results = await removePlists(project.id, schedule);
    for (const r of results) {
      console.log(`  - ${r.window}: ${r.status}`);
    }
  } else {
    await removeCron(project.id);
    console.log('  - Cron entries removed');
  }

  console.log('');
  return 0;
}

async function handlePause(project, schedule) {
  console.log('');
  console.log(`Pausing schedule for ${project.name} (${project.id})...`);
  console.log('');

  if (isMacOS()) {
    const results = await pausePlists(project.id, schedule);
    const installed = results.some(r => r.status !== 'not_installed');

    if (!installed) {
      console.log('  No schedule installed. Run `schedule install` first.');
      console.log('');
      return 1;
    }

    const pausedCount = results.filter(r => r.status === 'paused').length;
    const alreadyPaused = results.every(r => r.status === 'already_paused' || r.status === 'not_installed');

    if (alreadyPaused) {
      console.log('  Schedule is already paused.');
    } else {
      for (const r of results) {
        if (r.status === 'not_installed') continue;
        console.log(`  ${r.status === 'paused' ? '-' : '!'} ${r.window}: ${r.status}`);
      }
      console.log('');
      console.log(`  ${pausedCount} window(s) paused.`);
    }
  } else {
    const result = await pauseCron(project.id);

    if (!result.installed) {
      console.log('  No schedule installed. Run `schedule install` first.');
      console.log('');
      return 1;
    }

    if (result.pausedCount === 0) {
      console.log('  Schedule is already paused.');
    } else {
      for (const r of result.results) {
        console.log(`  ${r.status === 'paused' ? '-' : '!'} ${r.window}: ${r.status}`);
      }
      console.log('');
      console.log(`  ${result.pausedCount} window(s) paused.`);
    }
  }

  console.log('');
  return 0;
}

async function handleResume(project, schedule) {
  console.log('');
  console.log(`Resuming schedule for ${project.name} (${project.id})...`);
  console.log('');

  if (isMacOS()) {
    const results = await resumePlists(project.id, schedule);
    const installed = results.some(r => r.status !== 'not_installed');

    if (!installed) {
      console.log('  No schedule installed. Run `schedule install` first.');
      console.log('');
      return 1;
    }

    const resumedCount = results.filter(r => r.status === 'resumed').length;
    const alreadyRunning = results.every(r => r.status === 'already_loaded' || r.status === 'not_installed');

    if (alreadyRunning) {
      console.log('  Schedule is already running.');
    } else {
      for (const r of results) {
        if (r.status === 'not_installed') continue;
        console.log(`  ${r.status === 'resumed' ? '+' : '!'} ${r.window}: ${r.status}`);
      }
      console.log('');
      console.log(`  ${resumedCount} window(s) resumed.`);
    }
  } else {
    const result = await resumeCron(project.id);

    if (!result.installed) {
      console.log('  No schedule installed. Run `schedule install` first.');
      console.log('');
      return 1;
    }

    if (result.resumedCount === 0) {
      console.log('  Schedule is already running.');
    } else {
      for (const r of result.results) {
        console.log(`  ${r.status === 'resumed' ? '+' : '!'} ${r.window}: ${r.status}`);
      }
      console.log('');
      console.log(`  ${result.resumedCount} window(s) resumed.`);
    }
  }

  console.log('');
  return 0;
}

async function handleStatus(project, schedule) {
  console.log('');
  console.log(`Schedule status for ${project.name} (${project.id})`);
  console.log('');

  if (isMacOS()) {
    const statuses = await getStatus(project.id, schedule);

    console.log('  Window          Enabled  Installed  Loaded  Start');
    console.log('  ' + '-'.repeat(60));
    for (const s of statuses) {
      const name = s.name.padEnd(16);
      const enabled = s.enabled ? 'yes' : 'no ';
      const installed = s.installed ? 'yes' : 'no ';
      const loaded = s.loaded ? 'yes' : (s.paused ? 'paused' : 'no');
      const hour = String(s.startHour).padStart(2, '0') + ':00';
      console.log(`  ${name}${enabled.padEnd(9)}${installed.padEnd(11)}${loaded.padEnd(8)}${hour}`);
    }
  } else {
    const entries = await getCronStatus(project.id);
    if (entries.length === 0) {
      console.log('  No cron entries installed.');
    } else {
      for (const e of entries) {
        const status = e.paused ? ' (paused)' : '';
        console.log(`  ${e.window}: ${e.schedule}${status}`);
      }
    }
  }

  console.log('');
  return 0;
}

async function handleDryRun(project, schedule, logDir) {
  console.log('');
  console.log(`Dry run — schedule for ${project.name} (${project.id})`);
  console.log('');

  const enabledWindows = getEnabledWindows(schedule);

  if (isMacOS()) {
    console.log('Would generate launchd plists:');
    console.log('');

    for (const win of enabledWindows) {
      const filePath = plistPath(project.id, win.name);
      const xml = buildPlist({
        projectId: project.id,
        windowName: win.name,
        startHour: win.startHour,
        logDir
      });

      console.log(`--- ${filePath} ---`);
      console.log(xml);
    }

    // Cadence plists
    if (schedule.cadence) {
      for (const [name, cfg] of Object.entries(schedule.cadence)) {
        if (!cfg.enabled) continue;

        const filePath = plistPath(project.id, name);
        const xml = buildPlist({
          projectId: project.id,
          windowName: name,
          startHour: cfg.hour,
          logDir
        });

        console.log(`--- ${filePath} ---`);
        console.log(xml);
      }
    }
  } else {
    console.log('Would generate cron entries:');
    console.log('');

    const { buildCronEntry } = require('../scheduler/cron');
    for (const win of enabledWindows) {
      console.log(buildCronEntry(project.id, win.name, win.startHour, logDir));
      console.log('');
    }
  }

  return 0;
}

module.exports = { scheduleCommand };
