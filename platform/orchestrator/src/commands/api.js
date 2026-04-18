const { ApiServer } = require('../api/api-server');
const { SessionProcessManager } = require('../api/session-process-manager');
const { buildRoutes } = require('../api/api-routes');

async function apiCommand(values) {
  const token = process.env.DEVSHOP_API_TOKEN;
  if (!token) {
    console.error('Error: DEVSHOP_API_TOKEN environment variable is required');
    console.error('Usage: DEVSHOP_API_TOKEN=your-secret ./devshop api');
    return 1;
  }

  const port = values.port ? parseInt(values.port, 10) : 3200;

  const processManager = new SessionProcessManager();
  const routes = buildRoutes(processManager);
  const server = new ApiServer({ token, routes, processManager });

  try {
    await server.start(port);
    console.log(`DevShop API server listening on http://127.0.0.1:${port}`);
    console.log('Press Ctrl+C to stop');
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: Port ${port} is already in use`);
      return 1;
    }
    throw err;
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    processManager.stopAll();
    await server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep the process alive
  return new Promise(() => {});
}

module.exports = { apiCommand };
