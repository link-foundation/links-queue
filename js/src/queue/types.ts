/**
 * Queue and QueueManager type definitions for links-queue.
 *
 * This module provides the interfaces for queue operations and queue management.
 * These interfaces establish the API contract that implementations must follow.
 *
 * @module queue/types
 *
 * Design goals:
 * - Build on top of LinkStore, adding queue-specific semantics
 * - Support multiple queue patterns (point-to-point, pub/sub, etc.)
 * - Provide reliability guarantees (at-least-once delivery, dead letter queues)
 * - Maintain API parity between JavaScript and Rust implementations
 *
 * @see https://github.com/link-foundation/links-queue
 * @see ARCHITECTURE.md - Queue Manager component
 * @see REQUIREMENTS.md - REQ-API-001 through REQ-API-022
 */

import type { Link, LinkId } from '../index.d.ts';

// =============================================================================
// Queue Result Types
// =============================================================================

/**
 * Result returned when a link is successfully enqueued.
 *
 * @property id - The unique identifier assigned to this queue item
 * @property position - The position in the queue (0-based, lower = closer to front)
 *
 * @example
 * const result = await queue.enqueue(link);
 * console.log(`Enqueued at position ${result.position}`);
 */
export interface EnqueueResult {
  /**
   * The unique identifier for this queue item.
   * This ID is used for acknowledgment and rejection.
   */
  readonly id: LinkId;

  /**
   * The position in the queue (0-based).
   * A position of 0 means this item is next to be dequeued.
   */
  readonly position: number;
}

/**
 * Statistics and metrics for a queue.
 *
 * Provides insight into queue health and processing status.
 *
 * @example
 * const stats = queue.getStats();
 * console.log(`Queue depth: ${stats.depth}, In-flight: ${stats.inFlight}`);
 */
export interface QueueStats {
  /**
   * Current number of items in the queue (not including in-flight).
   */
  readonly depth: number;

  /**
   * Total number of items enqueued since queue creation.
   */
  readonly enqueued: number;

  /**
   * Total number of items dequeued since queue creation.
   */
  readonly dequeued: number;

  /**
   * Total number of items successfully acknowledged.
   */
  readonly acknowledged: number;

  /**
   * Total number of items rejected (regardless of requeue status).
   */
  readonly rejected: number;

  /**
   * Number of items currently in-flight (dequeued but not yet acknowledged).
   * These items may be requeued if visibility timeout expires.
   */
  readonly inFlight: number;
}

// =============================================================================
// Queue Options
// =============================================================================

/**
 * Options for creating a new queue.
 *
 * @example
 * const options: QueueOptions = {
 *   maxSize: 10000,
 *   visibilityTimeout: 30,
 *   retryLimit: 3,
 *   deadLetterQueue: 'my-queue-dlq',
 *   priority: true
 * };
 */
export interface QueueOptions {
  /**
   * Maximum queue depth. Enqueue operations will fail if this limit is reached.
   * Defaults to unlimited (Number.MAX_SAFE_INTEGER).
   */
  readonly maxSize?: number;

  /**
   * Visibility timeout in seconds. After dequeue, the item becomes invisible
   * to other consumers for this duration. If not acknowledged within this time,
   * the item is automatically requeued.
   * Defaults to 30 seconds.
   */
  readonly visibilityTimeout?: number;

  /**
   * Maximum number of delivery attempts before moving to dead letter queue.
   * Defaults to 3.
   */
  readonly retryLimit?: number;

  /**
   * Name of the dead letter queue for failed messages.
   * If not specified, failed messages after retryLimit are dropped.
   */
  readonly deadLetterQueue?: string;

  /**
   * Enable priority ordering. When true, items with lower source ID values
   * are dequeued first (using Link's source as priority indicator).
   * Defaults to false (FIFO ordering).
   */
  readonly priority?: boolean;
}

// =============================================================================
// Queue Interface
// =============================================================================

/**
 * Interface for queue operations.
 *
 * A Queue provides standard message queue operations built on top of the
 * Link data model. Each queue item is represented as a Link.
 *
 * The design follows the message queue patterns established by systems like
 * RabbitMQ and SQS, adapted for the link-based data model.
 *
 * @example
 * // Basic usage
 * const result = await queue.enqueue(myLink);
 * const item = await queue.dequeue();
 * if (item) {
 *   try {
 *     await processItem(item);
 *     await queue.acknowledge(result.id);
 *   } catch (error) {
 *     await queue.reject(result.id, true); // requeue
 *   }
 * }
 */
export interface Queue {
  /**
   * The name of this queue.
   */
  readonly name: string;

  // ---------------------------------------------------------------------------
  // Core Operations
  // ---------------------------------------------------------------------------

  /**
   * Adds a link to the queue.
   *
   * The link is added to the end of the queue (or according to priority
   * if priority ordering is enabled).
   *
   * @param link - The link to enqueue
   * @returns Promise resolving to the enqueue result with ID and position
   * @throws Error if the queue is at max capacity
   *
   * @example
   * const link = createLink(1, 'task', 'process-data');
   * const result = await queue.enqueue(link);
   * console.log(`Item ${result.id} enqueued at position ${result.position}`);
   */
  enqueue(link: Link): Promise<EnqueueResult>;

  /**
   * Removes and returns the next link from the queue.
   *
   * The item becomes invisible to other consumers for the visibility timeout
   * duration. It must be acknowledged or rejected before the timeout expires,
   * otherwise it will be automatically requeued.
   *
   * @returns Promise resolving to the next Link, or null if queue is empty
   *
   * @example
   * const item = await queue.dequeue();
   * if (item) {
   *   await processItem(item);
   *   await queue.acknowledge(item.id);
   * }
   */
  dequeue(): Promise<Link | null>;

  /**
   * Returns the next link without removing it from the queue.
   *
   * Unlike dequeue, this does not affect visibility timeout or delivery count.
   *
   * @returns Promise resolving to the next Link, or null if queue is empty
   *
   * @example
   * const nextItem = await queue.peek();
   * if (nextItem) {
   *   console.log(`Next item: ${nextItem.id}`);
   * }
   */
  peek(): Promise<Link | null>;

  /**
   * Acknowledges successful processing of a dequeued item.
   *
   * The item is permanently removed from the queue. This should be called
   * after successfully processing a dequeued item.
   *
   * @param id - The ID of the item to acknowledge (from EnqueueResult or Link.id)
   * @throws Error if the ID is not found or item is not in-flight
   *
   * @example
   * const item = await queue.dequeue();
   * if (item) {
   *   await processItem(item);
   *   await queue.acknowledge(item.id);
   * }
   */
  acknowledge(id: LinkId): Promise<void>;

  /**
   * Rejects a dequeued item, optionally requeuing it.
   *
   * If requeue is true, the item is placed back in the queue for redelivery.
   * The delivery count is incremented. If the delivery count exceeds retryLimit,
   * the item is moved to the dead letter queue (if configured) or dropped.
   *
   * If requeue is false, the item is permanently removed.
   *
   * @param id - The ID of the item to reject
   * @param requeue - Whether to requeue the item for redelivery (default: false)
   * @throws Error if the ID is not found or item is not in-flight
   *
   * @example
   * const item = await queue.dequeue();
   * if (item) {
   *   try {
   *     await processItem(item);
   *     await queue.acknowledge(item.id);
   *   } catch (error) {
   *     // Processing failed, requeue for retry
   *     await queue.reject(item.id, true);
   *   }
   * }
   */
  reject(id: LinkId, requeue?: boolean): Promise<void>;

  // ---------------------------------------------------------------------------
  // Status Operations
  // ---------------------------------------------------------------------------

  /**
   * Returns statistics for this queue.
   *
   * @returns Queue statistics including depth, throughput, and in-flight count
   *
   * @example
   * const stats = queue.getStats();
   * console.log(`Depth: ${stats.depth}, In-flight: ${stats.inFlight}`);
   */
  getStats(): QueueStats;

  /**
   * Returns the current queue depth (number of items waiting to be dequeued).
   *
   * This is a convenience method equivalent to `getStats().depth`.
   *
   * @returns The number of items in the queue
   *
   * @example
   * if (queue.getDepth() > 1000) {
   *   console.warn('Queue is backing up!');
   * }
   */
  getDepth(): number;
}

// =============================================================================
// Queue Info
// =============================================================================

/**
 * Information about a queue returned by listQueues().
 *
 * @example
 * const queues = await manager.listQueues();
 * for (const info of queues) {
 *   console.log(`Queue ${info.name}: ${info.depth} items`);
 * }
 */
export interface QueueInfo {
  /**
   * The name of the queue.
   */
  readonly name: string;

  /**
   * Current queue depth.
   */
  readonly depth: number;

  /**
   * Timestamp when the queue was created (milliseconds since epoch).
   */
  readonly createdAt: number;

  /**
   * The options the queue was created with.
   */
  readonly options: QueueOptions;
}

// =============================================================================
// QueueManager Interface
// =============================================================================

/**
 * Interface for queue management operations.
 *
 * QueueManager handles the lifecycle of queues - creating, deleting, and
 * retrieving queue instances. It acts as a registry for all queues in
 * the system.
 *
 * @example
 * // Create a queue manager
 * const manager = new MemoryQueueManager(linkStore);
 *
 * // Create a new queue
 * const queue = await manager.createQueue('tasks', {
 *   maxSize: 10000,
 *   visibilityTimeout: 30,
 *   retryLimit: 3,
 *   deadLetterQueue: 'tasks-dlq'
 * });
 *
 * // Use the queue
 * await queue.enqueue(myLink);
 *
 * // List all queues
 * const queues = await manager.listQueues();
 * console.log(`Total queues: ${queues.length}`);
 */
export interface QueueManager {
  /**
   * Creates a new named queue with the specified options.
   *
   * If a queue with the same name already exists, an error is thrown.
   *
   * @param name - Unique name for the queue
   * @param options - Optional queue configuration
   * @returns Promise resolving to the created Queue
   * @throws Error if a queue with this name already exists
   *
   * @example
   * const queue = await manager.createQueue('my-queue', {
   *   maxSize: 1000,
   *   visibilityTimeout: 60
   * });
   */
  createQueue(name: string, options?: QueueOptions): Promise<Queue>;

  /**
   * Deletes a queue and all its contents.
   *
   * Any in-flight items are lost. This operation is irreversible.
   *
   * @param name - Name of the queue to delete
   * @returns Promise resolving to true if queue was deleted, false if not found
   *
   * @example
   * const deleted = await manager.deleteQueue('old-queue');
   * if (deleted) {
   *   console.log('Queue deleted');
   * }
   */
  deleteQueue(name: string): Promise<boolean>;

  /**
   * Retrieves an existing queue by name.
   *
   * @param name - Name of the queue to retrieve
   * @returns Promise resolving to the Queue, or null if not found
   *
   * @example
   * const queue = await manager.getQueue('tasks');
   * if (queue) {
   *   const depth = queue.getDepth();
   *   console.log(`Queue has ${depth} items`);
   * }
   */
  getQueue(name: string): Promise<Queue | null>;

  /**
   * Lists all queues managed by this manager.
   *
   * @returns Promise resolving to array of QueueInfo for all queues
   *
   * @example
   * const queues = await manager.listQueues();
   * for (const info of queues) {
   *   console.log(`${info.name}: ${info.depth} items`);
   * }
   */
  listQueues(): Promise<QueueInfo[]>;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for queue operations.
 */
export type QueueErrorCode =
  | 'QUEUE_FULL'
  | 'QUEUE_NOT_FOUND'
  | 'QUEUE_ALREADY_EXISTS'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NOT_IN_FLIGHT'
  | 'INVALID_OPERATION';

/**
 * Error thrown by queue operations.
 *
 * @example
 * try {
 *   await queue.enqueue(link);
 * } catch (error) {
 *   if (error instanceof QueueError && error.code === 'QUEUE_FULL') {
 *     console.log('Queue is at capacity');
 *   }
 * }
 */
export class QueueError extends Error {
  /**
   * The error code identifying the type of error.
   */
  readonly code: QueueErrorCode;

  /**
   * Creates a new QueueError.
   *
   * @param code - Error code
   * @param message - Human-readable error message
   */
  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
  }
}

// =============================================================================
// Consumer Types (Future Extension)
// =============================================================================

/**
 * Handler function for processing queue items.
 *
 * @param item - The dequeued Link to process
 * @returns Promise that resolves when processing is complete
 *
 * @example
 * const handler: QueueHandler = async (item) => {
 *   console.log(`Processing item ${item.id}`);
 *   await processData(item);
 * };
 */
export type QueueHandler = (item: Link) => Promise<void>;

/**
 * Subscription to a queue for automatic message consumption.
 *
 * This interface represents an active subscription that automatically
 * dequeues and processes items. Supports REQ-API-020 through REQ-API-022.
 *
 * @example
 * const subscription = await queue.subscribe(async (item) => {
 *   await processItem(item);
 * });
 *
 * // Later, unsubscribe
 * await subscription.unsubscribe();
 */
export interface QueueSubscription {
  /**
   * Unique identifier for this subscription.
   */
  readonly id: string;

  /**
   * Stops the subscription and releases resources.
   *
   * Any in-flight items will complete processing before the subscription ends.
   *
   * @returns Promise that resolves when the subscription is fully stopped
   */
  unsubscribe(): Promise<void>;
}
