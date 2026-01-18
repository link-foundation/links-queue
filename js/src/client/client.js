/**
 * Links Queue Client library.
 *
 * This module provides the LinksQueueClient class for connecting to
 * a Links Queue server and performing queue operations.
 *
 * @module client/client
 *
 * @see ARCHITECTURE.md - Server Deployment pattern
 */

import { EventEmitter } from 'node:events';
import { ClientConnection } from './connection.js';
import {
  ResponseStatus,
  ErrorCode,
  createEnqueueRequest,
  createDequeueRequest,
  createPeekRequest,
  createAckRequest,
  createRejectRequest,
  createGetStatsRequest,
  createListQueuesRequest,
  createCreateQueueRequest,
  createDeleteQueueRequest,
} from '../protocol/messages.js';

// =============================================================================
// LinksQueueClient Class
// =============================================================================

/**
 * Client for connecting to a Links Queue server.
 *
 * Provides high-level methods for queue operations over the network.
 *
 * @extends EventEmitter
 *
 * @fires LinksQueueClient#connect - When connected to server
 * @fires LinksQueueClient#disconnect - When disconnected from server
 * @fires LinksQueueClient#error - When an error occurs
 * @fires LinksQueueClient#message - When a push message is received
 *
 * @example
 * import { LinksQueueClient } from 'links-queue/client';
 *
 * const client = new LinksQueueClient('tcp://localhost:5000');
 * await client.connect();
 *
 * // Queue operations over network
 * await client.enqueue('tasks', { source: 'job', target: 'run' });
 * const link = await client.dequeue('tasks');
 *
 * // Subscribe to queue
 * const subscription = client.subscribe('tasks', async (link) => {
 *   console.log('Received:', link);
 *   await client.acknowledge('tasks', link.id);
 * });
 *
 * await client.disconnect();
 */
export class LinksQueueClient extends EventEmitter {
  /**
   * Creates a new LinksQueueClient.
   *
   * @param {string|Object} urlOrOptions - Server URL (tcp://host:port) or options object
   * @param {Object} [options] - Additional options if first param is URL
   * @param {number} [options.connectTimeout=10000] - Connect timeout in ms
   * @param {number} [options.requestTimeout=30000] - Default request timeout in ms
   * @param {boolean} [options.reconnect=true] - Enable auto-reconnect
   * @param {number} [options.reconnectDelay=1000] - Initial reconnect delay in ms
   * @param {number} [options.maxReconnectDelay=30000] - Maximum reconnect delay in ms
   * @param {number} [options.maxReconnectAttempts=10] - Maximum reconnect attempts
   */
  constructor(urlOrOptions, options = {}) {
    super();

    // Parse URL if string
    let connectionOptions;
    if (typeof urlOrOptions === 'string') {
      connectionOptions = this._parseUrl(urlOrOptions);
    } else {
      connectionOptions = { ...urlOrOptions };
    }

    // Merge with additional options
    connectionOptions = { ...connectionOptions, ...options };

    /**
     * Client options.
     * @type {Object}
     * @private
     */
    this._options = {
      requestTimeout: connectionOptions.requestTimeout ?? 30000,
      ...connectionOptions,
    };

    /**
     * The underlying connection.
     * @type {ClientConnection}
     * @private
     */
    this._connection = new ClientConnection(connectionOptions);

    /**
     * Active subscriptions.
     * @type {Map<string, {queue: string, callback: Function, active: boolean}>}
     * @private
     */
    this._subscriptions = new Map();

    /**
     * Subscription ID counter.
     * @type {number}
     * @private
     */
    this._subscriptionId = 0;

    // Forward connection events
    this._connection.on('connect', () => this.emit('connect'));
    this._connection.on('disconnect', () => this.emit('disconnect'));
    this._connection.on('error', (error) => this.emit('error', error));
    this._connection.on('message', (message) =>
      this._handlePushMessage(message)
    );
  }

  /**
   * Parses a URL string into connection options.
   *
   * @param {string} url - Server URL (tcp://host:port or host:port)
   * @returns {Object} Connection options
   * @private
   */
  _parseUrl(url) {
    // Remove protocol prefix if present
    let cleanUrl = url;
    if (cleanUrl.startsWith('tcp://')) {
      cleanUrl = cleanUrl.slice(6);
    }

    // Parse host and port
    const parts = cleanUrl.split(':');
    const host = parts[0] || 'localhost';
    const port = parseInt(parts[1], 10) || 5000;

    return { host, port };
  }

  /**
   * Checks if connected to server.
   *
   * @returns {boolean} True if connected
   */
  get isConnected() {
    return this._connection.isConnected;
  }

  /**
   * Gets the connection state.
   *
   * @returns {string} Connection state
   */
  get state() {
    return this._connection.state;
  }

  /**
   * Connects to the server.
   *
   * @returns {Promise<void>} Resolves when connected
   * @throws {Error} If connection fails
   */
  async connect() {
    await this._connection.connect();
  }

  /**
   * Disconnects from the server.
   *
   * @returns {Promise<void>}
   */
  async disconnect() {
    // Cancel all subscriptions
    for (const [id] of this._subscriptions) {
      this._subscriptions.get(id).active = false;
    }
    this._subscriptions.clear();

    await this._connection.disconnect();
  }

  // ===========================================================================
  // Queue Operations
  // ===========================================================================

  /**
   * Adds an item to a queue.
   *
   * @param {string} queue - Queue name
   * @param {Object|import('../index.d.ts').Link} payload - Item to enqueue
   * @param {Object} [options] - Enqueue options
   * @param {number} [options.priority] - Message priority (0-9)
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<{id: string, position: number}>} Enqueue result
   * @throws {Error} If operation fails
   *
   * @example
   * const result = await client.enqueue('tasks', { source: 'job', target: 'process' });
   * console.log('Enqueued with ID:', result.id);
   */
  async enqueue(queue, payload, options = {}) {
    const request = createEnqueueRequest(queue, payload, {
      priority: options.priority,
    });

    const response = await this._sendRequest(
      request,
      options.timeout ?? this._options.requestTimeout
    );

    return response.result;
  }

  /**
   * Removes and returns the next item from a queue.
   *
   * @param {string} queue - Queue name
   * @param {Object} [options] - Dequeue options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<import('../index.d.ts').Link|null>} The dequeued item or null if empty
   * @throws {Error} If operation fails (except for empty queue)
   *
   * @example
   * const item = await client.dequeue('tasks');
   * if (item) {
   *   console.log('Got item:', item.id);
   *   await client.acknowledge('tasks', item.id);
   * }
   */
  async dequeue(queue, options = {}) {
    const request = createDequeueRequest(queue);

    try {
      const response = await this._sendRequest(
        request,
        options.timeout ?? this._options.requestTimeout
      );

      if (response.status === ResponseStatus.ERROR) {
        if (response.error?.code === ErrorCode.QUEUE_EMPTY) {
          return null;
        }
        throw this._createError(response);
      }

      return response.result;
    } catch (error) {
      // Handle queue empty as null return
      if (error.code === ErrorCode.QUEUE_EMPTY) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Returns the next item without removing it.
   *
   * @param {string} queue - Queue name
   * @param {Object} [options] - Peek options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<import('../index.d.ts').Link|null>} The next item or null if empty
   * @throws {Error} If operation fails (except for empty queue)
   */
  async peek(queue, options = {}) {
    const request = createPeekRequest(queue);

    try {
      const response = await this._sendRequest(
        request,
        options.timeout ?? this._options.requestTimeout
      );

      if (response.status === ResponseStatus.ERROR) {
        if (response.error?.code === ErrorCode.QUEUE_EMPTY) {
          return null;
        }
        throw this._createError(response);
      }

      return response.result;
    } catch (error) {
      if (error.code === ErrorCode.QUEUE_EMPTY) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Acknowledges successful processing of an item.
   *
   * @param {string} queue - Queue name
   * @param {string|number} messageId - ID of the message to acknowledge
   * @param {Object} [options] - Acknowledge options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<void>}
   * @throws {Error} If operation fails
   *
   * @example
   * const item = await client.dequeue('tasks');
   * await processItem(item);
   * await client.acknowledge('tasks', item.id);
   */
  async acknowledge(queue, messageId, options = {}) {
    const request = createAckRequest(queue, messageId);

    await this._sendRequest(
      request,
      options.timeout ?? this._options.requestTimeout
    );
  }

  /**
   * Rejects an item, optionally requeuing it.
   *
   * @param {string} queue - Queue name
   * @param {string|number} messageId - ID of the message to reject
   * @param {boolean} [requeue=false] - Whether to requeue the item
   * @param {Object} [options] - Reject options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<void>}
   * @throws {Error} If operation fails
   *
   * @example
   * const item = await client.dequeue('tasks');
   * if (!canProcess(item)) {
   *   await client.reject('tasks', item.id, true); // Requeue for retry
   * }
   */
  async reject(queue, messageId, requeue = false, options = {}) {
    const request = createRejectRequest(queue, messageId, requeue);

    await this._sendRequest(
      request,
      options.timeout ?? this._options.requestTimeout
    );
  }

  // ===========================================================================
  // Queue Management
  // ===========================================================================

  /**
   * Creates a new queue.
   *
   * @param {string} name - Queue name
   * @param {Object} [queueOptions] - Queue options
   * @param {number} [queueOptions.maxSize] - Maximum queue size
   * @param {number} [queueOptions.visibilityTimeout] - Visibility timeout in seconds
   * @param {number} [queueOptions.retryLimit] - Maximum retry attempts
   * @param {string} [queueOptions.deadLetterQueue] - Dead letter queue name
   * @param {boolean} [queueOptions.priority] - Enable priority ordering
   * @param {Object} [options] - Request options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<{created: boolean, name: string}>}
   * @throws {Error} If queue already exists or operation fails
   *
   * @example
   * await client.createQueue('tasks', {
   *   maxSize: 1000,
   *   visibilityTimeout: 60,
   *   deadLetterQueue: 'tasks-dlq'
   * });
   */
  async createQueue(name, queueOptions = {}, options = {}) {
    const request = createCreateQueueRequest(name, queueOptions);

    const response = await this._sendRequest(
      request,
      options.timeout ?? this._options.requestTimeout
    );

    return response.result;
  }

  /**
   * Deletes a queue.
   *
   * @param {string} name - Queue name
   * @param {Object} [options] - Request options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<{deleted: boolean, name: string}>}
   * @throws {Error} If queue not found or operation fails
   */
  async deleteQueue(name, options = {}) {
    const request = createDeleteQueueRequest(name);

    const response = await this._sendRequest(
      request,
      options.timeout ?? this._options.requestTimeout
    );

    return response.result;
  }

  /**
   * Lists all queues.
   *
   * @param {Object} [options] - Request options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<Array<{name: string, depth: number, createdAt: number}>>}
   * @throws {Error} If operation fails
   */
  async listQueues(options = {}) {
    const request = createListQueuesRequest();

    const response = await this._sendRequest(
      request,
      options.timeout ?? this._options.requestTimeout
    );

    return response.result?.queues || [];
  }

  /**
   * Gets statistics for a queue.
   *
   * @param {string} queue - Queue name
   * @param {Object} [options] - Request options
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<import('../queue/types.ts').QueueStats>}
   * @throws {Error} If queue not found or operation fails
   */
  async getStats(queue, options = {}) {
    const request = createGetStatsRequest(queue);

    const response = await this._sendRequest(
      request,
      options.timeout ?? this._options.requestTimeout
    );

    return response.result;
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribes to a queue to receive items as they become available.
   *
   * Note: This is a client-side polling implementation. True push
   * subscriptions would require server-side support.
   *
   * @param {string} queue - Queue name
   * @param {Function} callback - Callback for received items: (link) => Promise<void>
   * @param {Object} [options] - Subscription options
   * @param {number} [options.pollInterval=1000] - Poll interval in ms
   * @param {boolean} [options.autoAck=false] - Auto-acknowledge after callback
   * @returns {{id: string, unsubscribe: Function}} Subscription handle
   *
   * @example
   * const subscription = client.subscribe('tasks', async (link) => {
   *   console.log('Received:', link);
   *   await processLink(link);
   *   await client.acknowledge('tasks', link.id);
   * });
   *
   * // Later...
   * subscription.unsubscribe();
   */
  subscribe(queue, callback, options = {}) {
    const pollInterval = options.pollInterval ?? 1000;
    const autoAck = options.autoAck ?? false;

    const subscriptionId = `sub-${++this._subscriptionId}`;

    const subscription = {
      queue,
      callback,
      active: true,
    };

    this._subscriptions.set(subscriptionId, subscription);

    // Start polling
    const poll = async () => {
      if (!subscription.active || !this.isConnected) {
        return;
      }

      try {
        const item = await this.dequeue(queue);
        if (item && subscription.active) {
          try {
            await callback(item);
            if (autoAck) {
              await this.acknowledge(queue, item.id);
            }
          } catch (error) {
            this.emit('error', error);
          }
        }
      } catch (error) {
        if (error.code !== ErrorCode.QUEUE_EMPTY) {
          this.emit('error', error);
        }
      }

      // Schedule next poll
      if (subscription.active) {
        setTimeout(poll, pollInterval);
      }
    };

    // Start polling
    setTimeout(poll, 0);

    return {
      id: subscriptionId,
      unsubscribe: () => {
        subscription.active = false;
        this._subscriptions.delete(subscriptionId);
      },
    };
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Sends a request and waits for response.
   *
   * @param {Message} request - Request message
   * @param {number} timeout - Request timeout in ms
   * @returns {Promise<Message>} Response message
   * @throws {Error} If request fails
   * @private
   */
  async _sendRequest(request, timeout) {
    const response = await this._connection.request(request, timeout);

    if (response.status === ResponseStatus.ERROR) {
      throw this._createError(response);
    }

    return response;
  }

  /**
   * Creates an error from a response.
   *
   * @param {Message} response - Error response
   * @returns {Error} The created error
   * @private
   */
  _createError(response) {
    const errorCode = response.error?.code || ErrorCode.INTERNAL_ERROR;
    const errorMessage = response.error?.message || 'Unknown error';

    const error = new Error(errorMessage);
    error.code = errorCode;
    return error;
  }

  /**
   * Handles push messages from server.
   *
   * @param {Message} message - Received message
   * @private
   */
  _handlePushMessage(message) {
    // Push messages would be handled here for true server-push subscriptions
    this.emit('message', message);
  }

  /**
   * Returns client statistics.
   *
   * @returns {Object} Client statistics
   */
  getClientStats() {
    return {
      ...this._connection.getStats(),
      subscriptions: this._subscriptions.size,
    };
  }
}
