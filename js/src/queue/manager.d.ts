/**
 * QueueManager implementation for links-queue.
 *
 * This module provides the MemoryQueueManager class - a registry for managing
 * multiple named queues with lifecycle operations.
 *
 * @module queue/manager
 */

import type { MemoryLinkStore } from '../backends/memory.d.ts';
import type { Queue, QueueManager, QueueOptions, QueueInfo } from './types.ts';

/**
 * Configuration for creating a MemoryQueueManager.
 */
export interface MemoryQueueManagerConfig {
  /**
   * LinkStore backend to use for all queues.
   */
  store: MemoryLinkStore;
}

/**
 * MemoryQueueManager - Manages the lifecycle of named queues.
 *
 * Handles creating, deleting, and retrieving queue instances. Acts as a
 * registry for all queues in the system and manages dead letter queue
 * relationships.
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
 * console.log(queues); // [{ name: 'tasks', depth: 0, ... }, ...]
 */
export class MemoryQueueManager implements QueueManager {
  /**
   * Creates a new MemoryQueueManager.
   *
   * @param config - Manager configuration
   */
  constructor(config: MemoryQueueManagerConfig);

  /**
   * Creates a new named queue with the specified options.
   *
   * @param name - Unique name for the queue
   * @param options - Queue configuration
   * @returns The created queue
   * @throws QueueError if a queue with this name already exists (QUEUE_ALREADY_EXISTS)
   */
  createQueue(name: string, options?: QueueOptions): Promise<Queue>;

  /**
   * Deletes a queue and all its contents.
   *
   * @param name - Name of the queue to delete
   * @returns True if queue was deleted, false if not found
   */
  deleteQueue(name: string): Promise<boolean>;

  /**
   * Retrieves an existing queue by name.
   *
   * @param name - Name of the queue to retrieve
   * @returns The queue, or null if not found
   */
  getQueue(name: string): Promise<Queue | null>;

  /**
   * Lists all queues managed by this manager.
   *
   * @returns Array of QueueInfo for all queues
   */
  listQueues(): Promise<QueueInfo[]>;

  /**
   * Checks if a queue exists.
   *
   * @param name - Name of the queue to check
   * @returns True if queue exists
   */
  hasQueue(name: string): boolean;

  /**
   * Gets the total number of queues.
   *
   * @returns Number of queues
   */
  getQueueCount(): number;

  /**
   * Clears all queues and removes them from the manager.
   */
  clearAll(): Promise<void>;
}
