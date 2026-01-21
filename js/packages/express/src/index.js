/**
 * Express.js middleware for Links Queue.
 *
 * Provides middleware for integrating Links Queue into Express.js applications.
 *
 * @module links-queue-express
 *
 * @example
 * import express from 'express';
 * import { linksQueueMiddleware } from 'links-queue-express';
 *
 * const app = express();
 * app.use(linksQueueMiddleware({ mode: 'single-memory' }));
 *
 * app.post('/tasks', async (req, res) => {
 *   const result = await req.linksQueue.enqueue('tasks', req.body);
 *   res.json(result);
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
// Middleware Factory
// =============================================================================

/**
 * Creates Express middleware that attaches a Links Queue manager to requests.
 *
 * @param {Object} [options] - Middleware options
 * @param {string} [options.mode='single-memory'] - Queue mode ('single-memory' or 'single-stored')
 * @param {string} [options.requestProperty='linksQueue'] - Property name on request object
 * @param {Object} [options.storeOptions] - Options for the link store (for single-stored mode)
 * @param {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager} [options.queueManager] - Custom queue manager
 * @returns {Function} Express middleware function
 *
 * @example
 * // Basic usage with in-memory queue
 * app.use(linksQueueMiddleware());
 *
 * @example
 * // With stored mode
 * app.use(linksQueueMiddleware({ mode: 'single-stored' }));
 *
 * @example
 * // With custom property name
 * app.use(linksQueueMiddleware({ requestProperty: 'queue' }));
 */
export function linksQueueMiddleware(options = {}) {
  const {
    mode = QueueMode.SINGLE_MEMORY,
    requestProperty = 'linksQueue',
    queueManager: customManager,
  } = options;

  // Create queue manager based on mode (or use custom manager)
  let queueManager = customManager;

  if (!queueManager) {
    if (mode === QueueMode.SINGLE_STORED) {
      const store = new MemoryLinkStore();
      queueManager = new LinksQueueManager({ store });
    } else {
      queueManager = new MemoryQueueManager();
    }
  }

  // Create facade for request
  const facade = new LinksQueueFacade(queueManager);

  /**
   * Express middleware function.
   *
   * @param {import('express').Request} req - Express request
   * @param {import('express').Response} res - Express response
   * @param {import('express').NextFunction} next - Next middleware
   */
  return function linksQueueMiddlewareHandler(req, res, next) {
    // Attach facade to request
    req[requestProperty] = facade;

    next();
  };
}

// =============================================================================
// Queue Facade
// =============================================================================

/**
 * Facade providing simplified queue operations for Express requests.
 *
 * This class wraps the queue manager and provides convenience methods
 * for common queue operations.
 */
export class LinksQueueFacade {
  /**
   * Creates a new LinksQueueFacade.
   *
   * @param {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager} queueManager - The queue manager
   */
  constructor(queueManager) {
    /**
     * The underlying queue manager.
     * @type {import('links-queue-js').MemoryQueueManager|import('links-queue-js').LinksQueueManager}
     * @private
     */
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
   * @param {Object} [options] - Queue options (used only if creating)
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
   * @returns {Promise<Object|null>} The dequeued item or null if empty
   */
  async dequeue(queueName) {
    const queue = await this._manager.getQueue(queueName);
    if (!queue) {
      return null;
    }
    return queue.dequeue();
  }

  /**
   * Peeks at the next item in a queue without removing it.
   *
   * @param {string} queueName - Queue name
   * @returns {Promise<Object|null>} The next item or null if empty
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
   * @returns {Promise<Object|null>} Queue stats or null if queue doesn't exist
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
// Router Factory
// =============================================================================

/**
 * Creates an Express router with RESTful queue endpoints.
 *
 * @param {Object} [options] - Router options
 * @param {string} [options.basePath='/queues'] - Base path for queue routes
 * @param {string} [options.requestProperty='linksQueue'] - Property name on request object
 * @returns {import('express').Router} Express router
 *
 * @example
 * import express from 'express';
 * import { linksQueueMiddleware, createQueueRouter } from 'links-queue-express';
 *
 * const app = express();
 * app.use(express.json());
 * app.use(linksQueueMiddleware());
 * app.use('/api', createQueueRouter());
 *
 * // Now you have:
 * // GET /api/queues - List queues
 * // POST /api/queues - Create queue
 * // GET /api/queues/:name - Get queue info
 * // DELETE /api/queues/:name - Delete queue
 * // POST /api/queues/:name/messages - Enqueue
 * // GET /api/queues/:name/messages - Dequeue
 * // POST /api/queues/:name/messages/:id/ack - Acknowledge
 * // POST /api/queues/:name/messages/:id/reject - Reject
 */
export function createQueueRouter(options = {}) {
  const { basePath = '/queues', requestProperty = 'linksQueue' } = options;

  // Use dynamic require to get express Router
  // eslint-disable-next-line no-undef
  const { Router } = require('express');
  const router = Router();

  // List queues
  router.get(basePath, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const queues = await facade.listQueues();
      res.json({ queues });
    } catch (error) {
      next(error);
    }
  });

  // Create queue
  router.post(basePath, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const { name, options: queueOptions } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Queue name is required' });
      }

      await facade.createQueue(name, queueOptions);
      res.status(201).json({ created: true, name });
    } catch (error) {
      if (error.code === 'QUEUE_ALREADY_EXISTS') {
        return res.status(409).json({ error: error.message });
      }
      next(error);
    }
  });

  // Get queue info
  router.get(`${basePath}/:name`, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const stats = await facade.getStats(req.params.name);

      if (!stats) {
        return res.status(404).json({ error: 'Queue not found' });
      }

      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  // Delete queue
  router.delete(`${basePath}/:name`, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const deleted = await facade.deleteQueue(req.params.name);

      if (!deleted) {
        return res.status(404).json({ error: 'Queue not found' });
      }

      res.json({ deleted: true, name: req.params.name });
    } catch (error) {
      next(error);
    }
  });

  // Enqueue message
  router.post(`${basePath}/:name/messages`, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const result = await facade.enqueue(req.params.name, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  // Dequeue message
  router.get(`${basePath}/:name/messages`, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const message = await facade.dequeue(req.params.name);

      if (!message) {
        return res.status(204).send();
      }

      res.json(message);
    } catch (error) {
      next(error);
    }
  });

  // Peek at next message
  router.get(`${basePath}/:name/messages/peek`, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const message = await facade.peek(req.params.name);

      if (!message) {
        return res.status(204).send();
      }

      res.json(message);
    } catch (error) {
      next(error);
    }
  });

  // Acknowledge message
  router.post(`${basePath}/:name/messages/:id/ack`, async (req, res, next) => {
    try {
      const facade = req[requestProperty];
      const acknowledged = await facade.acknowledge(
        req.params.name,
        req.params.id
      );

      if (!acknowledged) {
        return res.status(404).json({ error: 'Message not found' });
      }

      res.json({ acknowledged: true });
    } catch (error) {
      next(error);
    }
  });

  // Reject message
  router.post(
    `${basePath}/:name/messages/:id/reject`,
    async (req, res, next) => {
      try {
        const facade = req[requestProperty];
        const { requeue = false } = req.body || {};
        const rejected = await facade.reject(
          req.params.name,
          req.params.id,
          requeue
        );

        if (!rejected) {
          return res.status(404).json({ error: 'Message not found' });
        }

        res.json({ rejected: true, requeued: requeue });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

// =============================================================================
// Error Handler
// =============================================================================

/**
 * Express error handler for queue errors.
 *
 * @param {Error} err - The error
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Next middleware
 */
export function linksQueueErrorHandler(err, req, res, next) {
  // Handle queue-specific errors
  if (err.code && err.code.startsWith('QUEUE_')) {
    const statusCode = getStatusCodeForError(err.code);
    return res.status(statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  // Pass to next error handler
  next(err);
}

/**
 * Maps error codes to HTTP status codes.
 *
 * @param {string} code - Error code
 * @returns {number} HTTP status code
 */
function getStatusCodeForError(code) {
  switch (code) {
    case 'QUEUE_NOT_FOUND':
      return 404;
    case 'QUEUE_ALREADY_EXISTS':
      return 409;
    case 'QUEUE_FULL':
      return 503;
    case 'QUEUE_EMPTY':
      return 204;
    case 'MESSAGE_NOT_FOUND':
      return 404;
    default:
      return 500;
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default linksQueueMiddleware;
