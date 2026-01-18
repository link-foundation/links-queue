/**
 * Request routing for Links Queue TCP server.
 *
 * This module provides the RequestRouter class for routing protocol
 * messages to appropriate queue operations.
 *
 * @module server/router
 */

import {
  RequestType,
  ErrorCode,
  createOkResponse,
  createErrorResponse,
} from '../protocol/messages.js';

// =============================================================================
// RequestRouter Class
// =============================================================================

/**
 * Routes incoming protocol messages to queue operations.
 *
 * Handles all request types defined in the Links Queue protocol,
 * including queue operations, management operations, and health checks.
 *
 * @example
 * const router = new RequestRouter(queueManager);
 *
 * // Handle an incoming message
 * const response = await router.route(message, connection);
 * connection.send(response);
 */
export class RequestRouter {
  /**
   * Creates a new RequestRouter.
   *
   * @param {import('../queue/manager.js').MemoryQueueManager | import('../queue/manager.js').LinksQueueManager} queueManager - Queue manager instance
   * @param {Object} [options] - Router options
   * @param {boolean} [options.enableLogging=false] - Enable request logging
   */
  constructor(queueManager, options = {}) {
    /**
     * The queue manager for handling queue operations.
     * @type {import('../queue/manager.js').MemoryQueueManager | import('../queue/manager.js').LinksQueueManager}
     * @private
     */
    this._queueManager = queueManager;

    /**
     * Router options.
     * @type {Object}
     * @private
     */
    this._options = {
      enableLogging: options.enableLogging ?? false,
    };

    /**
     * Request handlers by type.
     * @type {Map<string, Function>}
     * @private
     */
    this._handlers = new Map([
      [RequestType.ENQUEUE, this._handleEnqueue.bind(this)],
      [RequestType.DEQUEUE, this._handleDequeue.bind(this)],
      [RequestType.PEEK, this._handlePeek.bind(this)],
      [RequestType.ACK, this._handleAck.bind(this)],
      [RequestType.REJECT, this._handleReject.bind(this)],
      [RequestType.QUERY, this._handleQuery.bind(this)],
      [RequestType.GET_STATS, this._handleGetStats.bind(this)],
      [RequestType.LIST_QUEUES, this._handleListQueues.bind(this)],
      [RequestType.CREATE_QUEUE, this._handleCreateQueue.bind(this)],
      [RequestType.DELETE_QUEUE, this._handleDeleteQueue.bind(this)],
    ]);

    /**
     * Request count for statistics.
     * @type {number}
     */
    this.requestCount = 0;

    /**
     * Error count for statistics.
     * @type {number}
     */
    this.errorCount = 0;
  }

  /**
   * Routes a message to the appropriate handler.
   *
   * @param {import('../protocol/messages.js').Message} message - The incoming message
   * @param {import('./connection.js').ServerConnection} [connection] - The client connection (optional)
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   */
  async route(message, connection = null) {
    this.requestCount++;

    try {
      // Validate message has a type
      if (!message.type) {
        return createErrorResponse(
          ErrorCode.INVALID_REQUEST,
          'Message type is required'
        );
      }

      // Get handler for message type
      const handler = this._handlers.get(message.type);
      if (!handler) {
        return createErrorResponse(
          ErrorCode.INVALID_REQUEST,
          `Unknown request type: ${message.type}`
        );
      }

      // Execute handler
      const response = await handler(message, connection);
      return response;
    } catch (error) {
      this.errorCount++;

      // Handle known error types
      if (error.code) {
        return createErrorResponse(error.code, error.message);
      }

      // Unknown error
      return createErrorResponse(
        ErrorCode.INTERNAL_ERROR,
        error.message || 'Internal server error'
      );
    }
  }

  /**
   * Handles ENQUEUE request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleEnqueue(message) {
    const { queue: queueName, payload, priority } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    if (!payload) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Payload is required'
      );
    }

    const queue = await this._queueManager.getQueue(queueName);
    if (!queue) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    // Create a link from the payload
    const link = this._payloadToLink(payload, priority);

    const result = await queue.enqueue(link);
    return createOkResponse({
      id: result.id,
      position: result.position,
    });
  }

  /**
   * Handles DEQUEUE request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleDequeue(message) {
    const { queue: queueName } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    const queue = await this._queueManager.getQueue(queueName);
    if (!queue) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    const link = await queue.dequeue();
    if (!link) {
      return createErrorResponse(
        ErrorCode.QUEUE_EMPTY,
        `Queue '${queueName}' is empty`
      );
    }

    return createOkResponse({
      id: link.id,
      source: link.source,
      target: link.target,
      values: link.values,
    });
  }

  /**
   * Handles PEEK request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handlePeek(message) {
    const { queue: queueName } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    const queue = await this._queueManager.getQueue(queueName);
    if (!queue) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    const link = await queue.peek();
    if (!link) {
      return createErrorResponse(
        ErrorCode.QUEUE_EMPTY,
        `Queue '${queueName}' is empty`
      );
    }

    return createOkResponse({
      id: link.id,
      source: link.source,
      target: link.target,
      values: link.values,
    });
  }

  /**
   * Handles ACK request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleAck(message) {
    const { queue: queueName, messageId } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    if (!messageId) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Message ID is required'
      );
    }

    const queue = await this._queueManager.getQueue(queueName);
    if (!queue) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    try {
      await queue.acknowledge(messageId);
      return createOkResponse({ acknowledged: true });
    } catch (error) {
      if (error.code === 'ITEM_NOT_IN_FLIGHT') {
        return createErrorResponse(
          ErrorCode.MESSAGE_NOT_FOUND,
          `Message '${messageId}' not found or not in-flight`
        );
      }
      throw error;
    }
  }

  /**
   * Handles REJECT request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleReject(message) {
    const { queue: queueName, messageId, requeue } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    if (!messageId) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Message ID is required'
      );
    }

    const queue = await this._queueManager.getQueue(queueName);
    if (!queue) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    try {
      await queue.reject(messageId, requeue ?? false);
      return createOkResponse({ rejected: true, requeued: requeue ?? false });
    } catch (error) {
      if (error.code === 'ITEM_NOT_IN_FLIGHT') {
        return createErrorResponse(
          ErrorCode.MESSAGE_NOT_FOUND,
          `Message '${messageId}' not found or not in-flight`
        );
      }
      throw error;
    }
  }

  /**
   * Handles QUERY request (get queue info).
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleQuery(message) {
    const { queue: queueName } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    const queue = await this._queueManager.getQueue(queueName);
    if (!queue) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    const depth = queue.getDepth();
    return createOkResponse({
      name: queueName,
      depth,
    });
  }

  /**
   * Handles GET_STATS request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleGetStats(message) {
    const { queue: queueName } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    const queue = await this._queueManager.getQueue(queueName);
    if (!queue) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    const stats = queue.getStats();
    return createOkResponse(stats);
  }

  /**
   * Handles LIST_QUEUES request.
   *
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleListQueues() {
    const queues = await this._queueManager.listQueues();
    return createOkResponse({
      queues: queues.map((q) => ({
        name: q.name,
        depth: q.depth,
        createdAt: q.createdAt,
      })),
    });
  }

  /**
   * Handles CREATE_QUEUE request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleCreateQueue(message) {
    const { queue: queueName, options } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    // Check if queue already exists
    if (this._queueManager.hasQueue(queueName)) {
      return createErrorResponse(
        ErrorCode.QUEUE_EXISTS,
        `Queue '${queueName}' already exists`
      );
    }

    // Parse options from the message
    const queueOptions = this._parseQueueOptions(options);

    await this._queueManager.createQueue(queueName, queueOptions);
    return createOkResponse({
      created: true,
      name: queueName,
    });
  }

  /**
   * Handles DELETE_QUEUE request.
   *
   * @param {import('../protocol/messages.js').Message} message - The request message
   * @returns {Promise<import('../protocol/messages.js').Message>} The response message
   * @private
   */
  async _handleDeleteQueue(message) {
    const { queue: queueName } = message;

    if (!queueName) {
      return createErrorResponse(
        ErrorCode.INVALID_REQUEST,
        'Queue name is required'
      );
    }

    const deleted = await this._queueManager.deleteQueue(queueName);
    if (!deleted) {
      return createErrorResponse(
        ErrorCode.QUEUE_NOT_FOUND,
        `Queue '${queueName}' not found`
      );
    }

    return createOkResponse({
      deleted: true,
      name: queueName,
    });
  }

  /**
   * Converts a payload to a Link object.
   *
   * @param {*} payload - The payload data
   * @param {number} [priority] - Optional priority value
   * @returns {import('../index.d.ts').Link} The created link
   * @private
   */
  _payloadToLink(payload, priority) {
    // Generate a unique ID
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // If payload is already a link-like object, use it
    if (
      payload &&
      typeof payload === 'object' &&
      'source' in payload &&
      'target' in payload
    ) {
      return {
        id: payload.id ?? id,
        source: payload.source,
        target: payload.target,
        values: payload.values,
      };
    }

    // Create a simple link with payload as both source and target
    // Priority can be encoded in the source if needed
    const source =
      priority !== undefined && priority !== null ? priority : payload;
    const target = payload;

    return { id, source, target };
  }

  /**
   * Parses queue options from a message payload.
   *
   * @param {*} options - Options from message
   * @returns {import('../queue/types.ts').QueueOptions} Parsed queue options
   * @private
   */
  _parseQueueOptions(options) {
    if (!options || typeof options !== 'object') {
      return {};
    }

    const result = {};

    if (options.maxSize !== undefined) {
      result.maxSize = parseInt(String(options.maxSize), 10);
    }
    if (options.visibilityTimeout !== undefined) {
      result.visibilityTimeout = parseInt(
        String(options.visibilityTimeout),
        10
      );
    }
    if (options.retryLimit !== undefined) {
      result.retryLimit = parseInt(String(options.retryLimit), 10);
    }
    if (options.deadLetterQueue !== undefined) {
      result.deadLetterQueue = String(options.deadLetterQueue);
    }
    if (options.priority !== undefined) {
      result.priority =
        options.priority === true || options.priority === 'true';
    }

    return result;
  }

  /**
   * Returns router statistics.
   *
   * @returns {Object} Router statistics
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate:
        this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
    };
  }

  /**
   * Registers a custom request handler.
   *
   * @param {string} type - Request type
   * @param {Function} handler - Handler function (message, connection) => Promise<Message>
   */
  registerHandler(type, handler) {
    this._handlers.set(type, handler);
  }
}
