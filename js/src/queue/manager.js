/**
 * QueueManager implementation for links-queue.
 *
 * This module provides the MemoryQueueManager class - a registry for managing
 * multiple named queues with lifecycle operations.
 *
 * @module queue/manager
 *
 * @see ARCHITECTURE.md - Queue Manager component
 * @see REQUIREMENTS.md - REQ-API-010 through REQ-API-013
 */

/* eslint-disable require-await */

import { QueueError } from './types.js';
import { LinksQueue } from './queue.js';

/**
 * MemoryQueueManager - Manages the lifecycle of named queues.
 *
 * Handles creating, deleting, and retrieving queue instances. Acts as a
 * registry for all queues in the system and manages dead letter queue
 * relationships.
 *
 * @implements {import('./types.ts').QueueManager}
 *
 * @example
 * import { MemoryQueueManager, MemoryLinkStore } from 'links-queue';
 *
 * const store = new MemoryLinkStore();
 * const manager = new MemoryQueueManager({ store });
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
 * console.log(queues); // [{ name: 'tasks', depth: 0, ... }, { name: 'tasks-dlq', depth: 0, ... }]
 *
 * // Use the queue
 * await tasksQueue.enqueue(myLink);
 */
export class MemoryQueueManager {
  /**
   * Creates a new MemoryQueueManager.
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
