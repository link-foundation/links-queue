/**
 * Connection handling for Links Queue TCP server.
 *
 * This module provides the ServerConnection class for managing individual
 * client connections, including message framing, parsing, and lifecycle.
 *
 * @module server/connection
 */

import { EventEmitter } from 'node:events';
import { Message } from '../protocol/messages.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Connection states.
 * @readonly
 * @enum {string}
 */
export const ConnectionState = Object.freeze({
  /** Connection is being established */
  CONNECTING: 'connecting',
  /** Connection is active and ready */
  CONNECTED: 'connected',
  /** Connection is draining (graceful shutdown) */
  DRAINING: 'draining',
  /** Connection is closed */
  CLOSED: 'closed',
});

/**
 * Default connection options.
 */
const DEFAULT_OPTIONS = {
  idleTimeout: 60000, // 60 seconds
  maxMessageSize: 10 * 1024 * 1024, // 10MB
  heartbeatInterval: 30000, // 30 seconds
};

/**
 * Message delimiter for framing.
 * Uses newline as delimiter for Links Notation messages.
 */
const MESSAGE_DELIMITER = '\n';

// =============================================================================
// ServerConnection Class
// =============================================================================

/**
 * Represents a single client connection to the server.
 *
 * Handles message framing, parsing, and connection lifecycle.
 * Emits events for incoming messages and connection state changes.
 *
 * @extends EventEmitter
 *
 * @fires ServerConnection#message - When a complete message is received
 * @fires ServerConnection#error - When an error occurs
 * @fires ServerConnection#close - When the connection is closed
 * @fires ServerConnection#drain - When the write buffer is drained
 *
 * @example
 * const connection = new ServerConnection(socket, {
 *   idleTimeout: 60000,
 *   maxMessageSize: 1024 * 1024
 * });
 *
 * connection.on('message', async (message) => {
 *   const response = await handleMessage(message);
 *   connection.send(response);
 * });
 *
 * connection.on('close', () => {
 *   console.log('Client disconnected:', connection.id);
 * });
 */
export class ServerConnection extends EventEmitter {
  /**
   * Counter for generating unique connection IDs.
   * @type {number}
   * @private
   * @static
   */
  static #idCounter = 0;

  /**
   * Creates a new ServerConnection.
   *
   * @param {import('node:net').Socket} socket - The underlying TCP socket
   * @param {Object} [options] - Connection options
   * @param {number} [options.idleTimeout=60000] - Idle timeout in milliseconds
   * @param {number} [options.maxMessageSize=10485760] - Maximum message size in bytes
   * @param {number} [options.heartbeatInterval=30000] - Heartbeat interval in milliseconds
   */
  constructor(socket, options = {}) {
    super();

    /**
     * Unique connection identifier.
     * @type {string}
     */
    this.id = `conn-${++ServerConnection.#idCounter}-${Date.now().toString(36)}`;

    /**
     * The underlying TCP socket.
     * @type {import('node:net').Socket}
     * @private
     */
    this._socket = socket;

    /**
     * Connection options.
     * @type {Object}
     * @private
     */
    this._options = {
      idleTimeout: options.idleTimeout ?? DEFAULT_OPTIONS.idleTimeout,
      maxMessageSize: options.maxMessageSize ?? DEFAULT_OPTIONS.maxMessageSize,
      heartbeatInterval:
        options.heartbeatInterval ?? DEFAULT_OPTIONS.heartbeatInterval,
    };

    /**
     * Current connection state.
     * @type {string}
     */
    this.state = ConnectionState.CONNECTING;

    /**
     * Remote address of the client.
     * @type {string}
     */
    this.remoteAddress = socket.remoteAddress || 'unknown';

    /**
     * Remote port of the client.
     * @type {number}
     */
    this.remotePort = socket.remotePort || 0;

    /**
     * Timestamp when connection was established.
     * @type {number}
     */
    this.connectedAt = Date.now();

    /**
     * Timestamp of last activity.
     * @type {number}
     */
    this.lastActivity = Date.now();

    /**
     * Message buffer for incomplete messages.
     * @type {string}
     * @private
     */
    this._buffer = '';

    /**
     * Idle timeout timer.
     * @type {NodeJS.Timeout|null}
     * @private
     */
    this._idleTimer = null;

    /**
     * Heartbeat timer.
     * @type {NodeJS.Timeout|null}
     * @private
     */
    this._heartbeatTimer = null;

    /**
     * Number of messages received.
     * @type {number}
     */
    this.messagesReceived = 0;

    /**
     * Number of messages sent.
     * @type {number}
     */
    this.messagesSent = 0;

    /**
     * Number of bytes received.
     * @type {number}
     */
    this.bytesReceived = 0;

    /**
     * Number of bytes sent.
     * @type {number}
     */
    this.bytesSent = 0;

    /**
     * Subscriptions for this connection.
     * @type {Map<string, {queue: string, callback: Function}>}
     */
    this.subscriptions = new Map();

    this._setupSocket();
    this._startIdleTimer();
  }

  /**
   * Sets up socket event handlers.
   * @private
   */
  _setupSocket() {
    this._socket.setEncoding('utf8');
    this._socket.setKeepAlive(true, this._options.heartbeatInterval);

    this._socket.on('data', (data) => this._handleData(data));
    this._socket.on('error', (error) => this._handleError(error));
    this._socket.on('close', (hadError) => this._handleClose(hadError));
    this._socket.on('drain', () => this.emit('drain'));
    this._socket.on('timeout', () => this._handleTimeout());

    // Set socket timeout
    this._socket.setTimeout(this._options.idleTimeout);

    // Mark as connected
    this.state = ConnectionState.CONNECTED;
  }

  /**
   * Handles incoming data from the socket.
   *
   * @param {string} data - Received data chunk
   * @private
   */
  _handleData(data) {
    this.lastActivity = Date.now();
    this.bytesReceived += data.length;
    this._resetIdleTimer();

    this._buffer += data;

    // Check buffer size limit
    if (this._buffer.length > this._options.maxMessageSize) {
      this._handleError(new Error('Message size exceeded maximum'));
      this.close();
      return;
    }

    // Process complete messages
    this._processBuffer();
  }

  /**
   * Processes the message buffer for complete messages.
   * @private
   */
  _processBuffer() {
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
   * Processes a complete message string.
   *
   * @param {string} messageStr - The message string to process
   * @private
   */
  _processMessage(messageStr) {
    try {
      const message = Message.fromNotation(messageStr);
      this.messagesReceived++;
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
   * @param {Error} error - The error that occurred
   * @private
   */
  _handleError(error) {
    this.emit('error', error);
  }

  /**
   * Handles socket close.
   *
   * @param {boolean} hadError - Whether the close was due to an error
   * @private
   */
  _handleClose(hadError) {
    this._clearTimers();
    this.state = ConnectionState.CLOSED;

    // Clear subscriptions
    this.subscriptions.clear();

    this.emit('close', hadError);
  }

  /**
   * Handles socket timeout.
   * @private
   */
  _handleTimeout() {
    if (this.state === ConnectionState.CONNECTED) {
      this.emit('timeout');
      this.close();
    }
  }

  /**
   * Starts the idle timer.
   * @private
   */
  _startIdleTimer() {
    this._clearIdleTimer();

    if (this._options.idleTimeout > 0) {
      this._idleTimer = setTimeout(() => {
        if (this.state === ConnectionState.CONNECTED) {
          this.emit('idle');
          // Don't auto-close on idle, let the server decide
        }
      }, this._options.idleTimeout);
    }
  }

  /**
   * Resets the idle timer.
   * @private
   */
  _resetIdleTimer() {
    this._startIdleTimer();
  }

  /**
   * Clears the idle timer.
   * @private
   */
  _clearIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * Clears all timers.
   * @private
   */
  _clearTimers() {
    this._clearIdleTimer();
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Sends a message to the client.
   *
   * @param {Message} message - The message to send
   * @returns {boolean} True if the message was written, false if buffered
   */
  send(message) {
    if (this.state !== ConnectionState.CONNECTED) {
      return false;
    }

    const notation = message.toNotation();
    const data = notation + MESSAGE_DELIMITER;

    this.bytesSent += data.length;
    this.messagesSent++;
    this.lastActivity = Date.now();

    return this._socket.write(data);
  }

  /**
   * Sends a raw string to the client.
   *
   * @param {string} data - The data to send
   * @returns {boolean} True if the data was written, false if buffered
   */
  sendRaw(data) {
    if (this.state !== ConnectionState.CONNECTED) {
      return false;
    }

    const dataWithDelimiter = data.endsWith(MESSAGE_DELIMITER)
      ? data
      : data + MESSAGE_DELIMITER;

    this.bytesSent += dataWithDelimiter.length;
    this.messagesSent++;
    this.lastActivity = Date.now();

    return this._socket.write(dataWithDelimiter);
  }

  /**
   * Initiates graceful connection close with drain period.
   *
   * @param {number} [drainTimeout=5000] - Maximum time to wait for drain
   * @returns {Promise<void>}
   */
  async drain(drainTimeout = 5000) {
    if (this.state === ConnectionState.CLOSED) {
      return;
    }

    this.state = ConnectionState.DRAINING;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.close();
        resolve();
      }, drainTimeout);

      this._socket.once('drain', () => {
        clearTimeout(timer);
        this.close();
        resolve();
      });

      // End the writable side but allow reading
      this._socket.end();
    });
  }

  /**
   * Closes the connection immediately.
   */
  close() {
    if (this.state === ConnectionState.CLOSED) {
      return;
    }

    this._clearTimers();
    this.state = ConnectionState.CLOSED;

    // Clear subscriptions
    this.subscriptions.clear();

    this._socket.destroy();
  }

  /**
   * Adds a subscription for this connection.
   *
   * @param {string} subscriptionId - Unique subscription ID
   * @param {string} queue - Queue name to subscribe to
   * @param {Function} callback - Callback for received messages
   */
  addSubscription(subscriptionId, queue, callback) {
    this.subscriptions.set(subscriptionId, { queue, callback });
  }

  /**
   * Removes a subscription.
   *
   * @param {string} subscriptionId - Subscription ID to remove
   * @returns {boolean} True if subscription was removed
   */
  removeSubscription(subscriptionId) {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Returns connection statistics.
   *
   * @returns {Object} Connection statistics
   */
  getStats() {
    return {
      id: this.id,
      state: this.state,
      remoteAddress: this.remoteAddress,
      remotePort: this.remotePort,
      connectedAt: this.connectedAt,
      lastActivity: this.lastActivity,
      uptime: Date.now() - this.connectedAt,
      messagesReceived: this.messagesReceived,
      messagesSent: this.messagesSent,
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      subscriptions: this.subscriptions.size,
    };
  }
}
