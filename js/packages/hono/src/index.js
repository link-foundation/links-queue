/**
 * Hono middleware for Links Queue.
 *
 * Provides middleware for integrating Links Queue into Hono applications.
 * Works great for edge environments like Cloudflare Workers, Deno Deploy, etc.
 *
 * @module links-queue-hono
 *
 * @example
 * import { Hono } from 'hono';
 * import { linksQueue } from 'links-queue-hono';
 *
 * const app = new Hono();
 * app.use('*', linksQueue({ mode: 'single-memory' }));
 *
 * app.post('/tasks', async (c) => {
 *   const body = await c.req.json();
 *   const result = await c.get('linksQueue').enqueue('tasks', body);
 *   return c.json(result);
 * });
 */

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
// Middleware Factory
// =============================================================================

/**
 * Creates Hono middleware that attaches a Links Queue manager to the context.
 *
 * @param {Object} [options] - Middleware options
 * @param {string} [options.mode='single-memory'] - Queue mode ('single-memory' or 'single-stored')
 * @param {string} [options.contextKey='linksQueue'] - Key on context object
 * @param {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager} [options.queueManager] - Custom queue manager
 * @returns {import('hono').MiddlewareHandler} Hono middleware
 *
 * @example
 * import { Hono } from 'hono';
 * import { linksQueue } from 'links-queue-hono';
 *
 * const app = new Hono();
 * app.use('*', linksQueue());
 *
 * app.post('/tasks', async (c) => {
 *   const body = await c.req.json();
 *   const result = await c.get('linksQueue').enqueue('tasks', body);
 *   return c.json(result);
 * });
 */
export function linksQueue(options = {}) {
  const {
    mode = QueueMode.SINGLE_MEMORY,
    contextKey = 'linksQueue',
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

  /**
   * Hono middleware handler.
   *
   * @param {import('hono').Context} c - Hono context
   * @param {Function} next - Next middleware
   */
  return async function linksQueueMiddleware(c, next) {
    c.set(contextKey, facade);
    await next();
  };
}

// =============================================================================
// Queue Routes Factory
// =============================================================================

/**
 * Creates a Hono app with RESTful queue endpoints.
 *
 * @param {Object} [options] - Route options
 * @param {string} [options.contextKey='linksQueue'] - Key on context object
 * @returns {import('hono').Hono} Hono app with queue routes
 *
 * @example
 * import { Hono } from 'hono';
 * import { linksQueue, createQueueApp } from 'links-queue-hono';
 *
 * const app = new Hono();
 * app.use('*', linksQueue());
 * app.route('/api/queues', createQueueApp());
 */
export function createQueueApp(options = {}) {
  const { contextKey = 'linksQueue' } = options;

  // Dynamic import for Hono
  const { Hono } = globalThis.Hono || {};
  const app = new Hono();

  // List queues
  app.get('/', async (c) => {
    const facade = c.get(contextKey);
    const queues = await facade.listQueues();
    return c.json({ queues });
  });

  // Create queue
  app.post('/', async (c) => {
    const facade = c.get(contextKey);
    const body = await c.req.json();
    const { name, options: queueOptions } = body;

    if (!name) {
      return c.json({ error: 'Queue name is required' }, 400);
    }

    try {
      await facade.createQueue(name, queueOptions);
      return c.json({ created: true, name }, 201);
    } catch (error) {
      if (error.code === 'QUEUE_ALREADY_EXISTS') {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // Get queue info
  app.get('/:name', async (c) => {
    const facade = c.get(contextKey);
    const stats = await facade.getStats(c.req.param('name'));

    if (!stats) {
      return c.json({ error: 'Queue not found' }, 404);
    }

    return c.json(stats);
  });

  // Delete queue
  app.delete('/:name', async (c) => {
    const facade = c.get(contextKey);
    const deleted = await facade.deleteQueue(c.req.param('name'));

    if (!deleted) {
      return c.json({ error: 'Queue not found' }, 404);
    }

    return c.json({ deleted: true, name: c.req.param('name') });
  });

  // Enqueue message
  app.post('/:name/messages', async (c) => {
    const facade = c.get(contextKey);
    const body = await c.req.json();
    const result = await facade.enqueue(c.req.param('name'), body);
    return c.json(result, 201);
  });

  // Dequeue message
  app.get('/:name/messages', async (c) => {
    const facade = c.get(contextKey);
    const message = await facade.dequeue(c.req.param('name'));

    if (!message) {
      return c.body(null, 204);
    }

    return c.json(message);
  });

  // Peek at next message
  app.get('/:name/messages/peek', async (c) => {
    const facade = c.get(contextKey);
    const message = await facade.peek(c.req.param('name'));

    if (!message) {
      return c.body(null, 204);
    }

    return c.json(message);
  });

  // Acknowledge message
  app.post('/:name/messages/:id/ack', async (c) => {
    const facade = c.get(contextKey);
    const acknowledged = await facade.acknowledge(
      c.req.param('name'),
      c.req.param('id')
    );

    if (!acknowledged) {
      return c.json({ error: 'Message not found' }, 404);
    }

    return c.json({ acknowledged: true });
  });

  // Reject message
  app.post('/:name/messages/:id/reject', async (c) => {
    const facade = c.get(contextKey);
    const body = await c.req.json().catch(() => ({}));
    const { requeue = false } = body;
    const rejected = await facade.reject(
      c.req.param('name'),
      c.req.param('id'),
      requeue
    );

    if (!rejected) {
      return c.json({ error: 'Message not found' }, 404);
    }

    return c.json({ rejected: true, requeued: requeue });
  });

  return app;
}

// =============================================================================
// Default Export
// =============================================================================

export default linksQueue;
