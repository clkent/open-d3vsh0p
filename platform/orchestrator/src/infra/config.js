const fs = require('fs/promises');
const path = require('path');

const DEFAULTS_PATH = path.join(__dirname, '..', '..', 'config', 'defaults.json');

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
  const overrides = cliOptions.activeAgentsDir
    ? await loadProjectOverrides(cliOptions.activeAgentsDir)
    : {};

  const config = deepMerge(defaults, overrides);

  // CLI options take highest priority
  if (cliOptions.budgetLimitUsd !== undefined) {
    config.budgetLimitUsd = cliOptions.budgetLimitUsd;
  }
  if (cliOptions.timeLimitMs !== undefined) {
    config.timeLimitMs = cliOptions.timeLimitMs;
  }

  return config;
}

// loadDefaults, deepMerge exported for testing
module.exports = { loadConfig, loadDefaults, deepMerge };
