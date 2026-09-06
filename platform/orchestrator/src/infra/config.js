const fs = require('fs/promises');
const path = require('path');

const DEFAULTS_PATH = path.join(__dirname, '..', '..', 'config', 'defaults.json');
// Machine-level overlay (gitignored): settings that belong to this Mac rather
// than to the repo or to one project, e.g. remoteControl.enabled.
const LOCAL_CONFIG_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'config.local.json');

async function loadDefaults() {
  const raw = await fs.readFile(DEFAULTS_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function loadProjectOverrides(activeAgentsDir) {
  const overridePath = path.join(activeAgentsDir, 'orchestrator', 'config.json');
  try {
    const raw = await fs.readFile(overridePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Load the optional machine-level overlay. Missing file → {}. Malformed JSON
 * is an error naming the path — a silently ignored overlay would make
 * "why isn't my setting applied?" undebuggable.
 */
async function loadLocalOverlay(overlayPath = LOCAL_CONFIG_PATH) {
  let raw;
  try {
    raw = await fs.readFile(overlayPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${overlayPath}: ${err.message}`);
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

async function loadConfig(cliOptions) {
  const defaults = await loadDefaults();
  const local = await loadLocalOverlay();
  const overrides = cliOptions.activeAgentsDir
    ? await loadProjectOverrides(cliOptions.activeAgentsDir)
    : {};

  // Priority: CLI options > project overrides > local overlay > defaults.
  // Legacy project override files may still carry budgetLimitUsd/timeLimitMs;
  // they merge harmlessly — nothing consumes them anymore.
  return deepMerge(deepMerge(defaults, local), overrides);
}

// loadDefaults, loadLocalOverlay, deepMerge exported for testing
module.exports = { loadConfig, loadDefaults, loadLocalOverlay, deepMerge, LOCAL_CONFIG_PATH };
