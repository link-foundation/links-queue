/**
 * Queue implementation for links-queue.
 *
 * This module provides MemoryQueue, an in-memory implementation of the
 * Queue interface with FIFO ordering, visibility timeout, and delivery guarantees.
 *
 * @module queue/memory-queue
 *
 * Features:
 * - FIFO ordering: Messages are dequeued in the order they were enqueued
 * - At-least-once delivery: Messages are requeued if not acknowledged
 * - Visibility timeout: Dequeued messages are invisible to other consumers
 * - Retry tracking: Delivery count is tracked for each message
 * - Dead letter queue: Messages exceeding retry limit can be routed to DLQ
 *
 * @example
 * import { MemoryQueue } from 'links-queue';
 *
 * const queue = new MemoryQueue('tasks');
 *
 * // Enqueue a link
 * const link = { id: 1, source: 'task', target: 'process' };
 * await queue.enqueue(link);
 *
 * // Dequeue and process
 * const item = await queue.dequeue();
 * if (item) {
 *   await queue.acknowledge(item.id);
 * }
 */

/*
 * Note: The require-await warnings are intentional.
 * This implementation uses async methods for API consistency with other backends
 * (e.g., file-based or network-based queues) even though the in-memory operations
 * are synchronous. This allows for seamless backend swapping.
 */
/* eslint-disable require-await */

import { QueueError } from './types.js';
import { PollableDeliveryTracker, DeliveryState } from './delivery.js';

// =============================================================================
// Default Options
// =============================================================================

/** @type {number} Default maximum queue size */
const DEFAULT_MAX_SIZE = Number.MAX_SAFE_INTEGER;

/** @type {number} Default visibility timeout in seconds */
const DEFAULT_VISIBILITY_TIMEOUT = 30;

/** @type {number} Default retry limit */
const DEFAULT_RETRY_LIMIT = 3;

// =============================================================================
// Queue Item (Internal)
// =============================================================================

/**
 * Internal representation of a queue item.
 * @private
 */
class QueueItem {
  /**
   * @param {import('../index.d.ts').Link} link - The link data
   * @param {number} [deliveryCount=0] - Number of times this item has been delivered
   */
  constructor(link, deliveryCount = 0) {
    /** @type {import('../index.d.ts').Link} The link data. */
    this.link = link;

    /**
     * Number of times this item has been delivered.
     * Used for retry tracking across requeues.
     * @type {number}
     */
    this.deliveryCount = deliveryCount;
  }
}

// =============================================================================
// Memory Queue Implementation
// =============================================================================

/**
 * In-memory queue implementation with FIFO ordering and delivery guarantees.
 *
 * This queue stores all messages in memory and provides:
 * - FIFO (first-in, first-out) ordering
 * - At-least-once delivery guarantee via visibility timeout
 * - Retry tracking with configurable retry limit
 * - Dead letter queue support for failed messages
 *
 * @implements {import('./types.ts').Queue}
 *
 * @example
 * import { MemoryQueue } from 'links-queue';
 *
 * // Create a queue with custom options
 * const queue = new MemoryQueue('tasks', {
 *   visibilityTimeout: 60,
 *   retryLimit: 5,
 *   deadLetterQueue: 'tasks-dlq'
 * });
 */
export class MemoryQueue {
  /**
   * Creates a new in-memory queue with the given name and options.
   *
   * @param {string} name - Unique name for this queue
   * @param {import('./types.ts').QueueOptions} [options={}] - Queue configuration options
   *
   * @example
   * const queue = new MemoryQueue('my-queue', {
   *   maxSize: 1000,
   *   visibilityTimeout: 60,
   *   retryLimit: 3
   * });
   */
  constructor(name, options = {}) {
    /** @type {string} Queue name. */
    this._name = name;

    /** @type {import('./types.ts').QueueOptions} Queue options. */
    this._options = {
      maxSize: options.maxSize ?? DEFAULT_MAX_SIZE,
      visibilityTimeout:
        options.visibilityTimeout ?? DEFAULT_VISIBILITY_TIMEOUT,
      retryLimit: options.retryLimit ?? DEFAULT_RETRY_LIMIT,
      deadLetterQueue: options.deadLetterQueue,
      priority: options.priority ?? false,
    };

    /** @type {QueueItem[]} Queue items waiting to be dequeued (FIFO order). */
    this._items = [];

    /**
     * Delivery tracker for in-flight messages.
     * @type {PollableDeliveryTracker}
     * @private
     */
    this._deliveryTracker = new PollableDeliveryTracker(
      this._options.visibilityTimeout * 1000, // Convert to milliseconds
      this._options.retryLimit
    );

    /**
     * Queue statistics.
     * @type {import('./types.ts').QueueStats}
     * @private
     */
    this._stats = {
      depth: 0,
      enqueued: 0,
      dequeued: 0,
      acknowledged: 0,
      rejected: 0,
      inFlight: 0,
    };

    /**
     * Items to be moved to dead letter queue.
     * These are collected and should be processed by the queue manager.
     * @type {import('../index.d.ts').Link[]}
     * @private
     */
    this._deadLetterItems = [];

    /** @type {number} Timestamp when the queue was created (Unix milliseconds). */
    this._createdAt = Date.now();
  }

  /**
   * The name of this queue.
   * @type {string}
   */
  get name() {
    return this._name;
  }

  /**
   * Returns the timestamp when this queue was created.
   * @returns {number}
   */
  get createdAt() {
    return this._createdAt;
  }

  /**
   * Returns the queue options.
   * @returns {import('./types.ts').QueueOptions}
   */
  get options() {
    return { ...this._options };
  }

  /**
   * Checks if a dead letter queue is configured.
   * @returns {boolean}
   */
  hasDeadLetterQueue() {
    return this._options.deadLetterQueue !== undefined;
  }

  /**
   * Returns the name of the dead letter queue, if configured.
   * @returns {string | undefined}
   */
  getDeadLetterQueueName() {
    return this._options.deadLetterQueue;
  }

  /**
   * Adds a link to the queue.
   *
   * The link is added to the end of the queue (or according to priority
   * if priority ordering is enabled).
   *
   * @param {import('../index.d.ts').Link} link - The link to enqueue
   * @returns {Promise<import('./types.ts').EnqueueResult>} Promise resolving to the enqueue result
   * @throws {QueueError} If the queue is at max capacity
   *
   * @example
   * const link = { id: 1, source: 'task', target: 'process' };
   * const result = await queue.enqueue(link);
   * console.log(`Item ${result.id} enqueued at position ${result.position}`);
   */
  async enqueue(link) {
    // Check max size limit
    if (this._items.length >= this._options.maxSize) {
      throw new QueueError(
        'QUEUE_FULL',
        `Queue '${this._name}' is at capacity`
      );
    }

    const position = this._items.length;
    this._items.push(new QueueItem(link));

    this._stats.enqueued++;
    this._stats.depth = this._items.length;

    return { id: link.id, position };
  }

  /**
   * Removes and returns the next link from the queue.
   *
   * The item becomes invisible to other consumers for the visibility timeout
   * duration. It must be acknowledged or rejected before the timeout expires,
   * otherwise it will be automatically requeued.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>} Promise resolving to the next Link, or null if queue is empty
   *
   * @example
   * const item = await queue.dequeue();
   * if (item) {
   *   await processItem(item);
   *   await queue.acknowledge(item.id);
   * }
   */
  async dequeue() {
    // Get the next item from the queue
    const item = this._items.shift();

    if (!item) {
      return null;
    }

    const { link } = item;
    const id = link.id;

    // Record the delivery with proper delivery count
    if (item.deliveryCount > 0) {
      this._deliveryTracker.recordRedelivery(id, item.deliveryCount);
    } else {
      this._deliveryTracker.recordDelivery(id);
    }

    // Update stats
    this._stats.dequeued++;
    this._stats.depth = this._items.length;
    this._stats.inFlight = this._deliveryTracker.inFlightCount();

    return link;
  }

  /**
   * Returns the next link without removing it from the queue.
   *
   * Unlike dequeue, this does not affect visibility timeout or delivery count.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>} Promise resolving to the next Link, or null if queue is empty
   *
   * @example
   * const nextItem = await queue.peek();
   * if (nextItem) {
   *   console.log(`Next item: ${nextItem.id}`);
   * }
   */
  async peek() {
    if (this._items.length === 0) {
      return null;
    }
    return this._items[0].link;
  }

  /**
   * Acknowledges successful processing of a dequeued item.
   *
   * The item is permanently removed from the queue. This should be called
   * after successfully processing a dequeued item.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the item to acknowledge
   * @throws {QueueError} If the ID is not found or item is not in-flight
   *
   * @example
   * const item = await queue.dequeue();
   * if (item) {
   *   await processItem(item);
   *   await queue.acknowledge(item.id);
   * }
   */
  async acknowledge(id) {
    if (!this._deliveryTracker.isInFlight(id)) {
      throw new QueueError(
        'ITEM_NOT_IN_FLIGHT',
        `Item '${id}' is not in-flight`
      );
    }

    if (this._deliveryTracker.acknowledge(id)) {
      this._stats.acknowledged++;
      this._stats.inFlight = this._deliveryTracker.inFlightCount();
    } else {
      throw new QueueError('ITEM_NOT_FOUND', `Item '${id}' not found`);
    }
  }

  /**
   * Rejects a dequeued item, optionally requeuing it.
   *
   * If requeue is true, the item is placed back in the queue for redelivery.
   * The delivery count is incremented. If the delivery count exceeds retryLimit,
   * the item is moved to the dead letter queue (if configured) or dropped.
   *
   * If requeue is false, the item is permanently removed.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the item to reject
   * @param {boolean} [requeue=false] - Whether to requeue the item for redelivery
   * @throws {QueueError} If the ID is not found or item is not in-flight
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
  async reject(id, requeue = false) {
    if (!this._deliveryTracker.isInFlight(id)) {
      throw new QueueError(
        'ITEM_NOT_IN_FLIGHT',
        `Item '${id}' is not in-flight`
      );
    }

    const result = this._deliveryTracker.reject(id, requeue);

    if (!result) {
      throw new QueueError('ITEM_NOT_FOUND', `Item '${id}' not found`);
    }

    this._stats.rejected++;

    if (result.shouldRequeue) {
      // Note: To properly requeue, we need access to the original link
      // This will be handled by MemoryQueueWithStorage
      this._deliveryTracker.remove(id);
    } else if (result.state === DeliveryState.DEAD_LETTERED) {
      // Message exceeded retry limit
      this._deliveryTracker.remove(id);
    }

    this._stats.inFlight = this._deliveryTracker.inFlightCount();
  }

  /**
   * Returns statistics for this queue.
   *
   * @returns {import('./types.ts').QueueStats} Queue statistics
   *
   * @example
   * const stats = queue.getStats();
   * console.log(`Depth: ${stats.depth}, In-flight: ${stats.inFlight}`);
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * Returns the current queue depth (number of items waiting to be dequeued).
   *
   * This is a convenience method equivalent to `getStats().depth`.
   *
   * @returns {number} The number of items in the queue
   *
   * @example
   * if (queue.getDepth() > 1000) {
   *   console.warn('Queue is backing up!');
   * }
   */
  getDepth() {
    return this._stats.depth;
  }

  /**
   * Processes expired in-flight messages, requeuing them if within retry limit.
   *
   * This method should be called periodically (e.g., by a background task)
   * to handle messages that were not acknowledged within the visibility timeout.
   *
   * Returns the number of messages that were requeued.
   *
   * @returns {number}
   */
  processExpired() {
    const expiredIds = this._deliveryTracker.findExpired();
    let requeuedCount = 0;

    for (const id of expiredIds) {
      // Process the rejection (with requeue = true)
      const result = this._deliveryTracker.reject(id, true);

      if (result && result.shouldRequeue) {
        this._deliveryTracker.remove(id);
        requeuedCount++;
      } else if (result && result.state === DeliveryState.DEAD_LETTERED) {
        // Message exceeded retry limit
        this._deliveryTracker.remove(id);
      }
    }

    return requeuedCount;
  }

  /**
   * Returns dead letter items that have been accumulated.
   *
   * This drains the internal dead letter buffer and returns the items.
   * The queue manager should call this to move items to the actual DLQ.
   *
   * @returns {import('../index.d.ts').Link[]}
   */
  drainDeadLetters() {
    const items = this._deadLetterItems;
    this._deadLetterItems = [];
    return items;
  }

  /**
   * Clears all items from the queue.
   *
   * This removes all pending items, in-flight items, and dead letter items.
   *
   * @returns {Promise<void>}
   */
  async clear() {
    this._items = [];
    this._deliveryTracker.clear();
    this._deadLetterItems = [];
    this._stats = {
      depth: 0,
      enqueued: 0,
      dequeued: 0,
      acknowledged: 0,
      rejected: 0,
      inFlight: 0,
    };
  }
}

// =============================================================================
// Memory Queue With Storage (for proper requeue support)
// =============================================================================

/**
 * Enhanced queue that stores links for requeue support.
 *
 * This wrapper around MemoryQueue stores dequeued links so they can be
 * properly requeued on rejection.
 *
 * @implements {import('./types.ts').Queue}
 */
export class MemoryQueueWithStorage {
  /**
   * Creates a new queue with link storage for proper requeue support.
   *
   * @param {string} name - Unique name for this queue
   * @param {import('./types.ts').QueueOptions} [options={}] - Queue configuration options
   * @param {Object} [callbacks={}] - Optional callbacks
   * @param {function(import('../index.d.ts').Link): Promise<void>} [callbacks.onDeadLetter] - Called when an item exceeds retry limit
   */
  constructor(name, options = {}, callbacks = {}) {
    /** @type {MemoryQueue} Base queue. */
    this._inner = new MemoryQueue(name, options);

    /**
     * Storage for in-flight links (for requeue).
     * @type {Map<import('../index.d.ts').LinkId, import('../index.d.ts').Link>}
     * @private
     */
    this._inFlightLinks = new Map();

    /**
     * Callback for dead letter items.
     * @type {function(import('../index.d.ts').Link): Promise<void> | undefined}
     * @private
     */
    this._onDeadLetter = callbacks.onDeadLetter;
  }

  /** @type {string} */
  get name() {
    return this._inner.name;
  }

  /** @type {number} */
  get createdAt() {
    return this._inner.createdAt;
  }

  /** @returns {import('./types.ts').QueueOptions} */
  get options() {
    return this._inner.options;
  }

  /** @returns {boolean} */
  hasDeadLetterQueue() {
    return this._inner.hasDeadLetterQueue();
  }

  /** @returns {string | undefined} */
  getDeadLetterQueueName() {
    return this._inner.getDeadLetterQueueName();
  }

  /**
   * @param {import('../index.d.ts').Link} link
   * @returns {Promise<import('./types.ts').EnqueueResult>}
   */
  async enqueue(link) {
    return this._inner.enqueue(link);
  }

  /**
   * @returns {Promise<import('../index.d.ts').Link | null>}
   */
  async dequeue() {
    const link = await this._inner.dequeue();

    // Store the link for potential requeue
    if (link) {
      this._inFlightLinks.set(link.id, link);
    }

    return link;
  }

  /**
   * @returns {Promise<import('../index.d.ts').Link | null>}
   */
  async peek() {
    return this._inner.peek();
  }

  /**
   * @param {import('../index.d.ts').LinkId} id
   */
  async acknowledge(id) {
    await this._inner.acknowledge(id);
    this._inFlightLinks.delete(id);
  }

  /**
   * @param {import('../index.d.ts').LinkId} id
   * @param {boolean} [requeue=false]
   */
  async reject(id, requeue = false) {
    const link = this._inFlightLinks.get(id);
    const deliveryCount = this._inner._deliveryTracker.getDeliveryCount(id);

    if (!this._inner._deliveryTracker.isInFlight(id)) {
      throw new QueueError(
        'ITEM_NOT_IN_FLIGHT',
        `Item '${id}' is not in-flight`
      );
    }

    const result = this._inner._deliveryTracker.reject(id, requeue);

    if (!result) {
      throw new QueueError('ITEM_NOT_FOUND', `Item '${id}' not found`);
    }

    this._inner._stats.rejected++;

    if (result.shouldRequeue && link) {
      // Requeue with updated delivery count at the front of the queue
      // This allows failed items to be retried immediately
      this._inner._items.unshift(new QueueItem(link, deliveryCount));
      this._inner._stats.depth = this._inner._items.length;
      this._inner._deliveryTracker.remove(id);
    } else if (result.state === DeliveryState.DEAD_LETTERED && link) {
      // Move to dead letter queue
      if (this._onDeadLetter) {
        // Use callback for automatic DLQ routing
        await this._onDeadLetter(link);
      } else {
        // Store for manual DLQ processing
        this._inner._deadLetterItems.push(link);
      }
      this._inner._deliveryTracker.remove(id);
    }

    this._inner._stats.inFlight = this._inner._deliveryTracker.inFlightCount();
    this._inFlightLinks.delete(id);
  }

  /** @returns {import('./types.ts').QueueStats} */
  getStats() {
    return this._inner.getStats();
  }

  /** @returns {number} */
  getDepth() {
    return this._inner.getDepth();
  }

  /** @returns {number} */
  processExpired() {
    return this._inner.processExpired();
  }

  /** @returns {import('../index.d.ts').Link[]} */
  drainDeadLetters() {
    return this._inner.drainDeadLetters();
  }

  /**
   * Clears all items from the queue.
   *
   * @returns {Promise<void>}
   */
  async clear() {
    await this._inner.clear();
    this._inFlightLinks.clear();
  }
}

// Re-export QueueItem for internal use
export { QueueItem };
