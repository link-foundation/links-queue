/**
 * Type definitions for links-queue-nestjs.
 */

import type { DynamicModule, OnModuleDestroy, Type } from '@nestjs/common';

/**
 * Injection token for Links Queue service.
 */
export declare const LINKS_QUEUE_SERVICE: symbol;

/**
 * Injection token for Links Queue options.
 */
export declare const LINKS_QUEUE_OPTIONS: symbol;

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
 * Module options.
 */
export interface LinksQueueModuleOptions {
  /** Queue mode ('single-memory' or 'single-stored') */
  mode?: QueueModeType;
  /** Custom queue manager */
  queueManager?: QueueManager;
  /** Whether module is global (default: true) */
  isGlobal?: boolean;
}

/**
 * Async module options factory.
 */
export interface LinksQueueOptionsFactory {
  createLinksQueueOptions():
    | Promise<LinksQueueModuleOptions>
    | LinksQueueModuleOptions;
}

/**
 * Async module options.
 */
export interface LinksQueueModuleAsyncOptions {
  /** Factory function returning options */
  useFactory?: (
    ...args: unknown[]
  ) => Promise<LinksQueueModuleOptions> | LinksQueueModuleOptions;
  /** Providers to inject into factory */
  inject?: unknown[];
  /** Modules to import */
  imports?: unknown[];
  /** Whether module is global (default: true) */
  isGlobal?: boolean;
  /** Class implementing options factory */
  useClass?: Type<LinksQueueOptionsFactory>;
  /** Existing provider for options */
  useExisting?: Type<LinksQueueOptionsFactory>;
}

/**
 * Injectable service for queue operations.
 */
export declare class LinksQueueService implements OnModuleDestroy {
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

  /** Called on module destroy */
  onModuleDestroy(): Promise<void>;
}

/**
 * NestJS module for Links Queue.
 */
export declare class LinksQueueModule {
  /**
   * Registers the module with synchronous configuration.
   */
  static forRoot(options?: LinksQueueModuleOptions): DynamicModule;

  /**
   * Registers the module with asynchronous configuration.
   */
  static forRootAsync(options: LinksQueueModuleAsyncOptions): DynamicModule;

  /**
   * Registers a feature module with a specific queue configuration.
   */
  static forFeature(queueName: string, options?: QueueOptions): DynamicModule;
}

/**
 * Injects a specific queue by name.
 */
export declare function InjectQueue(queueName: string): ParameterDecorator;

/**
 * Default export.
 */
export default LinksQueueModule;
