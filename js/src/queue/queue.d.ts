/**
 * Queue implementation for links-queue.
 *
 * This module provides the LinksQueue class - a message queue built on top of
 * the LinkStore backend with FIFO ordering and at-least-once delivery guarantees.
 *
 * @module queue/queue
 */

import type { Link, LinkId } from '../index.d.ts';
import type { MemoryLinkStore } from '../backends/memory.d.ts';
import type {
  Queue,
  QueueOptions,
  QueueStats,
  EnqueueResult,
} from './types.ts';

/**
 * Configuration for creating a LinksQueue.
 */
export interface LinksQueueConfig {
  /**
   * Unique name for this queue.
   */
  name: string;

  /**
   * LinkStore backend to use for storage.
   */
  store: MemoryLinkStore;

  /**
   * Queue options.
   */
  options?: QueueOptions;

  /**
   * Callback invoked when an item exceeds retry limit.
   */
  onDeadLetter?: (link: Link) => Promise<void>;
}

/**
 * LinksQueue - A message queue implementation using links as queue items.
 *
 * Provides standard message queue operations with FIFO ordering (or priority
 * ordering when enabled), visibility timeouts, and at-least-once delivery.
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
export class LinksQueue implements Queue {
  /**
   * Creates a new LinksQueue.
   *
   * @param config - Queue configuration
   */
  constructor(config: LinksQueueConfig);

  /**
   * The name of this queue.
   */
  readonly name: string;

  /**
   * Gets the queue options.
   */
  readonly options: Readonly<Required<QueueOptions>>;

  /**
   * Gets the timestamp when the queue was created.
   */
  readonly createdAt: number;

  /**
   * Adds a link to the queue.
   *
   * @param link - The link to enqueue
   * @returns Enqueue result with ID and position
   * @throws QueueError if queue is at max capacity (QUEUE_FULL)
   */
  enqueue(link: Link): Promise<EnqueueResult>;

  /**
   * Removes and returns the next link from the queue.
   *
   * @returns The next link, or null if empty
   */
  dequeue(): Promise<Link | null>;

  /**
   * Returns the next link without removing it.
   *
   * @returns The next link, or null if empty
   */
  peek(): Promise<Link | null>;

  /**
   * Acknowledges successful processing of a dequeued item.
   *
   * @param id - The ID of the item to acknowledge
   * @throws QueueError if item is not in-flight (ITEM_NOT_IN_FLIGHT)
   */
  acknowledge(id: LinkId): Promise<void>;

  /**
   * Rejects a dequeued item, optionally requeuing it.
   *
   * @param id - The ID of the item to reject
   * @param requeue - Whether to requeue the item
   * @throws QueueError if item is not in-flight (ITEM_NOT_IN_FLIGHT)
   */
  reject(id: LinkId, requeue?: boolean): Promise<void>;

  /**
   * Returns statistics for this queue.
   *
   * @returns Queue statistics
   */
  getStats(): QueueStats;

  /**
   * Returns the current queue depth.
   *
   * @returns Number of items in the queue
   */
  getDepth(): number;

  /**
   * Clears all items from the queue and resets statistics.
   */
  clear(): Promise<void>;
}
