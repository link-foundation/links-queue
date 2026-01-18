/**
 * Queue manager implementation for links-queue.
 *
 * This module provides MemoryQueueManager, an in-memory implementation of the
 * QueueManager interface that manages the lifecycle of queues.
 *
 * @module queue/manager
 */

import type { QueueManager, QueueOptions, QueueInfo } from './types.ts';
import type { MemoryQueueWithStorage } from './memory-queue.d.ts';

// =============================================================================
// Memory Queue Manager
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
