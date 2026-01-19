/**
 * Fastify plugin for Links Queue.
 *
 * Provides a plugin for integrating Links Queue into Fastify applications.
 *
 * @module links-queue-fastify
 *
 * @example
 * import Fastify from 'fastify';
 * import linksQueuePlugin from 'links-queue-fastify';
 *
 * const fastify = Fastify();
 * await fastify.register(linksQueuePlugin, { mode: 'single-memory' });
 *
 * fastify.post('/tasks', async (request, reply) => {
 *   const result = await fastify.linksQueue.enqueue('tasks', request.body);
 *   return result;
 * });
 */

import fp from 'fastify-plugin';
import {
  MemoryQueueManager,
  LinksQueueManager,
  MemoryLinkStore,
} from 'links-queue-js';

// =============================================================================
// Constants
// =============================================================================

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
// Plugin Implementation
// =============================================================================

/**
 * Fastify plugin that decorates the instance with Links Queue.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 * @param {string} [options.mode='single-memory'] - Queue mode
 * @param {string} [options.decoratorName='linksQueue'] - Decorator name
 * @param {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager} [options.queueManager] - Custom queue manager
 */
function linksQueuePluginImpl(fastify, options = {}) {
  const {
    mode = QueueMode.SINGLE_MEMORY,
    decoratorName = 'linksQueue',
    queueManager: customManager,
  } = options;

  // Create queue manager based on mode
  let queueManager = customManager;

  if (!queueManager) {
    if (mode === QueueMode.SINGLE_STORED) {
      const store = new MemoryLinkStore();
      queueManager = new LinksQueueManager({ store });
    } else {
      queueManager = new MemoryQueueManager();
    }
  }

  // Create facade
  const facade = new LinksQueueFacade(queueManager);

  // Decorate fastify instance
  fastify.decorate(decoratorName, facade);

  // Also decorate request for per-request access if needed
  fastify.decorateRequest(decoratorName, {
    getter() {
      return facade;
    },
  });

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    if (queueManager.clearAll) {
      await queueManager.clearAll();
    }
  });
}

/**
 * Fastify plugin for Links Queue.
 */
export const linksQueuePlugin = fp(linksQueuePluginImpl, {
  fastify: '>=4.0.0',
  name: 'links-queue',
});

// =============================================================================
// Queue Facade
// =============================================================================

/**
 * Facade providing simplified queue operations.
 */
export class LinksQueueFacade {
  /**
   * Creates a new LinksQueueFacade.
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
}

// =============================================================================
// Routes Plugin
// =============================================================================

/**
 * Creates a Fastify routes plugin with RESTful queue endpoints.
 *
 * @param {Object} [options] - Route options
 * @param {string} [options.prefix='/queues'] - Route prefix
 * @param {string} [options.decoratorName='linksQueue'] - Decorator name
 * @returns {Function} Fastify plugin
 *
 * @example
 * import Fastify from 'fastify';
 * import linksQueuePlugin, { createQueueRoutes } from 'links-queue-fastify';
 *
 * const fastify = Fastify();
 * await fastify.register(linksQueuePlugin);
 * await fastify.register(createQueueRoutes(), { prefix: '/api' });
 */
export function createQueueRoutes(options = {}) {
  const { prefix = '/queues', decoratorName = 'linksQueue' } = options;

  return function queueRoutes(fastify) {
    // List queues
    fastify.get(prefix, async () => {
      const facade = fastify[decoratorName];
      const queues = await facade.listQueues();
      return { queues };
    });

    // Create queue
    fastify.post(prefix, async (request, reply) => {
      const facade = fastify[decoratorName];
      const { name, options: queueOptions } = request.body || {};

      if (!name) {
        reply.code(400);
        return { error: 'Queue name is required' };
      }

      try {
        await facade.createQueue(name, queueOptions);
        reply.code(201);
        return { created: true, name };
      } catch (error) {
        if (error.code === 'QUEUE_ALREADY_EXISTS') {
          reply.code(409);
          return { error: error.message };
        }
        throw error;
      }
    });

    // Get queue info
    fastify.get(`${prefix}/:name`, async (request, reply) => {
      const facade = fastify[decoratorName];
      const stats = await facade.getStats(request.params.name);

      if (!stats) {
        reply.code(404);
        return { error: 'Queue not found' };
      }

      return stats;
    });

    // Delete queue
    fastify.delete(`${prefix}/:name`, async (request, reply) => {
      const facade = fastify[decoratorName];
      const deleted = await facade.deleteQueue(request.params.name);

      if (!deleted) {
        reply.code(404);
        return { error: 'Queue not found' };
      }

      return { deleted: true, name: request.params.name };
    });

    // Enqueue message
    fastify.post(`${prefix}/:name/messages`, async (request, reply) => {
      const facade = fastify[decoratorName];
      const result = await facade.enqueue(request.params.name, request.body);
      reply.code(201);
      return result;
    });

    // Dequeue message
    fastify.get(`${prefix}/:name/messages`, async (request, reply) => {
      const facade = fastify[decoratorName];
      const message = await facade.dequeue(request.params.name);

      if (!message) {
        reply.code(204);
        return;
      }

      return message;
    });

    // Peek at next message
    fastify.get(`${prefix}/:name/messages/peek`, async (request, reply) => {
      const facade = fastify[decoratorName];
      const message = await facade.peek(request.params.name);

      if (!message) {
        reply.code(204);
        return;
      }

      return message;
    });

    // Acknowledge message
    fastify.post(`${prefix}/:name/messages/:id/ack`, async (request, reply) => {
      const facade = fastify[decoratorName];
      const acknowledged = await facade.acknowledge(
        request.params.name,
        request.params.id
      );

      if (!acknowledged) {
        reply.code(404);
        return { error: 'Message not found' };
      }

      return { acknowledged: true };
    });

    // Reject message
    fastify.post(
      `${prefix}/:name/messages/:id/reject`,
      async (request, reply) => {
        const facade = fastify[decoratorName];
        const { requeue = false } = request.body || {};
        const rejected = await facade.reject(
          request.params.name,
          request.params.id,
          requeue
        );

        if (!rejected) {
          reply.code(404);
          return { error: 'Message not found' };
        }

        return { rejected: true, requeued: requeue };
      }
    );
  };
}

// =============================================================================
// Default Export
// =============================================================================

export default linksQueuePlugin;
