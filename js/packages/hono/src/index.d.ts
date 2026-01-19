/**
 * Type definitions for links-queue-hono.
 */

import type { MiddlewareHandler, Hono, Context } from 'hono';

/**
 * Supported queue modes.
 */
export declare const QueueMode: {
  readonly SINGLE_MEMORY: 'single-memory';
  readonly SINGLE_STORED: 'single-stored';
};

export type QueueModeType = (typeof QueueMode)[keyof typeof QueueMode];

/**
 * Queue manager interface.
 */
export interface QueueManager {
  createQueue(name: string, options?: QueueOptions): Promise<Queue>;
  deleteQueue(name: string): Promise<boolean>;
  getQueue(name: string): Promise<Queue | null>;
  listQueues(): Promise<QueueInfo[]>;
  hasQueue(name: string): boolean;
  getQueueCount(): number;
}

/**
 * Queue interface.
 */
export interface Queue {
  enqueue(payload: unknown, options?: EnqueueOptions): Promise<EnqueueResult>;
  dequeue(): Promise<unknown | null>;
  peek(): Promise<unknown | null>;
  acknowledge(messageId: string | number): Promise<boolean>;
  reject(messageId: string | number, requeue?: boolean): Promise<boolean>;
  getStats(): QueueStats;
  getDepth(): number;
}

/**
 * Queue options.
 */
export interface QueueOptions {
  maxSize?: number;
  visibilityTimeout?: number;
  retryLimit?: number;
  deadLetterQueue?: string;
  priority?: boolean;
}

/**
 * Enqueue options.
 */
export interface EnqueueOptions {
  priority?: number;
  queueOptions?: QueueOptions;
}

/**
 * Enqueue result.
 */
export interface EnqueueResult {
  id: string | number;
  position: number;
}

/**
 * Queue info.
 */
export interface QueueInfo {
  name: string;
  depth: number;
  createdAt: number;
  options?: QueueOptions;
}

/**
 * Queue statistics.
 */
export interface QueueStats {
  depth: number;
  inFlight: number;
  enqueued: number;
  dequeued: number;
  acknowledged: number;
  rejected: number;
  deadLettered: number;
}

/**
 * Middleware options.
 */
export interface LinksQueueMiddlewareOptions {
  /** Queue mode ('single-memory' or 'single-stored') */
  mode?: QueueModeType;
  /** Key on context object (default: 'linksQueue') */
  contextKey?: string;
  /** Custom queue manager */
  queueManager?: QueueManager;
}

/**
 * Queue facade attached to Hono context.
 */
export declare class LinksQueueFacade {
  constructor(queueManager: QueueManager);

  /** Gets the underlying queue manager */
  readonly manager: QueueManager;

  /** Creates a new queue */
  createQueue(name: string, options?: QueueOptions): Promise<Queue>;

  /** Gets an existing queue */
  getQueue(name: string): Promise<Queue | null>;

  /** Gets or creates a queue */
  getOrCreateQueue(name: string, options?: QueueOptions): Promise<Queue>;

  /** Deletes a queue */
  deleteQueue(name: string): Promise<boolean>;

  /** Lists all queues */
  listQueues(): Promise<QueueInfo[]>;

  /** Enqueues an item to a queue (auto-creates queue if needed) */
  enqueue(
    queueName: string,
    payload: unknown,
    options?: EnqueueOptions
  ): Promise<EnqueueResult>;

  /** Dequeues an item from a queue */
  dequeue(queueName: string): Promise<unknown | null>;

  /** Peeks at the next item in a queue without removing it */
  peek(queueName: string): Promise<unknown | null>;

  /** Acknowledges processing of an item */
  acknowledge(queueName: string, messageId: string | number): Promise<boolean>;

  /** Rejects an item, optionally requeuing it */
  reject(
    queueName: string,
    messageId: string | number,
    requeue?: boolean
  ): Promise<boolean>;

  /** Gets queue statistics */
  getStats(queueName: string): Promise<QueueStats | null>;
}

/**
 * Queue app options.
 */
export interface QueueAppOptions {
  /** Key on context object (default: 'linksQueue') */
  contextKey?: string;
}

/**
 * Creates Hono middleware that attaches a Links Queue manager to the context.
 */
export declare function linksQueue(
  options?: LinksQueueMiddlewareOptions
): MiddlewareHandler;

/**
 * Creates a Hono app with RESTful queue endpoints.
 */
export declare function createQueueApp(options?: QueueAppOptions): Hono;

/**
 * Default export.
 */
export default linksQueue;

/**
 * Augment Hono types.
 */
declare module 'hono' {
  interface ContextVariableMap {
    linksQueue: LinksQueueFacade;
  }
}
