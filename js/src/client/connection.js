/**
 * Client connection handling for Links Queue.
 *
 * This module provides the ClientConnection class for managing
 * the TCP connection to a Links Queue server.
 *
 * @module client/connection
 */

import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { Message } from '../protocol/messages.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Client connection states.
 * @readonly
 * @enum {string}
 */
export const ClientConnectionState = Object.freeze({
  /** Not connected */
  DISCONNECTED: 'disconnected',
  /** Connection in progress */
  CONNECTING: 'connecting',
  /** Connected and ready */
  CONNECTED: 'connected',
  /** Reconnecting after disconnect */
  RECONNECTING: 'reconnecting',
  /** Connection closed */
  CLOSED: 'closed',
});

/**
 * Default connection options.
 */
const DEFAULT_OPTIONS = {
  connectTimeout: 10000, // 10 seconds
  socketTimeout: 60000, // 60 seconds
  reconnect: true,
  reconnectDelay: 1000, // 1 second
  maxReconnectDelay: 30000, // 30 seconds
  maxReconnectAttempts: 10,
};

/**
 * Message delimiter for framing.
 */
const MESSAGE_DELIMITER = '\n';

// =============================================================================
// ClientConnection Class
// =============================================================================

/**
 * Manages a TCP connection to a Links Queue server.
 *
 * Handles connection establishment, reconnection, message framing,
 * and request/response correlation.
 *
 * @extends EventEmitter
 *
 * @fires ClientConnection#connect - When connected to server
 * @fires ClientConnection#disconnect - When disconnected from server
 * @fires ClientConnection#message - When a message is received
 * @fires ClientConnection#error - When an error occurs
 *
 * @example
 * const connection = new ClientConnection({
 *   host: 'localhost',
 *   port: 5000,
 *   reconnect: true
 * });
 *
 * connection.on('connect', () => {
 *   console.log('Connected to server');
 * });
 *
 * await connection.connect();
 */
export class ClientConnection extends EventEmitter {
  /**
   * Creates a new ClientConnection.
   *
   * @param {Object} options - Connection options
   * @param {string} [options.host='localhost'] - Server host
   * @param {number} [options.port=5000] - Server port
   * @param {number} [options.connectTimeout=10000] - Connect timeout in ms
   * @param {number} [options.socketTimeout=60000] - Socket timeout in ms
   * @param {boolean} [options.reconnect=true] - Enable auto-reconnect
   * @param {number} [options.reconnectDelay=1000] - Initial reconnect delay in ms
   * @param {number} [options.maxReconnectDelay=30000] - Maximum reconnect delay in ms
   * @param {number} [options.maxReconnectAttempts=10] - Maximum reconnect attempts
   */
  constructor(options = {}) {
    super();

    /**
     * Connection options.
     * @type {Object}
     * @private
     */
    this._options = {
      host: options.host ?? 'localhost',
      port: options.port ?? 5000,
      connectTimeout: options.connectTimeout ?? DEFAULT_OPTIONS.connectTimeout,
      socketTimeout: options.socketTimeout ?? DEFAULT_OPTIONS.socketTimeout,
      reconnect: options.reconnect ?? DEFAULT_OPTIONS.reconnect,
      reconnectDelay: options.reconnectDelay ?? DEFAULT_OPTIONS.reconnectDelay,
      maxReconnectDelay:
        options.maxReconnectDelay ?? DEFAULT_OPTIONS.maxReconnectDelay,
      maxReconnectAttempts:
        options.maxReconnectAttempts ?? DEFAULT_OPTIONS.maxReconnectAttempts,
    };

    /**
     * Current connection state.
     * @type {string}
     */
    this.state = ClientConnectionState.DISCONNECTED;

    /**
     * The underlying TCP socket.
     * @type {Socket|null}
     * @private
     */
    this._socket = null;

    /**
     * Message buffer for incomplete messages.
     * @type {string}
     * @private
     */
    this._buffer = '';

    /**
     * Pending requests waiting for responses.
     * @type {Map<number, {resolve: Function, reject: Function, timeout: NodeJS.Timeout}>}
     * @private
     */
    this._pendingRequests = new Map();

    /**
     * Request ID counter.
     * @type {number}
     * @private
     */
    this._requestId = 0;

    /**
     * Current reconnect attempt count.
     * @type {number}
     * @private
     */
    this._reconnectAttempts = 0;

    /**
     * Current reconnect delay.
     * @type {number}
     * @private
     */
    this._currentReconnectDelay = this._options.reconnectDelay;

    /**
     * Reconnect timer.
     * @type {NodeJS.Timeout|null}
     * @private
     */
    this._reconnectTimer = null;

    /**
     * Whether manual disconnect was requested.
     * @type {boolean}
     * @private
     */
    this._manualDisconnect = false;

    /**
     * Timestamp when connected.
     * @type {number|null}
     */
    this.connectedAt = null;
  }

  /**
   * Gets the server address string.
   *
   * @returns {string} Server address (host:port)
   */
  get address() {
    return `${this._options.host}:${this._options.port}`;
  }

  /**
   * Checks if connected.
   *
   * @returns {boolean} True if connected
   */
  get isConnected() {
    return this.state === ClientConnectionState.CONNECTED;
  }

  /**
   * Connects to the server.
   *
   * @returns {Promise<void>} Resolves when connected
   * @throws {Error} If connection fails
   */
  async connect() {
    if (this.state === ClientConnectionState.CONNECTED) {
      return;
    }

    if (
      this.state === ClientConnectionState.CONNECTING ||
      this.state === ClientConnectionState.RECONNECTING
    ) {
      // Wait for the current connection attempt
      return new Promise((resolve, reject) => {
        const onConnect = () => {
          this.removeListener('error', onError);
          resolve();
        };
        const onError = (error) => {
          this.removeListener('connect', onConnect);
          reject(error);
        };
        this.once('connect', onConnect);
        this.once('error', onError);
      });
    }

    this._manualDisconnect = false;
    this.state = ClientConnectionState.CONNECTING;

    return this._doConnect();
  }

  /**
   * Performs the actual connection.
   *
   * @returns {Promise<void>}
   * @private
   */
  _doConnect() {
    return new Promise((resolve, reject) => {
      this._socket = new Socket();

      // Set up timeout for connection
      const connectTimeout = setTimeout(() => {
        this._socket.destroy();
        const error = new Error('Connection timeout');
        error.code = 'ETIMEDOUT';
        reject(error);
      }, this._options.connectTimeout);

      // Connection successful
      this._socket.once('connect', () => {
        clearTimeout(connectTimeout);
        this._onConnect();
        resolve();
      });

      // Connection error
      this._socket.once('error', (error) => {
        clearTimeout(connectTimeout);
        reject(error);
      });

      // Connect to server
      this._socket.connect({
        host: this._options.host,
        port: this._options.port,
      });
    });
  }

  /**
   * Handles successful connection.
   * @private
   */
  _onConnect() {
    this.state = ClientConnectionState.CONNECTED;
    this.connectedAt = Date.now();
    this._reconnectAttempts = 0;
    this._currentReconnectDelay = this._options.reconnectDelay;
    this._buffer = '';

    // Set up socket event handlers
    this._socket.setEncoding('utf8');
    this._socket.setKeepAlive(true, 30000);
    this._socket.setTimeout(this._options.socketTimeout);

    this._socket.on('data', (data) => this._onData(data));
    this._socket.on('error', (error) => this._onError(error));
    this._socket.on('close', () => this._onClose());
    this._socket.on('timeout', () => this._onTimeout());

    this.emit('connect');
  }

  /**
   * Handles incoming data.
   *
   * @param {string} data - Received data
   * @private
   */
  _onData(data) {
    this._buffer += data;

    let delimiterIndex;
    while ((delimiterIndex = this._buffer.indexOf(MESSAGE_DELIMITER)) !== -1) {
      const messageStr = this._buffer.slice(0, delimiterIndex);
      this._buffer = this._buffer.slice(delimiterIndex + 1);

      if (messageStr.trim()) {
        this._processMessage(messageStr);
      }
    }
  }

  /**
   * Processes a received message.
   *
   * @param {string} messageStr - Message string
   * @private
   */
  _processMessage(messageStr) {
    try {
      const message = Message.fromNotation(messageStr);
      this.emit('message', message);
    } catch (error) {
      this.emit(
        'error',
        new Error(`Failed to parse message: ${error.message}`)
      );
    }
  }

  /**
   * Handles socket errors.
   *
   * @param {Error} error - The error
   * @private
   */
  _onError(error) {
    this.emit('error', error);
  }

  /**
   * Handles socket close.
   * @private
   */
  _onClose() {
    const wasConnected = this.state === ClientConnectionState.CONNECTED;
    this.state = ClientConnectionState.DISCONNECTED;
    this._socket = null;
    this.connectedAt = null;

    // Reject all pending requests
    for (const [, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this._pendingRequests.clear();

    this.emit('disconnect');

    // Attempt reconnection if enabled and not manually disconnected
    if (
      wasConnected &&
      this._options.reconnect &&
      !this._manualDisconnect &&
      this._reconnectAttempts < this._options.maxReconnectAttempts
    ) {
      this._scheduleReconnect();
    }
  }

  /**
   * Handles socket timeout.
   * @private
   */
  _onTimeout() {
    this.emit('timeout');
    // Socket timeout is not fatal, just emit the event
  }

  /**
   * Schedules a reconnection attempt.
   * @private
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }

    this.state = ClientConnectionState.RECONNECTING;
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;

      try {
        await this._doConnect();
      } catch (error) {
        this.emit('error', error);

        // Exponential backoff
        this._currentReconnectDelay = Math.min(
          this._currentReconnectDelay * 2,
          this._options.maxReconnectDelay
        );

        // Try again if not at max attempts
        if (this._reconnectAttempts < this._options.maxReconnectAttempts) {
          this._scheduleReconnect();
        } else {
          this.state = ClientConnectionState.CLOSED;
          this.emit('close');
        }
      }
    }, this._currentReconnectDelay);
  }

  /**
   * Sends a message to the server.
   *
   * @param {Message} message - Message to send
   * @returns {boolean} True if written successfully
   * @throws {Error} If not connected
   */
  send(message) {
    if (!this.isConnected || !this._socket) {
      throw new Error('Not connected');
    }

    const notation = message.toNotation();
    const data = notation + MESSAGE_DELIMITER;

    return this._socket.write(data);
  }

  /**
   * Sends raw data to the server.
   *
   * @param {string} data - Data to send
   * @returns {boolean} True if written successfully
   * @throws {Error} If not connected
   */
  sendRaw(data) {
    if (!this.isConnected || !this._socket) {
      throw new Error('Not connected');
    }

    const dataWithDelimiter = data.endsWith(MESSAGE_DELIMITER)
      ? data
      : data + MESSAGE_DELIMITER;

    return this._socket.write(dataWithDelimiter);
  }

  /**
   * Sends a request and waits for a response.
   *
   * @param {Message} message - Request message
   * @param {number} [timeout=30000] - Response timeout in ms
   * @returns {Promise<Message>} Response message
   */
  async request(message, timeout = 30000) {
    if (!this.isConnected) {
      throw new Error('Not connected');
    }

    const requestId = ++this._requestId;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeout);

      // Store pending request
      this._pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // Send the message
      try {
        this.send(message);
      } catch (error) {
        this._pendingRequests.delete(requestId);
        clearTimeout(timeoutHandle);
        reject(error);
        return;
      }

      // Listen for response
      const onMessage = (response) => {
        const pending = this._pendingRequests.get(requestId);
        if (pending) {
          this._pendingRequests.delete(requestId);
          clearTimeout(pending.timeout);
          this.removeListener('message', onMessage);
          resolve(response);
        }
      };

      this.on('message', onMessage);
    });
  }

  /**
   * Disconnects from the server.
   *
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._manualDisconnect = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (!this._socket) {
      this.state = ClientConnectionState.CLOSED;
      return;
    }

    return new Promise((resolve) => {
      // Force close timer - cleared when graceful close succeeds
      const forceCloseTimer = setTimeout(() => {
        if (this._socket) {
          this._socket.destroy();
        }
      }, 5000);

      this._socket.once('close', () => {
        clearTimeout(forceCloseTimer);
        this.state = ClientConnectionState.CLOSED;
        resolve();
      });

      this._socket.end();
    });
  }

  /**
   * Returns connection statistics.
   *
   * @returns {Object} Connection statistics
   */
  getStats() {
    return {
      state: this.state,
      address: this.address,
      connectedAt: this.connectedAt,
      uptime: this.connectedAt ? Date.now() - this.connectedAt : 0,
      reconnectAttempts: this._reconnectAttempts,
      pendingRequests: this._pendingRequests.size,
    };
  }
}
