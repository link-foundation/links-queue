/**
 * Protocol message types for Links Queue communication.
 *
 * This module defines the message types used for inter-node communication
 * and client-server interaction in Links Queue.
 *
 * @module protocol/messages
 */

import { LinksNotation } from './notation.js';
import { createLink } from '../index.js';

// =============================================================================
// Message Types
// =============================================================================

/**
 * Request message types for queue operations.
 * @readonly
 * @enum {string}
 */
export const RequestType = Object.freeze({
  /** Add item to queue */
  ENQUEUE: 'enqueue',
  /** Remove item from queue */
  DEQUEUE: 'dequeue',
  /** Acknowledge message processing */
  ACK: 'ack',
  /** Reject message processing */
  REJECT: 'reject',
  /** Query queue status */
  QUERY: 'query',
  /** Synchronization between nodes */
  SYNC: 'sync',
  /** Peek at next message without removing */
  PEEK: 'peek',
  /** Create a new queue */
  CREATE_QUEUE: 'create_queue',
  /** Delete a queue */
  DELETE_QUEUE: 'delete_queue',
  /** List all queues */
  LIST_QUEUES: 'list_queues',
  /** Get queue statistics */
  GET_STATS: 'get_stats',
});

/**
 * Response status types.
 * @readonly
 * @enum {string}
 */
export const ResponseStatus = Object.freeze({
  /** Operation succeeded */
  OK: 'ok',
  /** Operation failed */
  ERROR: 'error',
});

/**
 * Standard error codes.
 * @readonly
 * @enum {string}
 */
export const ErrorCode = Object.freeze({
  /** Queue is empty */
  QUEUE_EMPTY: 'QUEUE_EMPTY',
  /** Queue not found */
  QUEUE_NOT_FOUND: 'QUEUE_NOT_FOUND',
  /** Queue already exists */
  QUEUE_EXISTS: 'QUEUE_EXISTS',
  /** Message not found */
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  /** Invalid request format */
  INVALID_REQUEST: 'INVALID_REQUEST',
  /** Operation not allowed */
  NOT_ALLOWED: 'NOT_ALLOWED',
  /** Internal server error */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Request timeout */
  TIMEOUT: 'TIMEOUT',
  /** Connection error */
  CONNECTION_ERROR: 'CONNECTION_ERROR',
});

// =============================================================================
// Message Builders
// =============================================================================

/**
 * Builder class for creating protocol messages.
 *
 * Provides a fluent API for constructing request and response messages
 * that can be serialized to Links Notation.
 *
 * @example
 * // Build an enqueue request
 * const msg = new MessageBuilder()
 *   .type(RequestType.ENQUEUE)
 *   .queue('tasks')
 *   .payload({ action: 'process', data: '...' })
 *   .build();
 *
 * // Convert to notation
 * const notation = msg.toNotation();
 */
export class MessageBuilder {
  /** @type {Object} */
  #data = {};

  /**
   * Sets the message type.
   *
   * @param {string} type - Request type from RequestType enum
   * @returns {this} Builder instance for chaining
   */
  type(type) {
    this.#data.type = type;
    return this;
  }

  /**
   * Sets the target queue name.
   *
   * @param {string} name - Queue name
   * @returns {this} Builder instance for chaining
   */
  queue(name) {
    this.#data.queue = name;
    return this;
  }

  /**
   * Sets the message payload.
   *
   * @param {*} payload - Message payload data
   * @returns {this} Builder instance for chaining
   */
  payload(payload) {
    this.#data.payload = payload;
    return this;
  }

  /**
   * Sets the message ID (for ack/reject operations).
   *
   * @param {string} id - Message identifier
   * @returns {this} Builder instance for chaining
   */
  messageId(id) {
    this.#data.messageId = id;
    return this;
  }

  /**
   * Sets whether to requeue on reject.
   *
   * @param {boolean} requeue - True to requeue
   * @returns {this} Builder instance for chaining
   */
  requeue(requeue) {
    this.#data.requeue = requeue;
    return this;
  }

  /**
   * Sets message priority.
   *
   * @param {number} priority - Priority level (0-9)
   * @returns {this} Builder instance for chaining
   */
  priority(priority) {
    this.#data.priority = priority;
    return this;
  }

  /**
   * Sets message options.
   *
   * @param {Object} options - Additional options
   * @returns {this} Builder instance for chaining
   */
  options(options) {
    this.#data.options = options;
    return this;
  }

  /**
   * Builds the message object.
   *
   * @returns {Message} The constructed message
   */
  build() {
    return new Message(this.#data);
  }
}

// =============================================================================
// Message Class
// =============================================================================

/**
 * Represents a protocol message.
 *
 * Messages can be converted to/from Links Notation strings for
 * wire transport.
 */
export class Message {
  /**
   * Creates a new Message.
   *
   * @param {Object} data - Message data
   */
  constructor(data) {
    this.type = data.type || null;
    this.queue = data.queue || null;
    this.payload = data.payload || null;
    this.messageId = data.messageId || null;
    this.requeue = data.requeue ?? null;
    this.priority = data.priority ?? null;
    this.options = data.options || null;
    this.status = data.status || null;
    this.result = data.result || null;
    this.error = data.error || null;
  }

  /**
   * Converts the message to a Link object.
   *
   * @returns {import('../index.js').Link} Link representation of message
   */
  toLink() {
    const values = [];

    // Add type
    if (this.type !== null) {
      values.push(createLink(values.length, 'type', this.type));
    }

    // Add status for responses
    if (this.status !== null) {
      values.push(createLink(values.length, 'status', this.status));
    }

    // Add queue
    if (this.queue !== null) {
      values.push(createLink(values.length, 'queue', this.queue));
    }

    // Add message ID
    if (this.messageId !== null) {
      values.push(createLink(values.length, 'id', this.messageId));
    }

    // Add payload
    if (this.payload !== null) {
      const payloadLink = this.#convertPayloadToLink(this.payload);
      values.push(createLink(values.length, 'payload', payloadLink));
    }

    // Add result
    if (this.result !== null) {
      const resultLink = this.#convertPayloadToLink(this.result);
      values.push(createLink(values.length, 'result', resultLink));
    }

    // Add error
    if (this.error !== null) {
      if (typeof this.error === 'object') {
        const errorValues = [];
        if (this.error.code) {
          errorValues.push(
            createLink(errorValues.length, 'code', this.error.code)
          );
        }
        if (this.error.message) {
          errorValues.push(
            createLink(errorValues.length, 'message', this.error.message)
          );
        }
        const errorLink = createLink(
          values.length,
          'error',
          'error',
          errorValues
        );
        values.push(errorLink);
      } else {
        values.push(createLink(values.length, 'error', String(this.error)));
      }
    }

    // Add additional fields
    if (this.requeue !== null) {
      values.push(createLink(values.length, 'requeue', String(this.requeue)));
    }

    if (this.priority !== null) {
      values.push(createLink(values.length, 'priority', String(this.priority)));
    }

    if (this.options !== null) {
      const optionsLink = this.#convertPayloadToLink(this.options);
      values.push(createLink(values.length, 'options', optionsLink));
    }

    // Create the root message link
    if (values.length === 0) {
      return createLink(0, '', '');
    }

    if (values.length === 1) {
      return values[0];
    }

    // Create a compound link containing all message parts
    return createLink(
      0,
      values[0],
      values.length > 1 ? values[1] : values[0],
      values.slice(2)
    );
  }

  /**
   * Converts a payload object to a Link structure.
   *
   * @param {*} payload - Payload to convert
   * @returns {import('../index.js').Link|string} Converted payload
   * @private
   */
  #convertPayloadToLink(payload) {
    if (payload === null || payload === undefined) {
      return '';
    }

    if (
      typeof payload === 'string' ||
      typeof payload === 'number' ||
      typeof payload === 'boolean'
    ) {
      return String(payload);
    }

    if (Array.isArray(payload)) {
      const values = payload.map((item, i) => {
        const converted = this.#convertPayloadToLink(item);
        return typeof converted === 'string'
          ? createLink(i, converted, converted)
          : converted;
      });
      return createLink(
        0,
        values[0] || '',
        values[1] || values[0] || '',
        values.slice(2)
      );
    }

    if (typeof payload === 'object') {
      const entries = Object.entries(payload);
      const values = entries.map(([key, value], i) => {
        const converted = this.#convertPayloadToLink(value);
        return createLink(i, key, converted);
      });
      if (values.length === 0) {
        return '';
      }
      if (values.length === 1) {
        return values[0];
      }
      return createLink(
        0,
        values[0],
        values.length > 1 ? values[1] : values[0],
        values.slice(2)
      );
    }

    return String(payload);
  }

  /**
   * Converts the message to Links Notation string.
   *
   * @param {Object} [options] - Serialization options
   * @param {boolean} [options.pretty=false] - Use pretty formatting
   * @returns {string} Links Notation representation
   */
  toNotation(options = {}) {
    const link = this.toLink();
    return LinksNotation.stringify(link, options);
  }

  /**
   * Creates a Message from a Link object.
   *
   * @param {import('../index.js').Link} link - Link to parse
   * @returns {Message} Parsed message
   */
  static fromLink(link) {
    const data = {};

    // Helper to get the source value from a link (handles nested Link objects)
    const getSourceValue = (l) => {
      if (l === null || l === undefined) {
        return null;
      }
      if (typeof l === 'object' && 'source' in l) {
        return l.source;
      }
      return l;
    };

    // Helper to get the target value from a link (handles nested Link objects)
    const getTargetValue = (l) => {
      if (l === null || l === undefined) {
        return null;
      }
      if (typeof l === 'object' && 'target' in l) {
        return l.target;
      }
      return l;
    };

    // Recursively extract a field by name from a link structure
    const extractField = (l, fieldName) => {
      if (l === null || l === undefined) {
        return undefined;
      }

      // Check if this link's source matches the field name
      const source = getSourceValue(l);
      if (source === fieldName) {
        return getTargetValue(l);
      }

      // Check if source is itself a Link with matching source
      if (typeof source === 'object' && source !== null && 'source' in source) {
        const result = extractField(source, fieldName);
        if (result !== undefined) {
          return result;
        }
      }

      // Check if target is a Link we should search
      const target = getTargetValue(l);
      if (typeof target === 'object' && target !== null && 'source' in target) {
        const result = extractField(target, fieldName);
        if (result !== undefined) {
          return result;
        }
      }

      // Check values array
      if (l.values && Array.isArray(l.values)) {
        for (const v of l.values) {
          const result = extractField(v, fieldName);
          if (result !== undefined) {
            return result;
          }
        }
      }

      return undefined;
    };

    data.type = extractField(link, 'type');
    data.status = extractField(link, 'status');
    data.queue = extractField(link, 'queue');
    data.messageId = extractField(link, 'id');
    data.payload = extractField(link, 'payload');
    data.result = extractField(link, 'result');
    data.error = extractField(link, 'error');
    data.requeue = extractField(link, 'requeue');
    data.priority = extractField(link, 'priority');

    // Convert requeue to boolean
    if (typeof data.requeue === 'string') {
      data.requeue = data.requeue === 'true';
    }

    // Convert priority to number
    if (typeof data.priority === 'string') {
      data.priority = parseInt(data.priority, 10);
    }

    return new Message(data);
  }

  /**
   * Creates a Message from a Links Notation string.
   *
   * @param {string} notation - Links Notation string
   * @returns {Message} Parsed message
   */
  static fromNotation(notation) {
    const links = LinksNotation.parse(notation);
    if (links.length === 0) {
      return new Message({});
    }
    return Message.fromLink(links[0]);
  }
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Creates a success response message.
 *
 * @param {*} [result] - Result data
 * @returns {Message} Success response message
 *
 * @example
 * const response = createOkResponse({ id: 'abc123', position: 42 });
 */
export function createOkResponse(result = null) {
  return new Message({
    status: ResponseStatus.OK,
    result,
  });
}

/**
 * Creates an error response message.
 *
 * @param {string} code - Error code from ErrorCode enum
 * @param {string} message - Human-readable error message
 * @returns {Message} Error response message
 *
 * @example
 * const response = createErrorResponse(ErrorCode.QUEUE_EMPTY, 'No messages available');
 */
export function createErrorResponse(code, message) {
  return new Message({
    status: ResponseStatus.ERROR,
    error: { code, message },
  });
}

// =============================================================================
// Request Builders
// =============================================================================

/**
 * Creates an enqueue request message.
 *
 * @param {string} queue - Target queue name
 * @param {*} payload - Message payload
 * @param {Object} [options] - Additional options
 * @param {number} [options.priority] - Message priority (0-9)
 * @returns {Message} Enqueue request message
 *
 * @example
 * const request = createEnqueueRequest('tasks', { action: 'process' });
 */
export function createEnqueueRequest(queue, payload, options = {}) {
  return new Message({
    type: RequestType.ENQUEUE,
    queue,
    payload,
    priority: options.priority ?? null,
    options: options.options ?? null,
  });
}

/**
 * Creates a dequeue request message.
 *
 * @param {string} queue - Target queue name
 * @returns {Message} Dequeue request message
 *
 * @example
 * const request = createDequeueRequest('tasks');
 */
export function createDequeueRequest(queue) {
  return new Message({
    type: RequestType.DEQUEUE,
    queue,
  });
}

/**
 * Creates a peek request message.
 *
 * @param {string} queue - Target queue name
 * @returns {Message} Peek request message
 */
export function createPeekRequest(queue) {
  return new Message({
    type: RequestType.PEEK,
    queue,
  });
}

/**
 * Creates an acknowledge request message.
 *
 * @param {string} queue - Target queue name
 * @param {string} messageId - ID of message to acknowledge
 * @returns {Message} Acknowledge request message
 *
 * @example
 * const request = createAckRequest('tasks', 'abc123');
 */
export function createAckRequest(queue, messageId) {
  return new Message({
    type: RequestType.ACK,
    queue,
    messageId,
  });
}

/**
 * Creates a reject request message.
 *
 * @param {string} queue - Target queue name
 * @param {string} messageId - ID of message to reject
 * @param {boolean} [requeue=false] - Whether to requeue the message
 * @returns {Message} Reject request message
 *
 * @example
 * const request = createRejectRequest('tasks', 'abc123', true);
 */
export function createRejectRequest(queue, messageId, requeue = false) {
  return new Message({
    type: RequestType.REJECT,
    queue,
    messageId,
    requeue,
  });
}

/**
 * Creates a query request message.
 *
 * @param {string} queue - Target queue name
 * @returns {Message} Query request message
 */
export function createQueryRequest(queue) {
  return new Message({
    type: RequestType.QUERY,
    queue,
  });
}

/**
 * Creates a get stats request message.
 *
 * @param {string} queue - Target queue name
 * @returns {Message} Get stats request message
 */
export function createGetStatsRequest(queue) {
  return new Message({
    type: RequestType.GET_STATS,
    queue,
  });
}

/**
 * Creates a list queues request message.
 *
 * @returns {Message} List queues request message
 */
export function createListQueuesRequest() {
  return new Message({
    type: RequestType.LIST_QUEUES,
  });
}

/**
 * Creates a create queue request message.
 *
 * @param {string} name - Queue name to create
 * @param {Object} [options] - Queue options
 * @returns {Message} Create queue request message
 */
export function createCreateQueueRequest(name, options = {}) {
  return new Message({
    type: RequestType.CREATE_QUEUE,
    queue: name,
    options,
  });
}

/**
 * Creates a delete queue request message.
 *
 * @param {string} name - Queue name to delete
 * @returns {Message} Delete queue request message
 */
export function createDeleteQueueRequest(name) {
  return new Message({
    type: RequestType.DELETE_QUEUE,
    queue: name,
  });
}
