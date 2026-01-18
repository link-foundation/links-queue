/**
 * Queue manager implementations for links-queue.
 *
 * This module provides two queue manager implementations:
 *
 * 1. MemoryQueueManager - Lightweight manager for MemoryQueueWithStorage
 *    - No external dependencies
 *    - Uses poll-based visibility timeout handling
 *    - Good for simple use cases and testing
 *
 * 2. LinksQueueManager - Full-featured manager for LinksQueue
 *    - Requires a LinkStore backend for persistence
 *    - Uses timer-based visibility timeout handling
 *    - Supports automatic dead letter queue routing
 *    - Good for production use cases
 *
 * @module queue/manager
 *
 * @see ARCHITECTURE.md - Queue Manager component
 * @see REQUIREMENTS.md - REQ-API-010 through REQ-API-013
 */

/*
 * Note: The require-await warnings are intentional.
 * This implementation uses async methods for API consistency with other backends
 * (e.g., file-based or network-based managers) even though the in-memory operations
 * are synchronous. This allows for seamless backend swapping.
 */
/* eslint-disable require-await */

import { QueueError } from './types.js';
import { LinksQueue } from './queue.js';
import { MemoryQueueWithStorage } from './memory-queue.js';

// =============================================================================
// Queue Entry (Internal - for MemoryQueueManager)
// =============================================================================

/**
 * Internal entry for a managed queue.
 * @private
 */
class QueueEntry {
  /**
   * @param {MemoryQueueWithStorage} queue - The queue instance
   * @param {import('./types.ts').QueueOptions} options - Options the queue was created with
   */
  constructor(queue, options) {
    /** @type {MemoryQueueWithStorage} The queue instance. */
    this.queue = queue;

    /** @type {import('./types.ts').QueueOptions} Options the queue was created with. */
    this.options = options;
  }
}

// =============================================================================
// Memory Queue Manager (Lightweight, poll-based)
// =============================================================================

/**
 * In-memory queue manager that creates and manages MemoryQueueWithStorage instances.
 *
 * This manager maintains a registry of queues and provides CRUD operations
 * for queue lifecycle management. It uses poll-based visibility timeout
 * handling via the processAllExpired() method.
 *
 * @implements {import('./types.ts').QueueManager}
 *
 * @example
 * import { MemoryQueueManager } from 'links-queue';
 *
 * const manager = new MemoryQueueManager();
 *
 * // Create a queue
 * const queue = await manager.createQueue('my-queue', { maxSize: 1000 });
 *
 * // Use the queue
 * console.log(`Queue depth: ${queue.getDepth()}`);
 *
 * // List all queues
 * const queues = await manager.listQueues();
 * console.log(`Total queues: ${queues.length}`);
 */
export class MemoryQueueManager {
  /**
   * Creates a new, empty queue manager.
   *
   * @param {Object} [config] - Optional configuration (accepted for API compatibility)
   * @param {Object} [config.store] - Optional store (ignored, for API compatibility with LinksQueueManager)
   *
   * @example
   * const manager = new MemoryQueueManager();
   * // Or with config for API compatibility:
   * const manager = new MemoryQueueManager({ store: someStore });
   */
  constructor(config = {}) {
    // Note: store is accepted for API compatibility but not used
    // MemoryQueueManager creates its own internal storage
    void config;

    /**
     * Registry of managed queues.
     * @type {Map<string, QueueEntry>}
     * @private
     */
    this._queues = new Map();

    /**
     * Counter for dead letter items moved via automatic callback.
     * Reset when processDeadLetters is called.
     * @type {number}
     * @private
     */
    this._autoDeadLetterCount = 0;
  }

  /**
   * Returns the number of managed queues.
   *
   * @returns {number}
   */
  queueCount() {
    return this._queues.size;
  }

  /**
   * Gets the total number of queues (alias for queueCount for API compatibility).
   *
   * @returns {number} Number of queues
   */
  getQueueCount() {
    return this._queues.size;
  }

  /**
   * Checks if a queue with the given name exists.
   *
   * @param {string} name - The queue name to check
   * @returns {boolean}
   */
  hasQueue(name) {
    return this._queues.has(name);
  }

  /**
   * Creates a new named queue with the specified options.
   *
   * If a queue with the same name already exists, an error is thrown.
   *
   * @param {string} name - Unique name for the queue
   * @param {import('./types.ts').QueueOptions} [options={}] - Optional queue configuration
   * @returns {Promise<MemoryQueueWithStorage>} Promise resolving to the created Queue
   * @throws {QueueError} If a queue with this name already exists
   *
   * @example
   * const queue = await manager.createQueue('my-queue', {
   *   maxSize: 1000,
   *   visibilityTimeout: 60
   * });
   */
  async createQueue(name, options = {}) {
    // Check if queue already exists
    if (this._queues.has(name)) {
      throw new QueueError(
        'QUEUE_ALREADY_EXISTS',
        `Queue '${name}' already exists`
      );
    }

    // Create dead letter callback if DLQ is configured
    const callbacks = {};
    if (options.deadLetterQueue) {
      callbacks.onDeadLetter = async (link) => {
        const dlq = await this.getQueue(options.deadLetterQueue);
        if (dlq) {
          await dlq.enqueue(link);
          this._autoDeadLetterCount++;
        }
        // If DLQ doesn't exist, item is dropped
      };
    }

    // Create the queue
    const queue = new MemoryQueueWithStorage(name, options, callbacks);

    // Store the entry
    const entry = new QueueEntry(queue, { ...options });
    this._queues.set(name, entry);

    return queue;
  }

  /**
   * Deletes a queue and all its contents.
   *
   * Any in-flight items are lost. This operation is irreversible.
   *
   * @param {string} name - Name of the queue to delete
   * @returns {Promise<boolean>} Promise resolving to true if queue was deleted, false if not found
   *
   * @example
   * const deleted = await manager.deleteQueue('old-queue');
   * if (deleted) {
   *   console.log('Queue deleted');
   * }
   */
  async deleteQueue(name) {
    return this._queues.delete(name);
  }

  /**
   * Retrieves an existing queue by name.
   *
   * @param {string} name - Name of the queue to retrieve
   * @returns {Promise<MemoryQueueWithStorage | null>} Promise resolving to the Queue, or null if not found
   *
   * @example
   * const queue = await manager.getQueue('tasks');
   * if (queue) {
   *   const depth = queue.getDepth();
   *   console.log(`Queue has ${depth} items`);
   * }
   */
  async getQueue(name) {
    const entry = this._queues.get(name);
    return entry ? entry.queue : null;
  }

  /**
   * Lists all queues managed by this manager.
   *
   * @returns {Promise<import('./types.ts').QueueInfo[]>} Promise resolving to array of QueueInfo for all queues
   *
   * @example
   * const queues = await manager.listQueues();
   * for (const info of queues) {
   *   console.log(`${info.name}: ${info.depth} items`);
   * }
   */
  async listQueues() {
    const infos = [];

    for (const [name, entry] of this._queues) {
      const stats = entry.queue.getStats();
      infos.push({
        name,
        depth: stats.depth,
        createdAt: entry.queue.createdAt,
        options: { ...entry.options },
      });
    }

    return infos;
  }

  /**
   * Processes expired messages in all queues.
   *
   * This method should be called periodically to handle visibility timeouts.
   * Returns a map of queue names to the number of messages requeued.
   *
   * @returns {Map<string, number>}
   */
  processAllExpired() {
    const results = new Map();

    for (const [name, entry] of this._queues) {
      const count = entry.queue.processExpired();
      if (count > 0) {
        results.set(name, count);
      }
    }

    return results;
  }

  /**
   * Clears all queues and removes them from the manager.
   *
   * @returns {Promise<void>}
   */
  async clearAll() {
    for (const entry of this._queues.values()) {
      await entry.queue.clear();
    }
    this._queues.clear();
  }

  /**
   * Moves dead letter items from source queues to their configured DLQs.
   *
   * Returns the number of items moved (including items that were
   * automatically moved via the onDeadLetter callback since the last call).
   *
   * @returns {Promise<number>}
   */
  async processDeadLetters() {
    // First, collect all dead letter items that are pending manual processing
    const deadLetters = [];

    for (const entry of this._queues.values()) {
      const dlqName = entry.queue.getDeadLetterQueueName();
      if (dlqName) {
        const items = entry.queue.drainDeadLetters();
        if (items.length > 0) {
          deadLetters.push({ dlqName, items });
        }
      }
    }

    let totalMoved = 0;

    // Now enqueue to DLQs (manual processing)
    for (const { dlqName, items } of deadLetters) {
      const dlq = await this.getQueue(dlqName);
      if (dlq) {
        for (const item of items) {
          try {
            await dlq.enqueue(item);
            totalMoved++;
          } catch {
            // Ignore failures (e.g., DLQ full)
          }
        }
      }
    }

    // Include items that were automatically moved via callback
    totalMoved += this._autoDeadLetterCount;
    this._autoDeadLetterCount = 0;

    return totalMoved;
  }
}

// =============================================================================
// Links Queue Manager (Full-featured, timer-based)
// =============================================================================

/**
 * LinksQueueManager - Manages the lifecycle of named LinksQueue instances.
 *
 * This manager uses a LinkStore backend for all queues and provides
 * automatic timer-based visibility timeout handling and dead letter queue
 * routing.
 *
 * @implements {import('./types.ts').QueueManager}
 *
 * @example
 * import { LinksQueueManager, MemoryLinkStore } from 'links-queue';
 *
 * const store = new MemoryLinkStore();
 * const manager = new LinksQueueManager({ store });
 *
 * // Create queues
 * const tasksQueue = await manager.createQueue('tasks', {
 *   retryLimit: 3,
 *   deadLetterQueue: 'tasks-dlq'
 * });
 * const dlqQueue = await manager.createQueue('tasks-dlq');
 *
 * // List all queues
 * const queues = await manager.listQueues();
 * console.log(queues); // [{ name: 'tasks', depth: 0, ... }, ...]
 */
export class LinksQueueManager {
  /**
   * Creates a new LinksQueueManager.
   *
   * @param {Object} config - Manager configuration
   * @param {import('../backends/memory.js').MemoryLinkStore} config.store - LinkStore backend to use for all queues
   */
  constructor(config) {
    const { store } = config;

    /**
     * The underlying LinkStore.
     * @type {import('../backends/memory.js').MemoryLinkStore}
     * @private
     */
    this._store = store;

    /**
     * Registry of created queues.
     * @type {Map<string, LinksQueue>}
     * @private
     */
    this._queues = new Map();
  }

  /**
   * Creates a new named queue with the specified options.
   *
   * If a dead letter queue is specified in options, items that exceed the
   * retry limit will be automatically moved to that queue (if it exists).
   *
   * @param {string} name - Unique name for the queue
   * @param {import('./types.ts').QueueOptions} [options] - Queue configuration
   * @returns {Promise<import('./types.ts').Queue>} The created queue
   * @throws {QueueError} If a queue with this name already exists (QUEUE_ALREADY_EXISTS)
   */
  async createQueue(name, options = {}) {
    if (this._queues.has(name)) {
      throw new QueueError(
        'QUEUE_ALREADY_EXISTS',
        `Queue '${name}' already exists`
      );
    }

    // Create the dead letter handler if DLQ is specified
    const onDeadLetter = options.deadLetterQueue
      ? async (link) => {
          const dlq = this._queues.get(options.deadLetterQueue);
          if (dlq) {
            await dlq.enqueue(link);
          }
          // If DLQ doesn't exist, item is dropped (logged in production)
        }
      : undefined;

    const queue = new LinksQueue({
      name,
      store: this._store,
      options,
      onDeadLetter,
    });

    this._queues.set(name, queue);
    return queue;
  }

  /**
   * Deletes a queue and all its contents.
   *
   * Any in-flight items are lost. This operation is irreversible.
   *
   * @param {string} name - Name of the queue to delete
   * @returns {Promise<boolean>} True if queue was deleted, false if not found
   */
  async deleteQueue(name) {
    const queue = this._queues.get(name);
    if (!queue) {
      return false;
    }

    // Clear the queue to cancel any pending timeouts
    await queue.clear();

    this._queues.delete(name);
    return true;
  }

  /**
   * Retrieves an existing queue by name.
   *
   * @param {string} name - Name of the queue to retrieve
   * @returns {Promise<import('./types.ts').Queue | null>} The queue, or null if not found
   */
  async getQueue(name) {
    return this._queues.get(name) ?? null;
  }

  /**
   * Lists all queues managed by this manager.
   *
   * @returns {Promise<import('./types.ts').QueueInfo[]>} Array of QueueInfo for all queues
   */
  async listQueues() {
    const result = [];

    for (const [name, queue] of this._queues.entries()) {
      result.push({
        name,
        depth: queue.getDepth(),
        createdAt: queue.createdAt,
        options: queue.options,
      });
    }

    return result;
  }

  /**
   * Checks if a queue exists.
   *
   * @param {string} name - Name of the queue to check
   * @returns {boolean} True if queue exists
   */
  hasQueue(name) {
    return this._queues.has(name);
  }

  /**
   * Gets the total number of queues.
   *
   * @returns {number} Number of queues
   */
  getQueueCount() {
    return this._queues.size;
  }

  /**
   * Clears all queues and removes them from the manager.
   *
   * @returns {Promise<void>}
   */
  async clearAll() {
    for (const queue of this._queues.values()) {
      await queue.clear();
    }
    this._queues.clear();
  }
}
