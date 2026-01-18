/**
 * Queue implementation for links-queue.
 *
 * This module provides MemoryQueue, an in-memory implementation of the
 * Queue interface with FIFO ordering, visibility timeout, and delivery guarantees.
 *
 * @module queue/memory-queue
 */

import type { Link, LinkId } from '../index.d.ts';
import type { Queue, QueueOptions, QueueStats, EnqueueResult } from './types.ts';

// =============================================================================
// Memory Queue Implementation
// =============================================================================

/**
 * In-memory queue implementation with FIFO ordering and delivery guarantees.
 */
export declare class MemoryQueue implements Queue {
  /**
   * Creates a new in-memory queue with the given name and options.
   */
  constructor(name: string, options?: QueueOptions);

  /** The name of this queue. */
  readonly name: string;

  /** Returns the timestamp when this queue was created. */
  readonly createdAt: number;

  /** Returns the queue options. */
  readonly options: QueueOptions;

  /** Checks if a dead letter queue is configured. */
  hasDeadLetterQueue(): boolean;

  /** Returns the name of the dead letter queue, if configured. */
  getDeadLetterQueueName(): string | undefined;

  /** Adds a link to the queue. */
  enqueue(link: Link): Promise<EnqueueResult>;

  /** Removes and returns the next link from the queue. */
  dequeue(): Promise<Link | null>;

  /** Returns the next link without removing it from the queue. */
  peek(): Promise<Link | null>;

  /** Acknowledges successful processing of a dequeued item. */
  acknowledge(id: LinkId): Promise<void>;

  /** Rejects a dequeued item, optionally requeuing it. */
  reject(id: LinkId, requeue?: boolean): Promise<void>;

  /** Returns statistics for this queue. */
  getStats(): QueueStats;

  /** Returns the current queue depth. */
  getDepth(): number;

  /**
   * Processes expired in-flight messages, requeuing them if within retry limit.
   * Returns the number of messages that were requeued.
   */
  processExpired(): number;

  /**
   * Returns dead letter items that have been accumulated.
   */
  drainDeadLetters(): Link[];
}

// =============================================================================
// Memory Queue With Storage
// =============================================================================

/**
 * Enhanced queue that stores links for requeue support.
 */
export declare class MemoryQueueWithStorage implements Queue {
  /**
   * Creates a new queue with link storage for proper requeue support.
   */
  constructor(name: string, options?: QueueOptions);

  /** The name of this queue. */
  readonly name: string;

  /** Returns the timestamp when this queue was created. */
  readonly createdAt: number;

  /** Returns the queue options. */
  readonly options: QueueOptions;

  /** Checks if a dead letter queue is configured. */
  hasDeadLetterQueue(): boolean;

  /** Returns the name of the dead letter queue, if configured. */
  getDeadLetterQueueName(): string | undefined;

  /** Adds a link to the queue. */
  enqueue(link: Link): Promise<EnqueueResult>;

  /** Removes and returns the next link from the queue. */
  dequeue(): Promise<Link | null>;

  /** Returns the next link without removing it from the queue. */
  peek(): Promise<Link | null>;

  /** Acknowledges successful processing of a dequeued item. */
  acknowledge(id: LinkId): Promise<void>;

  /** Rejects a dequeued item, optionally requeuing it. */
  reject(id: LinkId, requeue?: boolean): Promise<void>;

  /** Returns statistics for this queue. */
  getStats(): QueueStats;

  /** Returns the current queue depth. */
  getDepth(): number;

  /**
   * Processes expired in-flight messages, requeuing them if within retry limit.
   * Returns the number of messages that were requeued.
   */
  processExpired(): number;

  /**
   * Returns dead letter items that have been accumulated.
   */
  drainDeadLetters(): Link[];
}
