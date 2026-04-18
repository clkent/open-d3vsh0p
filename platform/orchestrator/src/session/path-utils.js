const path = require('path');

/**
 * Get standard orchestrator paths from config.
 * @param {{ activeAgentsDir: string }} config
 * @returns {{ logsDir: string, stateDir: string }}
 */
function getOrchestratorPaths(config) {
  const stateDir = path.join(config.activeAgentsDir, 'orchestrator');
  return {
    stateDir,
    logsDir: path.join(stateDir, 'logs'),
  };
}

module.exports = { getOrchestratorPaths };
