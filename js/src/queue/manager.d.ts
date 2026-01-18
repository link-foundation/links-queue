/**
 * Queue manager implementations for links-queue.
 *
 * This module provides two queue manager implementations:
 *
 * 1. MemoryQueueManager - Lightweight manager for MemoryQueueWithStorage
 * 2. LinksQueueManager - Full-featured manager for LinksQueue
 *
 * @module queue/manager
 */

import type { MemoryLinkStore } from '../backends/memory.d.ts';
import type { Queue, QueueManager, QueueOptions, QueueInfo } from './types.ts';
import type { MemoryQueueWithStorage } from './memory-queue.d.ts';

// =============================================================================
// Memory Queue Manager (Lightweight, poll-based)
// =============================================================================

/**
 * In-memory queue manager that creates and manages MemoryQueueWithStorage instances.
 */
export declare class MemoryQueueManager implements QueueManager {
  /**
   * Creates a new, empty queue manager.
   */
  constructor();

  /**
   * Returns the number of managed queues.
   */
  queueCount(): number;

  /**
   * Checks if a queue with the given name exists.
   */
  hasQueue(name: string): boolean;

  /**
   * Creates a new named queue with the specified options.
   */
  createQueue(
    name: string,
    options?: QueueOptions
  ): Promise<MemoryQueueWithStorage>;

  /**
   * Deletes a queue and all its contents.
   */
  deleteQueue(name: string): Promise<boolean>;

  /**
   * Retrieves an existing queue by name.
   */
  getQueue(name: string): Promise<MemoryQueueWithStorage | null>;

  /**
   * Lists all queues managed by this manager.
   */
  listQueues(): Promise<QueueInfo[]>;

  /**
   * Processes expired messages in all queues.
   * Returns a map of queue names to the number of messages requeued.
   */
  processAllExpired(): Map<string, number>;

  /**
   * Moves dead letter items from source queues to their configured DLQs.
   * Returns the number of items moved.
   */
  processDeadLetters(): Promise<number>;
}

// =============================================================================
// Links Queue Manager (Full-featured, timer-based)
// =============================================================================

/**
 * Configuration for creating a LinksQueueManager.
 */
export interface LinksQueueManagerConfig {
  /**
   * LinkStore backend to use for all queues.
   */
  store: MemoryLinkStore;
}

/**
 * LinksQueueManager - Manages the lifecycle of named LinksQueue instances.
 *
 * This manager uses a LinkStore backend for all queues and provides
 * automatic timer-based visibility timeout handling and dead letter queue
 * routing.
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
export class LinksQueueManager implements QueueManager {
  /**
   * Creates a new LinksQueueManager.
   *
   * @param config - Manager configuration
   */
  constructor(config: LinksQueueManagerConfig);

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
