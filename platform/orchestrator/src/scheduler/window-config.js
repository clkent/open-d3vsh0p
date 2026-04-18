const fs = require('fs/promises');
const path = require('path');

const SCHEDULE_DEFAULTS_PATH = path.join(__dirname, '..', '..', 'config', 'schedule-defaults.json');
const VALID_WINDOWS = ['night', 'morning', 'day', 'techdebt'];

async function loadScheduleDefaults() {
  const raw = await fs.readFile(SCHEDULE_DEFAULTS_PATH, 'utf-8');
  return JSON.parse(raw).schedule;
}

/**
 * Resolve schedule config for a project.
 * Project-level config in registry takes priority over defaults.
 */
async function resolveScheduleConfig(project) {
  const defaults = await loadScheduleDefaults();

  if (!project.schedule) {
    return defaults;
  }

  // Deep merge project schedule over defaults
  const merged = { ...defaults };

  if (project.schedule.enabled !== undefined) {
    merged.enabled = project.schedule.enabled;
  }

  if (project.schedule.windows) {
    merged.windows = { ...defaults.windows };
    for (const [name, overrides] of Object.entries(project.schedule.windows)) {
      if (defaults.windows[name]) {
        merged.windows[name] = { ...defaults.windows[name], ...overrides };
      }
    }
  }

  if (project.schedule.cadence) {
    merged.cadence = { ...defaults.cadence };
    for (const [name, overrides] of Object.entries(project.schedule.cadence)) {
      if (defaults.cadence[name]) {
        merged.cadence[name] = { ...defaults.cadence[name], ...overrides };
      }
    }
  }

  if (project.schedule.notifications) {
    merged.notifications = { ...defaults.notifications, ...project.schedule.notifications };
  }

  return merged;
}

/**
 * Validate a schedule configuration.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
function validateScheduleConfig(schedule) {
  const errors = [];

  if (!schedule || !schedule.windows) {
    return { valid: false, errors: ['Missing schedule.windows'] };
  }

  const windowRanges = [];

  for (const [name, win] of Object.entries(schedule.windows)) {
    if (!VALID_WINDOWS.includes(name)) {
      errors.push(`Unknown window: ${name}`);
      continue;
    }

    if (!win.enabled) continue;

    if (win.startHour === undefined || win.endHour === undefined) {
      errors.push(`${name}: missing startHour or endHour`);
      continue;
    }

    if (win.startHour < 0 || win.startHour > 23) {
      errors.push(`${name}: startHour ${win.startHour} out of range 0-23`);
    }

    if (win.endHour < 0 || win.endHour > 23) {
      errors.push(`${name}: endHour ${win.endHour} out of range 0-23`);
    }

    if (win.startHour >= win.endHour) {
      errors.push(`${name}: startHour (${win.startHour}) must be less than endHour (${win.endHour})`);
    }

    if (win.budgetUsd !== undefined && win.budgetUsd <= 0) {
      errors.push(`${name}: budgetUsd must be positive`);
    }

    if (win.timeLimitHours !== undefined && win.timeLimitHours <= 0) {
      errors.push(`${name}: timeLimitHours must be positive`);
    }

    windowRanges.push({ name, start: win.startHour, end: win.endHour });
  }

  // Check for overlaps
  for (let i = 0; i < windowRanges.length; i++) {
    for (let j = i + 1; j < windowRanges.length; j++) {
      const a = windowRanges[i];
      const b = windowRanges[j];
      if (a.start < b.end && b.start < a.end) {
        errors.push(`Overlapping windows: ${a.name} (${a.start}-${a.end}) and ${b.name} (${b.start}-${b.end})`);
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Get the window config for a named window.
 */
function getWindowConfig(schedule, windowName) {
  if (!VALID_WINDOWS.includes(windowName)) {
    return null;
  }
  return schedule.windows[windowName] || null;
}

/**
 * Compute the absolute end time (ms since epoch) for a window today.
 * If the window end hour has already passed today, returns the end time for tomorrow.
 */
function computeWindowEndTimeMs(endHour) {
  const now = new Date();
  const endTime = new Date(now);
  endTime.setHours(endHour, 0, 0, 0);

  // If end time is in the past, it means the window wraps to tomorrow
  if (endTime.getTime() <= now.getTime()) {
    endTime.setDate(endTime.getDate() + 1);
  }

  return endTime.getTime();
}

/**
 * Compute the remaining hours from now until window end.
 */
function computeRemainingHours(endHour) {
  const endMs = computeWindowEndTimeMs(endHour);
  const remainingMs = endMs - Date.now();
  return remainingMs / 3600000;
}

/**
 * Get all enabled windows for a schedule.
 */
function getEnabledWindows(schedule) {
  return Object.entries(schedule.windows)
    .filter(([, win]) => win.enabled)
    .map(([name, win]) => ({ name, ...win }));
}

module.exports = {
  loadScheduleDefaults,
  resolveScheduleConfig,
  validateScheduleConfig,
  getWindowConfig,
  computeWindowEndTimeMs,
  computeRemainingHours,
  getEnabledWindows,
  VALID_WINDOWS
};
