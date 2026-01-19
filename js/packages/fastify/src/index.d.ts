/**
 * Type definitions for links-queue-fastify.
 */

import type { FastifyPluginAsync, FastifyInstance, FastifyRequest } from 'fastify';

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
  clearAll?(): Promise<void>;
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
 * Plugin options.
 */
export interface LinksQueuePluginOptions {
  /** Queue mode ('single-memory' or 'single-stored') */
  mode?: QueueModeType;
  /** Decorator name (default: 'linksQueue') */
  decoratorName?: string;
  /** Custom queue manager */
  queueManager?: QueueManager;
}

/**
 * Queue facade attached to Fastify instance.
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
 * Route options.
 */
export interface QueueRoutesOptions {
  /** Route prefix (default: '/queues') */
  prefix?: string;
  /** Decorator name (default: 'linksQueue') */
  decoratorName?: string;
}

/**
 * Fastify plugin for Links Queue.
 */
export declare const linksQueuePlugin: FastifyPluginAsync<LinksQueuePluginOptions>;

/**
 * Creates a Fastify routes plugin with RESTful queue endpoints.
 */
export declare function createQueueRoutes(
  options?: QueueRoutesOptions
): FastifyPluginAsync;

/**
 * Default export.
 */
export default linksQueuePlugin;

/**
 * Augment Fastify types.
 */
declare module 'fastify' {
  interface FastifyInstance {
    linksQueue: LinksQueueFacade;
  }
  interface FastifyRequest {
    linksQueue: LinksQueueFacade;
  }
}
