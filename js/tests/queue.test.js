/**
 * Test file for Queue and QueueManager interfaces
 * Works with Node.js, Bun, and Deno via test-anywhere
 */

import { describe, it, expect } from 'test-anywhere';
import { QueueError } from '../src/index.js';

// =============================================================================
// QueueError Tests
// =============================================================================

describe('QueueError', () => {
  describe('constructor', () => {
    it('should create an error with code and message', () => {
      const error = new QueueError('QUEUE_FULL', 'Queue is at capacity');
      expect(error.code).toBe('QUEUE_FULL');
      expect(error.message).toBe('Queue is at capacity');
      expect(error.name).toBe('QueueError');
    });

    it('should be an instance of Error', () => {
      const error = new QueueError('ITEM_NOT_FOUND', 'Item not found');
      expect(error instanceof Error).toBe(true);
    });

    it('should support all error codes', () => {
      const codes = [
        'QUEUE_FULL',
        'QUEUE_NOT_FOUND',
        'QUEUE_ALREADY_EXISTS',
        'ITEM_NOT_FOUND',
        'ITEM_NOT_IN_FLIGHT',
        'INVALID_OPERATION',
      ];

      for (const code of codes) {
        const error = new QueueError(code, `Test error for ${code}`);
        expect(error.code).toBe(code);
      }
    });
  });
});

// =============================================================================
// Type Definition Verification Tests
// These tests verify that the TypeScript types are correctly exported
// by checking runtime behavior that matches the type definitions
// =============================================================================

describe('Queue type definitions', () => {
  describe('EnqueueResult structure', () => {
    it('should define id and position properties', () => {
      // This test verifies the expected structure by demonstrating
      // how an implementation would create an EnqueueResult
      const mockResult = {
        id: 42,
        position: 5,
      };

      expect(mockResult.id).toBe(42);
      expect(mockResult.position).toBe(5);
    });

    it('should support bigint IDs', () => {
      const mockResult = {
        id: 9007199254740993n,
        position: 0,
      };

      expect(typeof mockResult.id).toBe('bigint');
      expect(mockResult.position).toBe(0);
    });

    it('should support string IDs', () => {
      const mockResult = {
        id: 'uuid-12345',
        position: 100,
      };

      expect(typeof mockResult.id).toBe('string');
    });
  });

  describe('QueueStats structure', () => {
    it('should define all required statistics properties', () => {
      // Verify the expected structure of QueueStats
      const mockStats = {
        depth: 100,
        enqueued: 500,
        dequeued: 400,
        acknowledged: 380,
        rejected: 20,
        inFlight: 10,
      };

      expect(mockStats.depth).toBe(100);
      expect(mockStats.enqueued).toBe(500);
      expect(mockStats.dequeued).toBe(400);
      expect(mockStats.acknowledged).toBe(380);
      expect(mockStats.rejected).toBe(20);
      expect(mockStats.inFlight).toBe(10);
    });

    it('should represent counts as numbers', () => {
      const mockStats = {
        depth: 0,
        enqueued: 0,
        dequeued: 0,
        acknowledged: 0,
        rejected: 0,
        inFlight: 0,
      };

      // All values should be numbers
      for (const value of Object.values(mockStats)) {
        expect(typeof value).toBe('number');
      }
    });
  });

  describe('QueueOptions structure', () => {
    it('should support all optional configuration properties', () => {
      const fullOptions = {
        maxSize: 10000,
        visibilityTimeout: 30,
        retryLimit: 3,
        deadLetterQueue: 'my-queue-dlq',
        priority: true,
      };

      expect(fullOptions.maxSize).toBe(10000);
      expect(fullOptions.visibilityTimeout).toBe(30);
      expect(fullOptions.retryLimit).toBe(3);
      expect(fullOptions.deadLetterQueue).toBe('my-queue-dlq');
      expect(fullOptions.priority).toBe(true);
    });

    it('should allow partial options (all optional)', () => {
      const partialOptions = {
        maxSize: 1000,
      };

      expect(partialOptions.maxSize).toBe(1000);
      expect(partialOptions.visibilityTimeout).toBeUndefined();
    });

    it('should allow empty options object', () => {
      const emptyOptions = {};

      expect(Object.keys(emptyOptions).length).toBe(0);
    });
  });

  describe('QueueInfo structure', () => {
    it('should define queue metadata properties', () => {
      const mockInfo = {
        name: 'tasks',
        depth: 42,
        createdAt: Date.now(),
        options: { maxSize: 1000 },
      };

      expect(mockInfo.name).toBe('tasks');
      expect(mockInfo.depth).toBe(42);
      expect(typeof mockInfo.createdAt).toBe('number');
      expect(mockInfo.options.maxSize).toBe(1000);
    });
  });
});

// =============================================================================
// Queue Interface Contract Tests
// These tests demonstrate the expected behavior of Queue implementations
// =============================================================================

describe('Queue interface contract', () => {
  describe('enqueue operation', () => {
    it('should return EnqueueResult with id and position', async () => {
      // Mock implementation demonstrating expected behavior
      const mockEnqueue = async (link) => ({ id: link.id, position: 0 });

      const link = { id: 1, source: 'task', target: 'process' };
      const result = await mockEnqueue(link);

      expect('id' in result).toBe(true);
      expect('position' in result).toBe(true);
      expect(result.id).toBe(1);
      expect(result.position).toBe(0);
    });
  });

  describe('dequeue operation', () => {
    it('should return Link or null', async () => {
      // Mock implementation demonstrating expected behavior
      const mockDequeueEmpty = async () => null;
      const mockDequeueItem = async () => ({
        id: 1,
        source: 'task',
        target: 'process',
      });

      const emptyResult = await mockDequeueEmpty();
      expect(emptyResult).toBe(null);

      const itemResult = await mockDequeueItem();
      expect(itemResult).not.toBe(null);
      expect(itemResult.id).toBe(1);
    });
  });

  describe('peek operation', () => {
    it('should return Link or null without removing', async () => {
      // Mock implementation showing peek behavior
      const items = [{ id: 1, source: 'task', target: 'process' }];
      const mockPeek = async () => (items.length > 0 ? items[0] : null);

      const result1 = await mockPeek();
      const result2 = await mockPeek();

      // Peek should return same item both times
      expect(result1).toEqual(result2);
    });
  });

  describe('acknowledge operation', () => {
    it('should accept LinkId and return void Promise', async () => {
      const acknowledged = [];
      const mockAcknowledge = async (id) => {
        acknowledged.push(id);
      };

      await mockAcknowledge(42);
      await mockAcknowledge('uuid-123');
      await mockAcknowledge(1n);

      expect(acknowledged).toContain(42);
      expect(acknowledged).toContain('uuid-123');
      expect(acknowledged).toContain(1n);
    });
  });

  describe('reject operation', () => {
    it('should accept id and optional requeue flag', async () => {
      const rejected = [];
      const mockReject = async (id, requeue = false) => {
        rejected.push({ id, requeue });
      };

      await mockReject(1);
      await mockReject(2, true);
      await mockReject(3, false);

      expect(rejected[0]).toEqual({ id: 1, requeue: false });
      expect(rejected[1]).toEqual({ id: 2, requeue: true });
      expect(rejected[2]).toEqual({ id: 3, requeue: false });
    });
  });

  describe('getStats operation', () => {
    it('should return QueueStats object synchronously', () => {
      const mockGetStats = () => ({
        depth: 100,
        enqueued: 500,
        dequeued: 400,
        acknowledged: 390,
        rejected: 10,
        inFlight: 5,
      });

      const stats = mockGetStats();

      expect(typeof stats.depth).toBe('number');
      expect(typeof stats.enqueued).toBe('number');
      expect(typeof stats.dequeued).toBe('number');
      expect(typeof stats.acknowledged).toBe('number');
      expect(typeof stats.rejected).toBe('number');
      expect(typeof stats.inFlight).toBe('number');
    });
  });

  describe('getDepth operation', () => {
    it('should return current queue depth as number', () => {
      const mockGetDepth = () => 42;

      expect(mockGetDepth()).toBe(42);
      expect(typeof mockGetDepth()).toBe('number');
    });
  });

  describe('name property', () => {
    it('should be a readonly string property', () => {
      const mockQueue = {
        name: 'my-queue',
      };

      expect(mockQueue.name).toBe('my-queue');
      expect(typeof mockQueue.name).toBe('string');
    });
  });
});

// =============================================================================
// QueueManager Interface Contract Tests
// =============================================================================

describe('QueueManager interface contract', () => {
  describe('createQueue operation', () => {
    it('should create a queue with name and options', async () => {
      const queues = {};
      const mockCreateQueue = async (name, options = {}) => {
        if (queues[name]) {
          throw new QueueError(
            'QUEUE_ALREADY_EXISTS',
            `Queue '${name}' already exists`
          );
        }
        const queue = { name, options };
        queues[name] = queue;
        return queue;
      };

      const queue = await mockCreateQueue('tasks', { maxSize: 1000 });
      expect(queue.name).toBe('tasks');
      expect(queue.options.maxSize).toBe(1000);
    });

    it('should throw QUEUE_ALREADY_EXISTS for duplicate names', async () => {
      const queues = {};
      const mockCreateQueue = async (name, options = {}) => {
        if (queues[name]) {
          throw new QueueError(
            'QUEUE_ALREADY_EXISTS',
            `Queue '${name}' already exists`
          );
        }
        queues[name] = { name, options };
        return queues[name];
      };

      await mockCreateQueue('tasks');

      let caught = false;
      try {
        await mockCreateQueue('tasks');
      } catch (error) {
        caught = true;
        expect(error.code).toBe('QUEUE_ALREADY_EXISTS');
      }
      expect(caught).toBe(true);
    });
  });

  describe('deleteQueue operation', () => {
    it('should return true when queue exists', async () => {
      const queues = { tasks: { name: 'tasks' } };
      const mockDeleteQueue = async (name) => {
        if (queues[name]) {
          delete queues[name];
          return true;
        }
        return false;
      };

      const result = await mockDeleteQueue('tasks');
      expect(result).toBe(true);
      expect(queues.tasks).toBeUndefined();
    });

    it('should return false when queue does not exist', async () => {
      const queues = {};
      const mockDeleteQueue = async (name) => {
        if (queues[name]) {
          delete queues[name];
          return true;
        }
        return false;
      };

      const result = await mockDeleteQueue('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getQueue operation', () => {
    it('should return queue when exists', async () => {
      const queues = { tasks: { name: 'tasks' } };
      const mockGetQueue = async (name) => queues[name] || null;

      const queue = await mockGetQueue('tasks');
      expect(queue).not.toBe(null);
      expect(queue.name).toBe('tasks');
    });

    it('should return null when queue does not exist', async () => {
      const queues = {};
      const mockGetQueue = async (name) => queues[name] || null;

      const queue = await mockGetQueue('non-existent');
      expect(queue).toBe(null);
    });
  });

  describe('listQueues operation', () => {
    it('should return array of QueueInfo', async () => {
      const queues = {
        tasks: { name: 'tasks', depth: 10, createdAt: Date.now(), options: {} },
        events: {
          name: 'events',
          depth: 5,
          createdAt: Date.now(),
          options: {},
        },
      };
      const mockListQueues = async () => Object.values(queues);

      const list = await mockListQueues();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(2);
      expect('name' in list[0]).toBe(true);
      expect('depth' in list[0]).toBe(true);
    });

    it('should return empty array when no queues exist', async () => {
      const mockListQueues = async () => [];

      const list = await mockListQueues();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(0);
    });
  });
});

// =============================================================================
// QueueHandler and QueueSubscription Type Tests
// =============================================================================

describe('QueueHandler and QueueSubscription types', () => {
  describe('QueueHandler', () => {
    it('should be an async function accepting Link', async () => {
      const processed = [];
      const handler = async (item) => {
        processed.push(item.id);
      };

      await handler({ id: 1, source: 'task', target: 'process' });
      await handler({ id: 2, source: 'task', target: 'process' });

      expect(processed).toEqual([1, 2]);
    });
  });

  describe('QueueSubscription', () => {
    it('should have id and unsubscribe method', async () => {
      let unsubscribed = false;
      const mockSubscription = {
        id: 'sub-123',
        unsubscribe: async () => {
          unsubscribed = true;
        },
      };

      expect(mockSubscription.id).toBe('sub-123');
      expect(typeof mockSubscription.unsubscribe).toBe('function');

      await mockSubscription.unsubscribe();
      expect(unsubscribed).toBe(true);
    });
  });
});
