/**
 * Protocol message types for Links Queue communication.
 *
 * This module defines the message types used for inter-node communication
 * and client-server interaction in Links Queue.
 *
 * @module protocol/messages
 */

import { Link } from '../index.d.ts';
import { StringifyOptions } from './notation.d.ts';

// =============================================================================
// Enum Types
// =============================================================================

/**
 * Request message types for queue operations.
 */
export declare const RequestType: {
  /** Add item to queue */
  readonly ENQUEUE: 'enqueue';
  /** Remove item from queue */
  readonly DEQUEUE: 'dequeue';
  /** Acknowledge message processing */
  readonly ACK: 'ack';
  /** Reject message processing */
  readonly REJECT: 'reject';
  /** Query queue status */
  readonly QUERY: 'query';
  /** Synchronization between nodes */
  readonly SYNC: 'sync';
  /** Peek at next message without removing */
  readonly PEEK: 'peek';
  /** Create a new queue */
  readonly CREATE_QUEUE: 'create_queue';
  /** Delete a queue */
  readonly DELETE_QUEUE: 'delete_queue';
  /** List all queues */
  readonly LIST_QUEUES: 'list_queues';
  /** Get queue statistics */
  readonly GET_STATS: 'get_stats';
};

/**
 * Request type values.
 */
export type RequestTypeValue = (typeof RequestType)[keyof typeof RequestType];

/**
 * Response status types.
 */
export declare const ResponseStatus: {
  /** Operation succeeded */
  readonly OK: 'ok';
  /** Operation failed */
  readonly ERROR: 'error';
};

/**
 * Response status values.
 */
export type ResponseStatusValue =
  (typeof ResponseStatus)[keyof typeof ResponseStatus];

/**
 * Standard error codes.
 */
export declare const ErrorCode: {
  /** Queue is empty */
  readonly QUEUE_EMPTY: 'QUEUE_EMPTY';
  /** Queue not found */
  readonly QUEUE_NOT_FOUND: 'QUEUE_NOT_FOUND';
  /** Queue already exists */
  readonly QUEUE_EXISTS: 'QUEUE_EXISTS';
  /** Message not found */
  readonly MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND';
  /** Invalid request format */
  readonly INVALID_REQUEST: 'INVALID_REQUEST';
  /** Operation not allowed */
  readonly NOT_ALLOWED: 'NOT_ALLOWED';
  /** Internal server error */
  readonly INTERNAL_ERROR: 'INTERNAL_ERROR';
  /** Request timeout */
  readonly TIMEOUT: 'TIMEOUT';
  /** Connection error */
  readonly CONNECTION_ERROR: 'CONNECTION_ERROR';
};

/**
 * Error code values.
 */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// =============================================================================
// Data Types
// =============================================================================

/**
 * Message data structure.
 */
export interface MessageData {
  type?: RequestTypeValue | null;
  status?: ResponseStatusValue | null;
  queue?: string | null;
  messageId?: string | null;
  payload?: unknown;
  result?: unknown;
  error?: ErrorInfo | string | null;
  requeue?: boolean | null;
  priority?: number | null;
  options?: Record<string, unknown> | null;
}

/**
 * Error information structure.
 */
export interface ErrorInfo {
  code: ErrorCodeValue | string;
  message: string;
}

/**
 * Enqueue request options.
 */
export interface EnqueueOptions {
  /**
   * Message priority (0-9).
   */
  priority?: number;

  /**
   * Additional options.
   */
  options?: Record<string, unknown>;
}

// =============================================================================
// MessageBuilder Class
// =============================================================================

/**
 * Builder class for creating protocol messages.
 *
 * Provides a fluent API for constructing request and response messages
 * that can be serialized to Links Notation.
 *
 * @example
 * const msg = new MessageBuilder()
 *   .type(RequestType.ENQUEUE)
 *   .queue('tasks')
 *   .payload({ action: 'process', data: '...' })
 *   .build();
 */
export declare class MessageBuilder {
  /**
   * Sets the message type.
   *
   * @param type - Request type from RequestType enum
   * @returns Builder instance for chaining
   */
  type(type: RequestTypeValue): this;

  /**
   * Sets the target queue name.
   *
   * @param name - Queue name
   * @returns Builder instance for chaining
   */
  queue(name: string): this;

  /**
   * Sets the message payload.
   *
   * @param payload - Message payload data
   * @returns Builder instance for chaining
   */
  payload(payload: unknown): this;

  /**
   * Sets the message ID (for ack/reject operations).
   *
   * @param id - Message identifier
   * @returns Builder instance for chaining
   */
  messageId(id: string): this;

  /**
   * Sets whether to requeue on reject.
   *
   * @param requeue - True to requeue
   * @returns Builder instance for chaining
   */
  requeue(requeue: boolean): this;

  /**
   * Sets message priority.
   *
   * @param priority - Priority level (0-9)
   * @returns Builder instance for chaining
   */
  priority(priority: number): this;

  /**
   * Sets message options.
   *
   * @param options - Additional options
   * @returns Builder instance for chaining
   */
  options(options: Record<string, unknown>): this;

  /**
   * Builds the message object.
   *
   * @returns The constructed message
   */
  build(): Message;
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
export declare class Message {
  /**
   * Request type.
   */
  readonly type: RequestTypeValue | null;

  /**
   * Response status.
   */
  readonly status: ResponseStatusValue | null;

  /**
   * Target queue name.
   */
  readonly queue: string | null;

  /**
   * Message identifier.
   */
  readonly messageId: string | null;

  /**
   * Message payload.
   */
  readonly payload: unknown;

  /**
   * Response result.
   */
  readonly result: unknown;

  /**
   * Error information.
   */
  readonly error: ErrorInfo | string | null;

  /**
   * Whether to requeue on reject.
   */
  readonly requeue: boolean | null;

  /**
   * Message priority (0-9).
   */
  readonly priority: number | null;

  /**
   * Additional options.
   */
  readonly options: Record<string, unknown> | null;

  /**
   * Creates a new Message.
   *
   * @param data - Message data
   */
  constructor(data: MessageData);

  /**
   * Converts the message to a Link object.
   *
   * @returns Link representation of message
   */
  toLink(): Link;

  /**
   * Converts the message to Links Notation string.
   *
   * @param options - Serialization options
   * @returns Links Notation representation
   */
  toNotation(options?: StringifyOptions): string;

  /**
   * Creates a Message from a Link object.
   *
   * @param link - Link to parse
   * @returns Parsed message
   */
  static fromLink(link: Link): Message;

  /**
   * Creates a Message from a Links Notation string.
   *
   * @param notation - Links Notation string
   * @returns Parsed message
   */
  static fromNotation(notation: string): Message;
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Creates a success response message.
 *
 * @param result - Result data
 * @returns Success response message
 */
export declare function createOkResponse(result?: unknown): Message;

/**
 * Creates an error response message.
 *
 * @param code - Error code from ErrorCode enum
 * @param message - Human-readable error message
 * @returns Error response message
 */
export declare function createErrorResponse(
  code: ErrorCodeValue | string,
  message: string
): Message;

// =============================================================================
// Request Builders
// =============================================================================

/**
 * Creates an enqueue request message.
 *
 * @param queue - Target queue name
 * @param payload - Message payload
 * @param options - Additional options
 * @returns Enqueue request message
 */
export declare function createEnqueueRequest(
  queue: string,
  payload: unknown,
  options?: EnqueueOptions
): Message;

/**
 * Creates a dequeue request message.
 *
 * @param queue - Target queue name
 * @returns Dequeue request message
 */
export declare function createDequeueRequest(queue: string): Message;

/**
 * Creates a peek request message.
 *
 * @param queue - Target queue name
 * @returns Peek request message
 */
export declare function createPeekRequest(queue: string): Message;

/**
 * Creates an acknowledge request message.
 *
 * @param queue - Target queue name
 * @param messageId - ID of message to acknowledge
 * @returns Acknowledge request message
 */
export declare function createAckRequest(
  queue: string,
  messageId: string
): Message;

/**
 * Creates a reject request message.
 *
 * @param queue - Target queue name
 * @param messageId - ID of message to reject
 * @param requeue - Whether to requeue the message
 * @returns Reject request message
 */
export declare function createRejectRequest(
  queue: string,
  messageId: string,
  requeue?: boolean
): Message;

/**
 * Creates a query request message.
 *
 * @param queue - Target queue name
 * @returns Query request message
 */
export declare function createQueryRequest(queue: string): Message;

/**
 * Creates a get stats request message.
 *
 * @param queue - Target queue name
 * @returns Get stats request message
 */
export declare function createGetStatsRequest(queue: string): Message;

/**
 * Creates a list queues request message.
 *
 * @returns List queues request message
 */
export declare function createListQueuesRequest(): Message;

/**
 * Creates a create queue request message.
 *
 * @param name - Queue name to create
 * @param options - Queue options
 * @returns Create queue request message
 */
export declare function createCreateQueueRequest(
  name: string,
  options?: Record<string, unknown>
): Message;

/**
 * Creates a delete queue request message.
 *
 * @param name - Queue name to delete
 * @returns Delete queue request message
 */
export declare function createDeleteQueueRequest(name: string): Message;
