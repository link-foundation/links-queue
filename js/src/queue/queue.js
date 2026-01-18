/**
 * Queue implementation for links-queue.
 *
 * This module provides the LinksQueue class - a message queue built on top of
 * the LinkStore backend with FIFO ordering and at-least-once delivery guarantees.
 *
 * @module queue/queue
 *
 * @see ARCHITECTURE.md - Queue Manager component
 * @see REQUIREMENTS.md - REQ-API-001 through REQ-API-005, REQ-REL-001 through REQ-REL-013
 */

/* eslint-disable require-await */

import { QueueError } from './types.js';
import { DeliveryTracker } from './delivery.js';

/**
 * Default values for queue options.
 */
const DEFAULT_OPTIONS = {
  maxSize: Number.MAX_SAFE_INTEGER,
  visibilityTimeout: 30, // 30 seconds
  retryLimit: 3,
  deadLetterQueue: null,
  priority: false,
};

/**
 * LinksQueue - A message queue implementation using links as queue items.
 *
 * Provides standard message queue operations with FIFO ordering (or priority
 * ordering when enabled), visibility timeouts, and at-least-once delivery.
 *
 * @implements {import('./types.ts').Queue}
 *
 * @example
 * import { LinksQueue, MemoryLinkStore } from 'links-queue';
 *
 * const store = new MemoryLinkStore();
 * const queue = new LinksQueue({
 *   name: 'tasks',
 *   store,
 *   options: {
 *     visibilityTimeout: 30,
 *     retryLimit: 3,
 *     deadLetterQueue: 'tasks-dlq'
 *   }
 * });
 *
 * // Enqueue a link
 * const result = await queue.enqueue(myLink);
 *
 * // Dequeue and process
 * const item = await queue.dequeue();
 * if (item) {
 *   await processItem(item);
 *   await queue.acknowledge(item.id);
 * }
 */
export class LinksQueue {
  /**
   * Creates a new LinksQueue.
   *
   * @param {Object} config - Queue configuration
   * @param {string} config.name - Unique name for this queue
   * @param {import('../backends/memory.js').MemoryLinkStore} config.store - LinkStore backend
   * @param {import('./types.ts').QueueOptions} [config.options] - Queue options
   * @param {(link: import('../index.d.ts').Link) => Promise<void>} [config.onDeadLetter] - Dead letter callback
   */
  constructor(config) {
    const { name, store, options = {}, onDeadLetter } = config;

    /**
     * The name of this queue.
     * @type {string}
     */
    this.name = name;

    /**
     * The underlying LinkStore.
     * @type {import('../backends/memory.js').MemoryLinkStore}
     * @private
     */
    this._store = store;

    /**
     * Queue options with defaults applied.
     * @type {Required<import('./types.ts').QueueOptions>}
     * @private
     */
    this._options = {
      maxSize: options.maxSize ?? DEFAULT_OPTIONS.maxSize,
      visibilityTimeout:
        options.visibilityTimeout ?? DEFAULT_OPTIONS.visibilityTimeout,
      retryLimit: options.retryLimit ?? DEFAULT_OPTIONS.retryLimit,
      deadLetterQueue:
        options.deadLetterQueue ?? DEFAULT_OPTIONS.deadLetterQueue,
      priority: options.priority ?? DEFAULT_OPTIONS.priority,
    };

    /**
     * Queue items in order (FIFO).
     * @type {Array<{id: import('../index.d.ts').LinkId, link: import('../index.d.ts').Link, enqueuedAt: number}>}
     * @private
     */
    this._items = [];

    /**
     * Set of item IDs for quick lookup.
     * @type {Set<import('../index.d.ts').LinkId>}
     * @private
     */
    this._itemIds = new Set();

    /**
     * Dead letter callback.
     * @type {(link: import('../index.d.ts').Link) => Promise<void>}
     * @private
     */
    this._onDeadLetter = onDeadLetter ?? (async () => {});

    /**
     * Statistics counters.
     * @type {{enqueued: number, dequeued: number, acknowledged: number, rejected: number}}
     * @private
     */
    this._stats = {
      enqueued: 0,
      dequeued: 0,
      acknowledged: 0,
      rejected: 0,
    };

    /**
     * Delivery tracker for in-flight items.
     * @type {DeliveryTracker}
     * @private
     */
    this._deliveryTracker = new DeliveryTracker({
      visibilityTimeout: this._options.visibilityTimeout * 1000, // Convert to ms
      retryLimit: this._options.retryLimit,
      onTimeout: async (item) => {
        // Requeue the item at the front of the queue
        this._requeueItem(item.link);
      },
      onDeadLetter: async (item) => {
        // Move to dead letter queue or invoke callback
        await this._handleDeadLetter(item.link);
        this._deliveryTracker.clearDeliveryCount(item.link.id);
      },
    });

    /**
     * Timestamp when queue was created.
     * @type {number}
     * @private
     */
    this._createdAt = Date.now();
  }

  /**
   * Gets the queue options.
   *
   * @returns {Readonly<import('./types.ts').QueueOptions>} Queue options
   */
  get options() {
    return this._options;
  }

  /**
   * Gets the timestamp when the queue was created.
   *
   * @returns {number} Creation timestamp (ms since epoch)
   */
  get createdAt() {
    return this._createdAt;
  }

  /**
   * Adds a link to the queue.
   *
   * @param {import('../index.d.ts').Link} link - The link to enqueue
   * @returns {Promise<import('./types.ts').EnqueueResult>} Enqueue result with ID and position
   * @throws {QueueError} If queue is at max capacity (QUEUE_FULL)
   */
  async enqueue(link) {
    // Check capacity
    if (this._items.length >= this._options.maxSize) {
      throw new QueueError(
        'QUEUE_FULL',
        `Queue '${this.name}' is at capacity (${this._options.maxSize})`
      );
    }

    const id = link.id;
    const enqueuedAt = Date.now();

    // Store in the LinkStore for persistence
    // (In a real implementation, we'd save metadata as links too)

    const queueItem = { id, link, enqueuedAt };

    if (this._options.priority) {
      // Priority queue: insert in sorted order by source (lower = higher priority)
      let insertIndex = this._items.length;
      for (let i = 0; i < this._items.length; i++) {
        if (this._comparePriority(link, this._items[i].link) < 0) {
          insertIndex = i;
          break;
        }
      }
      this._items.splice(insertIndex, 0, queueItem);
    } else {
      // FIFO: add to end
      this._items.push(queueItem);
    }

    this._itemIds.add(id);
    this._stats.enqueued++;

    // Calculate position (items ahead in queue)
    const position = this._items.findIndex((item) => item.id === id);

    return { id, position };
  }

  /**
   * Removes and returns the next link from the queue.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>} The next link, or null if empty
   */
  async dequeue() {
    if (this._items.length === 0) {
      return null;
    }

    // Get the first item
    const queueItem = this._items.shift();
    this._itemIds.delete(queueItem.id);
    this._stats.dequeued++;

    // Track for delivery
    this._deliveryTracker.track(queueItem.id, queueItem.link);

    return queueItem.link;
  }

  /**
   * Returns the next link without removing it.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>} The next link, or null if empty
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
   * @param {import('../index.d.ts').LinkId} id - The ID of the item to acknowledge
   * @throws {QueueError} If item is not in-flight (ITEM_NOT_IN_FLIGHT)
   */
  async acknowledge(id) {
    const item = this._deliveryTracker.acknowledge(id);
    if (!item) {
      throw new QueueError(
        'ITEM_NOT_IN_FLIGHT',
        `Item '${id}' is not in-flight or does not exist`
      );
    }

    this._stats.acknowledged++;
  }

  /**
   * Rejects a dequeued item, optionally requeuing it.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the item to reject
   * @param {boolean} [requeue=false] - Whether to requeue the item
   * @throws {QueueError} If item is not in-flight (ITEM_NOT_IN_FLIGHT)
   */
  async reject(id, requeue = false) {
    const item = this._deliveryTracker.reject(id, requeue);
    if (!item) {
      throw new QueueError(
        'ITEM_NOT_IN_FLIGHT',
        `Item '${id}' is not in-flight or does not exist`
      );
    }

    this._stats.rejected++;

    if (requeue) {
      // Check if retry limit exceeded
      if (item.deliveryCount >= this._options.retryLimit) {
        await this._handleDeadLetter(item.link);
        this._deliveryTracker.clearDeliveryCount(id);
      } else {
        // Requeue at end of queue
        this._requeueItem(item.link);
      }
    }
  }

  /**
   * Returns statistics for this queue.
   *
   * @returns {import('./types.ts').QueueStats} Queue statistics
   */
  getStats() {
    return {
      depth: this._items.length,
      enqueued: this._stats.enqueued,
      dequeued: this._stats.dequeued,
      acknowledged: this._stats.acknowledged,
      rejected: this._stats.rejected,
      inFlight: this._deliveryTracker.inFlightCount,
    };
  }

  /**
   * Returns the current queue depth.
   *
   * @returns {number} Number of items in the queue
   */
  getDepth() {
    return this._items.length;
  }

  /**
   * Clears all items from the queue and resets statistics.
   *
   * @returns {Promise<void>}
   */
  async clear() {
    this._items = [];
    this._itemIds.clear();
    this._deliveryTracker.clear();
    this._stats = {
      enqueued: 0,
      dequeued: 0,
      acknowledged: 0,
      rejected: 0,
    };
  }

  /**
   * Requeues an item at the front of the queue (for retries).
   *
   * @param {import('../index.d.ts').Link} link - The link to requeue
   * @private
   */
  _requeueItem(link) {
    // Add to front of queue for immediate retry
    const queueItem = { id: link.id, link, enqueuedAt: Date.now() };
    this._items.unshift(queueItem);
    this._itemIds.add(link.id);
  }

  /**
   * Handles moving an item to the dead letter queue.
   *
   * @param {import('../index.d.ts').Link} link - The link to dead letter
   * @private
   */
  async _handleDeadLetter(link) {
    await this._onDeadLetter(link);
  }

  /**
   * Compares priority between two links.
   * Lower source values = higher priority.
   *
   * @param {import('../index.d.ts').Link} a - First link
   * @param {import('../index.d.ts').Link} b - Second link
   * @returns {number} Negative if a has higher priority, positive if b does
   * @private
   */
  _comparePriority(a, b) {
    // Use source as priority indicator
    // Handle different types by converting to string for comparison
    const aSource = String(a.source);
    const bSource = String(b.source);

    // Try numeric comparison first
    const aNum = Number(a.source);
    const bNum = Number(b.source);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }

    // Fall back to string comparison
    return aSource.localeCompare(bSource);
  }
}
