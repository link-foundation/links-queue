/**
 * Queue manager implementation for links-queue.
 *
 * This module provides MemoryQueueManager, an in-memory implementation of the
 * QueueManager interface that manages the lifecycle of queues.
 *
 * @module queue/manager
 *
 * Features:
 * - Queue lifecycle: Create, delete, and retrieve queues by name
 * - Queue listing: Enumerate all managed queues with their info
 * - Thread-safe: Uses Map for storage (JavaScript is single-threaded)
 *
 * @example
 * import { MemoryQueueManager } from 'links-queue';
 *
 * const manager = new MemoryQueueManager();
 *
 * // Create queues
 * const dlq = await manager.createQueue('tasks-dlq');
 * const tasks = await manager.createQueue('tasks', {
 *   retryLimit: 3,
 *   deadLetterQueue: 'tasks-dlq'
 * });
 *
 * // List all queues
 * for (const info of await manager.listQueues()) {
 *   console.log(`Queue: ${info.name} (depth: ${info.depth})`);
 * }
 */

/*
 * Note: The require-await warnings are intentional.
 * This implementation uses async methods for API consistency with other backends
 * (e.g., file-based or network-based managers) even though the in-memory operations
 * are synchronous. This allows for seamless backend swapping.
 */
/* eslint-disable require-await */

import { QueueError } from './types.js';
import { MemoryQueueWithStorage } from './memory-queue.js';

// =============================================================================
// Queue Entry (Internal)
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
// Memory Queue Manager
// =============================================================================

/**
 * In-memory queue manager that creates and manages MemoryQueueWithStorage instances.
 *
 * This manager maintains a registry of queues and provides CRUD operations
 * for queue lifecycle management.
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
   * @example
   * const manager = new MemoryQueueManager();
   */
  constructor() {
    /**
     * Registry of managed queues.
     * @type {Map<string, QueueEntry>}
     * @private
     */
    this._queues = new Map();
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

    // Create the queue
    const queue = new MemoryQueueWithStorage(name, options);

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
   * Moves dead letter items from source queues to their configured DLQs.
   *
   * Returns the number of items moved.
   *
   * @returns {Promise<number>}
   */
  async processDeadLetters() {
    // First, collect all dead letter items
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

    // Now enqueue to DLQs
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

    return totalMoved;
  }
}
