const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { SecurityRunner } = require('../runners/security-runner');
const { getOrchestratorPaths } = require('../session/path-utils');

const VALID_FOCUS_AREAS = ['secrets', 'deps', 'injection', 'auth', 'config'];

async function securityCommand(project, config) {
  const focus = config.focus || null;
  const schedule = config.schedule || null;
  const unschedule = config.unschedule || false;
  const budgetOverride = config.securityBudget || null;
  const timeoutOverride = config.securityTimeout || null;

  // Handle scheduling
  if (unschedule) {
    return await handleUnschedule(project);
  }
  if (schedule) {
    return await handleSchedule(project, schedule);
  }

  // Parse and validate focus areas
  let focusAreas = null;
  if (focus) {
    focusAreas = focus.split(',').map(s => s.trim()).filter(Boolean);
    const invalid = focusAreas.filter(a => !VALID_FOCUS_AREAS.includes(a));
    if (invalid.length > 0) {
      console.error(`Invalid focus areas: ${invalid.join(', ')}`);
      console.error(`Valid areas: ${VALID_FOCUS_AREAS.join(', ')}`);
      return 1;
    }
  }

  // Run security scan
  console.log('');
  console.log('=== Security Scan ===');
  console.log(`  Project: ${project.id}`);
  if (focusAreas) {
    console.log(`  Focus: ${focusAreas.join(', ')}`);
  }
  console.log('=====================');
  console.log('');

  const runnerConfig = {
    ...config,
    focusAreas,
    ...(budgetOverride && { maxBudgetUsd: budgetOverride }),
    ...(timeoutOverride && { timeoutMs: timeoutOverride * 60000 })
  };

  const runner = new SecurityRunner(runnerConfig);
  const result = await runner.run();

  if (!result.success) {
    console.error(`  Scan failed: ${result.error}`);
    return 1;
  }

  console.log(`  Scan complete ($${(result.cost || 0).toFixed(2)})`);

  // Write report
  const reportPath = await runner.writeReport(result.output);
  const counts = runner.parseSeverityCounts(result.output);
  runner.printSummary(counts, reportPath);

  console.log('');
  return 0;
}

async function handleSchedule(project, frequency) {
  if (frequency !== 'weekly') {
    console.error(`Unsupported schedule frequency: ${frequency}`);
    console.error('Supported: weekly');
    return 1;
  }

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = Math.floor(Math.random() * 5) + 1; // Mon-Fri (1-5)
  const hour = Math.floor(Math.random() * 9) + 9; // 9-17

  const label = `com.devshop.${project.id}.security`;

  if (process.platform === 'darwin') {
    const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plistFile = path.join(plistDir, `${label}.plist`);
    const indexJs = path.resolve(__dirname, '..', 'index.js');
    const node = process.execPath;
    const { logsDir } = getOrchestratorPaths({ projectId: project.id, activeAgentsDir: path.resolve(__dirname, '..', '..', '..', '..', 'active-agents', project.id) });

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${indexJs}</string>
    <string>security</string>
    <string>${project.id}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>${dayOfWeek}</integer>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(logsDir, 'security-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logsDir, 'security-stderr.log')}</string>
  <key>WorkingDirectory</key>
  <string>${project.projectDir}</string>
</dict>
</plist>
`;

    await fs.mkdir(plistDir, { recursive: true });
    await fs.writeFile(plistFile, plist);

    console.log(`Scheduled weekly security scan for ${project.name}`);
    console.log(`  Day: ${days[dayOfWeek]}`);
    console.log(`  Time: ${hour}:00`);
    console.log(`  Plist: ${plistFile}`);
    console.log('');
    console.log('Run `launchctl load <plist>` to activate, or `./devshop security <project> --unschedule` to remove.');
  } else {
    // Cron fallback
    const { execFile } = require('../infra/exec-utils');
    const indexJs = path.resolve(__dirname, '..', 'index.js');
    const cronLine = `0 ${hour} * * ${dayOfWeek} ${process.execPath} ${indexJs} security ${project.id}`;

    try {
      const { stdout } = await execFile('crontab', ['-l']);
      const existing = stdout.replace(new RegExp(`.*${indexJs} security ${project.id}.*\n?`, 'g'), '');
      const updated = existing.trimEnd() + '\n' + cronLine + '\n';
      const { execFile: execFileSync } = require('child_process');
      await new Promise((resolve, reject) => {
        const proc = execFileSync('crontab', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.stdin.write(updated);
        proc.stdin.end();
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`crontab exit ${code}`)));
      });
    } catch {
      // No existing crontab — create one
      const { execFile: execFileSync } = require('child_process');
      await new Promise((resolve, reject) => {
        const proc = execFileSync('crontab', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.stdin.write(cronLine + '\n');
        proc.stdin.end();
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`crontab exit ${code}`)));
      });
    }

    console.log(`Scheduled weekly security scan for ${project.name}`);
    console.log(`  Day: ${days[dayOfWeek]}`);
    console.log(`  Time: ${hour}:00`);
  }

  return 0;
}

async function handleUnschedule(project) {
  const label = `com.devshop.${project.id}.security`;

  if (process.platform === 'darwin') {
    const plistFile = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    try {
      await fs.unlink(plistFile);
      console.log(`Removed security scan schedule for ${project.name}`);
      console.log(`  Deleted: ${plistFile}`);
    } catch {
      console.log(`No security scan schedule found for ${project.name}`);
    }
  } else {
    const { execFile } = require('../infra/exec-utils');
    const indexJs = path.resolve(__dirname, '..', 'index.js');
    try {
      const { stdout } = await execFile('crontab', ['-l']);
      const updated = stdout.replace(new RegExp(`.*${indexJs} security ${project.id}.*\n?`, 'g'), '');
      const { execFile: execFileSync } = require('child_process');
      await new Promise((resolve, reject) => {
        const proc = execFileSync('crontab', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.stdin.write(updated);
        proc.stdin.end();
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`crontab exit ${code}`)));
      });
      console.log(`Removed security scan schedule for ${project.name}`);
    } catch {
      console.log(`No security scan schedule found for ${project.name}`);
    }
  }

  return 0;
}

module.exports = { securityCommand, VALID_FOCUS_AREAS };
