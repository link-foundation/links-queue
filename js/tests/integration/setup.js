/**
 * Integration test setup.
 *
 * This file is loaded before integration tests run.
 * It sets up global configurations and cleanup handlers.
 */

// Track resources that need cleanup
const resources = {
  servers: [],
  connections: [],
};

/**
 * Register a server for cleanup.
 * @param {object} server - Server instance with shutdown() method
 */
export const registerServer = (server) => {
  resources.servers.push(server);
};

/**
 * Register a connection for cleanup.
 * @param {object} connection - Connection instance with close() method
 */
export const registerConnection = (connection) => {
  resources.connections.push(connection);
};

/**
 * Cleanup all registered resources.
 */
export const cleanupAll = async () => {
  // Close connections first
  for (const connection of resources.connections) {
    try {
      if (typeof connection.close === 'function') {
        await connection.close();
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  resources.connections = [];

  // Then shutdown servers
  for (const server of resources.servers) {
    try {
      if (typeof server.shutdown === 'function') {
        await server.shutdown();
      } else if (typeof server.stop === 'function') {
        await server.stop();
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  resources.servers = [];
};

// Set up global error handling for unhandled rejections in tests
if (typeof process !== 'undefined' && process.on) {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection in integration tests:', reason);
  });

  // Cleanup on exit
  process.on('beforeExit', async () => {
    await cleanupAll();
  });
}

// Export for use in tests
export default {
  registerServer,
  registerConnection,
  cleanupAll,
};
