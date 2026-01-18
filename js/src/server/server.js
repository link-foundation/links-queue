/**
 * TCP Server implementation for Links Queue.
 *
 * This module provides the LinksQueueServer class for running Links Queue
 * as a standalone TCP server that clients can connect to.
 *
 * @module server/server
 *
 * @see ARCHITECTURE.md - Server Deployment pattern
 * @see REQUIREMENTS.md - REQ-PROTO-020 (TCP transport)
 */

import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { ServerConnection, ConnectionState } from './connection.js';
import { RequestRouter } from './router.js';
import { MemoryQueueManager, LinksQueueManager } from '../queue/manager.js';
import { MemoryLinkStore } from '../backends/memory.js';
import { createOkResponse } from '../protocol/messages.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Server states.
 * @readonly
 * @enum {string}
 */
export const ServerState = Object.freeze({
  /** Server is stopped */
  STOPPED: 'stopped',
  /** Server is starting */
  STARTING: 'starting',
  /** Server is running and accepting connections */
  RUNNING: 'running',
  /** Server is shutting down (draining connections) */
  DRAINING: 'draining',
});

/**
 * Default server options.
 */
const DEFAULT_OPTIONS = {
  host: '0.0.0.0',
  port: 5000,
  maxConnections: 1000,
  idleTimeout: 60000, // 60 seconds
  backlog: 511, // Default TCP backlog
};

// =============================================================================
// LinksQueueServer Class
// =============================================================================

/**
 * TCP server for Links Queue.
 *
 * Provides a standalone server that accepts client connections and
 * handles queue operations over the Links Notation protocol.
 *
 * @extends EventEmitter
 *
 * @fires LinksQueueServer#connection - When a new client connects
 * @fires LinksQueueServer#disconnection - When a client disconnects
 * @fires LinksQueueServer#error - When an error occurs
 * @fires LinksQueueServer#listening - When server starts listening
 * @fires LinksQueueServer#close - When server closes
 *
 * @example
 * import { LinksQueueServer } from 'links-queue/server';
 *
 * const server = new LinksQueueServer({
 *   host: '0.0.0.0',
 *   port: 5000,
 *   backend: { type: 'memory' },
 *   maxConnections: 1000,
 *   idleTimeout: 60000
 * });
 *
 * server.on('connection', (client) => {
 *   console.log('Client connected:', client.id);
 * });
 *
 * server.on('error', (error) => {
 *   console.error('Server error:', error);
 * });
 *
 * await server.start();
 * console.log('Server listening on port 5000');
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await server.shutdown({ drainTimeout: 30000 });
 * });
 */
export class LinksQueueServer extends EventEmitter {
  /**
   * Creates a new LinksQueueServer.
   *
   * @param {Object} config - Server configuration
   * @param {string} [config.host='0.0.0.0'] - Host to bind to
   * @param {number} [config.port=5000] - Port to listen on
   * @param {Object} [config.backend] - Backend configuration
   * @param {string} [config.backend.type='memory'] - Backend type ('memory' or 'link-cli')
   * @param {string} [config.backend.path] - Path for link-cli backend
   * @param {number} [config.maxConnections=1000] - Maximum concurrent connections
   * @param {number} [config.idleTimeout=60000] - Connection idle timeout in ms
   * @param {number} [config.backlog=511] - TCP backlog size
   * @param {import('../queue/manager.js').MemoryQueueManager|import('../queue/manager.js').LinksQueueManager} [config.queueManager] - Custom queue manager
   */
  constructor(config = {}) {
    super();

    /**
     * Server configuration.
     * @type {Object}
     * @private
     */
    this._config = {
      host: config.host ?? DEFAULT_OPTIONS.host,
      port: config.port ?? DEFAULT_OPTIONS.port,
      maxConnections: config.maxConnections ?? DEFAULT_OPTIONS.maxConnections,
      idleTimeout: config.idleTimeout ?? DEFAULT_OPTIONS.idleTimeout,
      backlog: config.backlog ?? DEFAULT_OPTIONS.backlog,
      backend: config.backend ?? { type: 'memory' },
    };

    /**
     * Current server state.
     * @type {string}
     */
    this.state = ServerState.STOPPED;

    /**
     * The underlying TCP server.
     * @type {import('node:net').Server|null}
     * @private
     */
    this._server = null;

    /**
     * Active client connections.
     * @type {Map<string, ServerConnection>}
     * @private
     */
    this._connections = new Map();

    /**
     * Queue manager for handling operations.
     * @type {import('../queue/manager.js').MemoryQueueManager|import('../queue/manager.js').LinksQueueManager|null}
     * @private
     */
    this._queueManager = config.queueManager || null;

    /**
     * Request router.
     * @type {RequestRouter|null}
     * @private
     */
    this._router = null;

    /**
     * Timestamp when server started.
     * @type {number|null}
     */
    this.startedAt = null;

    /**
     * Total connections received since start.
     * @type {number}
     */
    this.totalConnections = 0;
  }

  /**
   * Gets the server address.
   *
   * @returns {{host: string, port: number}|null} Server address or null if not listening
   */
  get address() {
    if (!this._server) {
      return null;
    }
    const addr = this._server.address();
    if (addr && typeof addr === 'object') {
      return { host: addr.address, port: addr.port };
    }
    return null;
  }

  /**
   * Gets the number of active connections.
   *
   * @returns {number} Number of active connections
   */
  get connectionCount() {
    return this._connections.size;
  }

  /**
   * Gets the queue manager.
   *
   * @returns {import('../queue/manager.js').MemoryQueueManager|import('../queue/manager.js').LinksQueueManager|null}
   */
  get queueManager() {
    return this._queueManager;
  }

  /**
   * Starts the server.
   *
   * @returns {Promise<void>} Resolves when server is listening
   * @throws {Error} If server fails to start
   */
  async start() {
    if (this.state !== ServerState.STOPPED) {
      throw new Error(`Cannot start server in state: ${this.state}`);
    }

    this.state = ServerState.STARTING;

    try {
      // Initialize queue manager if not provided
      if (!this._queueManager) {
        this._queueManager = this._createQueueManager();
      }

      // Initialize router
      this._router = new RequestRouter(this._queueManager);

      // Create TCP server
      this._server = createServer((socket) => this._handleConnection(socket));

      // Handle server errors
      this._server.on('error', (error) => this._handleServerError(error));

      // Start listening
      await this._listen();

      this.state = ServerState.RUNNING;
      this.startedAt = Date.now();

      this.emit('listening', this.address);
    } catch (error) {
      this.state = ServerState.STOPPED;
      throw error;
    }
  }

  /**
   * Starts listening on the configured host and port.
   *
   * @returns {Promise<void>}
   * @private
   */
  _listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        this._server.removeListener('listening', onListening);
        reject(error);
      };

      const onListening = () => {
        this._server.removeListener('error', onError);
        resolve();
      };

      this._server.once('error', onError);
      this._server.once('listening', onListening);

      this._server.listen({
        host: this._config.host,
        port: this._config.port,
        backlog: this._config.backlog,
      });
    });
  }

  /**
   * Creates a queue manager based on configuration.
   *
   * @returns {import('../queue/manager.js').MemoryQueueManager|import('../queue/manager.js').LinksQueueManager}
   * @private
   */
  _createQueueManager() {
    const backendType = this._config.backend?.type || 'memory';

    if (backendType === 'memory') {
      return new MemoryQueueManager();
    }

    if (backendType === 'link-cli') {
      // For link-cli backend, use LinksQueueManager with MemoryLinkStore
      // (Full link-cli support would require additional implementation)
      const store = new MemoryLinkStore();
      return new LinksQueueManager({ store });
    }

    // Default to memory
    return new MemoryQueueManager();
  }

  /**
   * Handles a new client connection.
   *
   * @param {import('node:net').Socket} socket - The client socket
   * @private
   */
  _handleConnection(socket) {
    // Check connection limit
    if (this._connections.size >= this._config.maxConnections) {
      socket.end('Server at maximum capacity\n');
      socket.destroy();
      return;
    }

    // Don't accept connections during shutdown
    if (this.state !== ServerState.RUNNING) {
      socket.end('Server is shutting down\n');
      socket.destroy();
      return;
    }

    // Create connection wrapper
    const connection = new ServerConnection(socket, {
      idleTimeout: this._config.idleTimeout,
    });

    // Store connection
    this._connections.set(connection.id, connection);
    this.totalConnections++;

    // Set up connection event handlers
    connection.on('message', (message) =>
      this._handleMessage(connection, message)
    );
    connection.on('error', (error) =>
      this._handleConnectionError(connection, error)
    );
    connection.on('close', () => this._handleConnectionClose(connection));

    this.emit('connection', connection);
  }

  /**
   * Handles a message from a client.
   *
   * @param {ServerConnection} connection - The client connection
   * @param {import('../protocol/messages.js').Message} message - The received message
   * @private
   */
  async _handleMessage(connection, message) {
    try {
      const response = await this._router.route(message, connection);
      connection.send(response);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handles a connection error.
   *
   * @param {ServerConnection} connection - The client connection
   * @param {Error} error - The error that occurred
   * @private
   */
  _handleConnectionError(connection, error) {
    this.emit('error', error);
  }

  /**
   * Handles connection close.
   *
   * @param {ServerConnection} connection - The closed connection
   * @private
   */
  _handleConnectionClose(connection) {
    this._connections.delete(connection.id);
    this.emit('disconnection', connection);
  }

  /**
   * Handles server-level errors.
   *
   * @param {Error} error - The error that occurred
   * @private
   */
  _handleServerError(error) {
    this.emit('error', error);
  }

  /**
   * Gracefully shuts down the server.
   *
   * Stops accepting new connections, drains existing connections,
   * and closes the server.
   *
   * @param {Object} [options] - Shutdown options
   * @param {number} [options.drainTimeout=30000] - Maximum time to wait for connections to drain
   * @returns {Promise<void>}
   */
  async shutdown(options = {}) {
    const drainTimeout = options.drainTimeout ?? 30000;

    if (this.state === ServerState.STOPPED) {
      return;
    }

    this.state = ServerState.DRAINING;

    // Stop accepting new connections
    if (this._server) {
      this._server.close();
    }

    // Drain existing connections
    const drainPromises = [];
    for (const connection of this._connections.values()) {
      drainPromises.push(connection.drain(drainTimeout));
    }

    // Wait for all connections to drain (with timeout)
    await Promise.race([
      Promise.all(drainPromises),
      new Promise((resolve) => setTimeout(resolve, drainTimeout)),
    ]);

    // Force close any remaining connections
    for (const connection of this._connections.values()) {
      if (connection.state !== ConnectionState.CLOSED) {
        connection.close();
      }
    }

    this._connections.clear();
    this.state = ServerState.STOPPED;
    this.emit('close');
  }

  /**
   * Forcefully stops the server.
   *
   * Immediately closes all connections and the server.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.state === ServerState.STOPPED) {
      return;
    }

    // Close all connections immediately
    for (const connection of this._connections.values()) {
      connection.close();
    }
    this._connections.clear();

    // Close server
    if (this._server) {
      return new Promise((resolve) => {
        // Set up close callback
        const onClose = () => {
          this.state = ServerState.STOPPED;
          this.emit('close');
          resolve();
        };

        this._server.close(onClose);

        // Deno workaround: server.close() callback may not fire
        // Use unref to allow event loop to exit, then resolve after short delay
        this._server.unref();
        setTimeout(() => {
          if (this.state !== ServerState.STOPPED) {
            onClose();
          }
        }, 100);
      });
    }

    this.state = ServerState.STOPPED;
  }

  /**
   * Returns server statistics.
   *
   * @returns {Object} Server statistics
   */
  getStats() {
    const routerStats = this._router ? this._router.getStats() : null;

    return {
      state: this.state,
      address: this.address,
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      connections: {
        current: this._connections.size,
        max: this._config.maxConnections,
        total: this.totalConnections,
      },
      router: routerStats,
      queues: this._queueManager ? this._queueManager.getQueueCount() : 0,
    };
  }

  /**
   * Gets a specific connection by ID.
   *
   * @param {string} connectionId - Connection ID
   * @returns {ServerConnection|null} The connection or null
   */
  getConnection(connectionId) {
    return this._connections.get(connectionId) || null;
  }

  /**
   * Gets all active connections.
   *
   * @returns {ServerConnection[]} Array of active connections
   */
  getConnections() {
    return Array.from(this._connections.values());
  }

  /**
   * Broadcasts a message to all connected clients.
   *
   * @param {import('../protocol/messages.js').Message} message - Message to broadcast
   * @returns {number} Number of clients the message was sent to
   */
  broadcast(message) {
    let count = 0;
    for (const connection of this._connections.values()) {
      if (connection.state === ConnectionState.CONNECTED) {
        connection.send(message);
        count++;
      }
    }
    return count;
  }

  /**
   * Creates a health check response message.
   *
   * @returns {import('../protocol/messages.js').Message} Health check response
   */
  healthCheck() {
    const stats = this.getStats();
    return createOkResponse({
      healthy: this.state === ServerState.RUNNING,
      state: this.state,
      uptime: stats.uptime,
      connections: stats.connections.current,
      queues: stats.queues,
    });
  }
}
