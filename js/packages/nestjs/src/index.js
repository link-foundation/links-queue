/**
 * NestJS module for Links Queue.
 *
 * Provides a NestJS module for integrating Links Queue into NestJS applications.
 *
 * @module links-queue-nestjs
 *
 * @example
 * import { Module } from '@nestjs/common';
 * import { LinksQueueModule } from 'links-queue-nestjs';
 *
 * @Module({
 *   imports: [LinksQueueModule.forRoot({ mode: 'single-memory' })]
 * })
 * export class AppModule {}
 */

import {
  MemoryQueueManager,
  LinksQueueManager,
  MemoryLinkStore,
} from 'links-queue-js';

// =============================================================================
// Constants & Tokens
// =============================================================================

/**
 * Injection token for Links Queue service.
 */
export const LINKS_QUEUE_SERVICE = Symbol('LINKS_QUEUE_SERVICE');

/**
 * Injection token for Links Queue options.
 */
export const LINKS_QUEUE_OPTIONS = Symbol('LINKS_QUEUE_OPTIONS');

/**
 * Injection token for async options factory.
 */
export const LINKS_QUEUE_OPTIONS_FACTORY = Symbol(
  'LINKS_QUEUE_OPTIONS_FACTORY'
);

/**
 * Supported queue modes.
 * @readonly
 * @enum {string}
 */
export const QueueMode = Object.freeze({
  /** In-memory queue (non-persistent) */
  SINGLE_MEMORY: 'single-memory',
  /** Stored queue with persistence */
  SINGLE_STORED: 'single-stored',
});

// =============================================================================
// Links Queue Service
// =============================================================================

/**
 * Injectable service for queue operations.
 *
 * @example
 * import { Injectable } from '@nestjs/common';
 * import { LinksQueueService } from 'links-queue-nestjs';
 *
 * @Injectable()
 * export class TaskService {
 *   constructor(private readonly queueService: LinksQueueService) {}
 *
 *   async addTask(task) {
 *     return this.queueService.enqueue('tasks', task);
 *   }
 * }
 */
export class LinksQueueService {
  /**
   * Creates a new LinksQueueService.
   *
   * @param {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager} queueManager - The queue manager
   */
  constructor(queueManager) {
    this._manager = queueManager;
  }

  /**
   * Gets the underlying queue manager.
   *
   * @returns {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager}
   */
  get manager() {
    return this._manager;
  }

  /**
   * Creates a new queue.
   *
   * @param {string} name - Queue name
   * @param {Object} [options] - Queue options
   * @returns {Promise<import('links-queue-js').Queue>}
   */
  createQueue(name, options = {}) {
    return this._manager.createQueue(name, options);
  }

  /**
   * Gets an existing queue.
   *
   * @param {string} name - Queue name
   * @returns {Promise<import('links-queue-js').Queue|null>}
   */
  getQueue(name) {
    return this._manager.getQueue(name);
  }

  /**
   * Gets or creates a queue.
   *
   * @param {string} name - Queue name
   * @param {Object} [options] - Queue options
   * @returns {Promise<import('links-queue-js').Queue>}
   */
  async getOrCreateQueue(name, options = {}) {
    let queue = await this._manager.getQueue(name);
    if (!queue) {
      queue = await this._manager.createQueue(name, options);
    }
    return queue;
  }

  /**
   * Deletes a queue.
   *
   * @param {string} name - Queue name
   * @returns {Promise<boolean>}
   */
  deleteQueue(name) {
    return this._manager.deleteQueue(name);
  }

  /**
   * Lists all queues.
   *
   * @returns {Promise<import('links-queue-js').QueueInfo[]>}
   */
  listQueues() {
    return this._manager.listQueues();
  }

  /**
   * Enqueues an item to a queue (auto-creates queue if needed).
   *
   * @param {string} queueName - Queue name
   * @param {Object} payload - Item to enqueue
   * @param {Object} [options] - Enqueue options
   * @returns {Promise<Object>} Enqueue result
   */
  async enqueue(queueName, payload, options = {}) {
    const queue = await this.getOrCreateQueue(queueName, options.queueOptions);
    return queue.enqueue(payload, options);
  }

  /**
   * Dequeues an item from a queue.
   *
   * @param {string} queueName - Queue name
   * @returns {Promise<Object|null>}
   */
  async dequeue(queueName) {
    const queue = await this._manager.getQueue(queueName);
    if (!queue) {
      return null;
    }
    return queue.dequeue();
  }

  /**
   * Peeks at the next item without removing it.
   *
   * @param {string} queueName - Queue name
   * @returns {Promise<Object|null>}
   */
  async peek(queueName) {
    const queue = await this._manager.getQueue(queueName);
    if (!queue) {
      return null;
    }
    return queue.peek();
  }

  /**
   * Acknowledges processing of an item.
   *
   * @param {string} queueName - Queue name
   * @param {string|number} messageId - Message ID
   * @returns {Promise<boolean>}
   */
  async acknowledge(queueName, messageId) {
    const queue = await this._manager.getQueue(queueName);
    if (!queue) {
      return false;
    }
    return queue.acknowledge(messageId);
  }

  /**
   * Rejects an item, optionally requeuing it.
   *
   * @param {string} queueName - Queue name
   * @param {string|number} messageId - Message ID
   * @param {boolean} [requeue=false] - Whether to requeue
   * @returns {Promise<boolean>}
   */
  async reject(queueName, messageId, requeue = false) {
    const queue = await this._manager.getQueue(queueName);
    if (!queue) {
      return false;
    }
    return queue.reject(messageId, requeue);
  }

  /**
   * Gets queue statistics.
   *
   * @param {string} queueName - Queue name
   * @returns {Promise<Object|null>}
   */
  async getStats(queueName) {
    const queue = await this._manager.getQueue(queueName);
    if (!queue) {
      return null;
    }
    return queue.getStats();
  }

  /**
   * Called on module destroy to clean up resources.
   */
  async onModuleDestroy() {
    if (this._manager.clearAll) {
      await this._manager.clearAll();
    }
  }
}

// =============================================================================
// Module Factory Functions
// =============================================================================

/**
 * Creates the queue manager based on options.
 *
 * @param {Object} options - Module options
 * @returns {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager}
 */
function createQueueManager(options = {}) {
  const { mode = QueueMode.SINGLE_MEMORY, queueManager: customManager } =
    options;

  if (customManager) {
    return customManager;
  }

  if (mode === QueueMode.SINGLE_STORED) {
    const store = new MemoryLinkStore();
    return new LinksQueueManager({ store });
  }

  return new MemoryQueueManager();
}

/**
 * Creates the service provider.
 *
 * @param {Object} options - Module options
 * @returns {Object} Provider definition
 */
function createServiceProvider(options) {
  const queueManager = createQueueManager(options);
  return {
    provide: LinksQueueService,
    useValue: new LinksQueueService(queueManager),
  };
}

/**
 * Creates the async service provider.
 *
 * @returns {Object} Provider definition
 */
function createAsyncServiceProvider() {
  return {
    provide: LinksQueueService,
    useFactory: (options) => {
      const queueManager = createQueueManager(options);
      return new LinksQueueService(queueManager);
    },
    inject: [LINKS_QUEUE_OPTIONS],
  };
}

// =============================================================================
// Links Queue Module
// =============================================================================

/**
 * NestJS module for Links Queue.
 *
 * @example
 * // Sync configuration
 * @Module({
 *   imports: [LinksQueueModule.forRoot({ mode: 'single-memory' })]
 * })
 * export class AppModule {}
 *
 * @example
 * // Async configuration
 * @Module({
 *   imports: [
 *     LinksQueueModule.forRootAsync({
 *       useFactory: (configService) => ({
 *         mode: configService.get('QUEUE_MODE'),
 *       }),
 *       inject: [ConfigService],
 *     })
 *   ]
 * })
 * export class AppModule {}
 */
export class LinksQueueModule {
  /**
   * Registers the module with synchronous configuration.
   *
   * @param {Object} options - Module options
   * @param {string} [options.mode='single-memory'] - Queue mode
   * @param {Object} [options.queueManager] - Custom queue manager
   * @returns {Object} Dynamic module definition
   */
  static forRoot(options = {}) {
    const serviceProvider = createServiceProvider(options);

    return {
      module: LinksQueueModule,
      global: options.isGlobal ?? true,
      providers: [
        {
          provide: LINKS_QUEUE_OPTIONS,
          useValue: options,
        },
        serviceProvider,
      ],
      exports: [LinksQueueService],
    };
  }

  /**
   * Registers the module with asynchronous configuration.
   *
   * @param {Object} options - Async module options
   * @param {Function} [options.useFactory] - Factory function returning options
   * @param {Array} [options.inject] - Providers to inject into factory
   * @param {Array} [options.imports] - Modules to import
   * @param {boolean} [options.isGlobal=true] - Whether module is global
   * @returns {Object} Dynamic module definition
   */
  static forRootAsync(options = {}) {
    const asyncOptionsProvider = {
      provide: LINKS_QUEUE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    const asyncServiceProvider = createAsyncServiceProvider();

    return {
      module: LinksQueueModule,
      global: options.isGlobal ?? true,
      imports: options.imports || [],
      providers: [asyncOptionsProvider, asyncServiceProvider],
      exports: [LinksQueueService],
    };
  }

  /**
   * Registers a feature module with a specific queue configuration.
   *
   * @param {string} queueName - Queue name
   * @param {Object} [options] - Queue options
   * @returns {Object} Dynamic module definition
   */
  static forFeature(queueName, options = {}) {
    const token = `LINKS_QUEUE_${queueName.toUpperCase()}`;

    return {
      module: LinksQueueModule,
      providers: [
        {
          provide: token,
          useFactory: (service) => service.getOrCreateQueue(queueName, options),
          inject: [LinksQueueService],
        },
      ],
      exports: [token],
    };
  }
}

// =============================================================================
// Decorators
// =============================================================================

/**
 * Injects a specific queue by name.
 *
 * @param {string} queueName - Queue name
 * @returns {Function} Parameter decorator
 *
 * @example
 * @Injectable()
 * class MyService {
 *   constructor(@InjectQueue('tasks') private tasksQueue: Queue) {}
 * }
 */
export function InjectQueue(queueName) {
  const token = `LINKS_QUEUE_${queueName.toUpperCase()}`;
  // This returns a parameter decorator
  return function (target, propertyKey, parameterIndex) {
    const existingInjections =
      Reflect.getMetadata('custom_inject_params', target) || [];
    existingInjections.push({
      index: parameterIndex,
      token,
    });
    Reflect.defineMetadata('custom_inject_params', existingInjections, target);
  };
}

// =============================================================================
// Default Export
// =============================================================================

export default LinksQueueModule;
