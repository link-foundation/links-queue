/**
 * Tests for MemoryQueue, MemoryQueueWithStorage, and MemoryQueueManager implementations.
 * Works with Node.js, Bun, and Deno via test-anywhere.
 *
 * Note: Each test creates its own queue/manager instance for Deno compatibility.
 * Deno's test-anywhere doesn't properly scope beforeEach hooks.
 */

/* eslint-disable max-lines-per-function */

import { describe, it, expect } from 'test-anywhere';
import {
  MemoryQueue,
  MemoryQueueWithStorage,
  MemoryQueueManager,
  QueueError,
  DeliveryState,
  DeliveryRecord,
  DeliveryTracker,
  createLink,
} from '../src/index.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a test link with the given ID.
 * @param {number} id - The link ID
 * @returns {import('../src/index.d.ts').Link}
 */
const createTestLink = (id) => createLink(id, `source-${id}`, `target-${id}`);

// =============================================================================
// DeliveryTracker Tests
// =============================================================================

describe('DeliveryTracker', () => {
  describe('constructor', () => {
    it('should create a tracker with default values', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.inFlightCount()).toBe(0);
    });

    it('should create a tracker with custom values', () => {
      const tracker = new DeliveryTracker(60000, 5);
      expect(tracker.inFlightCount()).toBe(0);
    });
  });

  describe('recordDelivery', () => {
    it('should record a new delivery', () => {
      const tracker = new DeliveryTracker();
      const record = tracker.recordDelivery(1);

      expect(record.id).toBe(1);
      expect(record.state).toBe(DeliveryState.IN_FLIGHT);
      expect(record.deliveryCount).toBe(1);
      expect(tracker.inFlightCount()).toBe(1);
    });

    it('should track multiple deliveries', () => {
      const tracker = new DeliveryTracker();
      tracker.recordDelivery(1);
      tracker.recordDelivery(2);
      tracker.recordDelivery(3);

      expect(tracker.inFlightCount()).toBe(3);
      expect(tracker.isInFlight(1)).toBe(true);
      expect(tracker.isInFlight(2)).toBe(true);
      expect(tracker.isInFlight(3)).toBe(true);
    });
  });

  describe('recordRedelivery', () => {
    it('should record a redelivery with incremented count', () => {
      const tracker = new DeliveryTracker();
      const record = tracker.recordRedelivery(1, 2);

      expect(record.id).toBe(1);
      expect(record.deliveryCount).toBe(3); // 2 + 1
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge an in-flight delivery', () => {
      const tracker = new DeliveryTracker();
      tracker.recordDelivery(1);

      expect(tracker.acknowledge(1)).toBe(true);
      expect(tracker.inFlightCount()).toBe(0);
      expect(tracker.isInFlight(1)).toBe(false);
    });

    it('should return false for non-existent delivery', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.acknowledge(999)).toBe(false);
    });

    it('should not acknowledge twice', () => {
      const tracker = new DeliveryTracker();
      tracker.recordDelivery(1);

      expect(tracker.acknowledge(1)).toBe(true);
      expect(tracker.acknowledge(1)).toBe(false);
    });
  });

  describe('reject', () => {
    it('should reject with requeue', () => {
      const tracker = new DeliveryTracker();
      tracker.recordDelivery(1);

      const result = tracker.reject(1, true);

      expect(result).not.toBeNull();
      expect(result.state).toBe(DeliveryState.REQUEUED);
      expect(result.shouldRequeue).toBe(true);
    });

    it('should reject without requeue (drop)', () => {
      const tracker = new DeliveryTracker();
      tracker.recordDelivery(1);

      const result = tracker.reject(1, false);

      expect(result).not.toBeNull();
      expect(result.state).toBe(DeliveryState.DROPPED);
      expect(result.shouldRequeue).toBe(false);
      expect(tracker.isInFlight(1)).toBe(false);
    });

    it('should dead-letter when retry limit exceeded', () => {
      const tracker = new DeliveryTracker(30000, 3);
      tracker.recordRedelivery(1, 3); // delivery_count = 4, exceeds limit of 3

      const result = tracker.reject(1, true);

      expect(result).not.toBeNull();
      expect(result.state).toBe(DeliveryState.DEAD_LETTERED);
      expect(result.shouldRequeue).toBe(false);
    });

    it('should return null for non-existent delivery', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.reject(999, true)).toBeNull();
    });
  });

  describe('getDeliveryCount', () => {
    it('should return 0 for non-existent delivery', () => {
      const tracker = new DeliveryTracker();
      expect(tracker.getDeliveryCount(999)).toBe(0);
    });

    it('should return correct count', () => {
      const tracker = new DeliveryTracker();
      tracker.recordDelivery(1);
      expect(tracker.getDeliveryCount(1)).toBe(1);

      tracker.recordRedelivery(2, 5);
      expect(tracker.getDeliveryCount(2)).toBe(6);
    });
  });

  describe('clear', () => {
    it('should clear all records', () => {
      const tracker = new DeliveryTracker();
      tracker.recordDelivery(1);
      tracker.recordDelivery(2);

      tracker.clear();

      expect(tracker.inFlightCount()).toBe(0);
      expect(tracker.isInFlight(1)).toBe(false);
      expect(tracker.isInFlight(2)).toBe(false);
    });
  });
});

// =============================================================================
// DeliveryRecord Tests
// =============================================================================

describe('DeliveryRecord', () => {
  describe('constructor', () => {
    it('should create a record with correct values', () => {
      const record = new DeliveryRecord(1, 30000, 3);

      expect(record.id).toBe(1);
      expect(record.state).toBe(DeliveryState.IN_FLIGHT);
      expect(record.visibilityTimeoutMs).toBe(30000);
      expect(record.deliveryCount).toBe(1);
      expect(record.retryLimit).toBe(3);
    });
  });

  describe('isExpired', () => {
    it('should return false for new record', () => {
      const record = new DeliveryRecord(1, 30000, 3);
      expect(record.isExpired()).toBe(false);
    });

    it('should return true for expired record', () => {
      const record = new DeliveryRecord(1, 1, 3); // 1ms timeout
      // Wait a bit for the record to expire
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait for 5ms
      }
      expect(record.isExpired()).toBe(true);
    });
  });

  describe('exceededRetryLimit', () => {
    it('should return false when within limit', () => {
      const record = new DeliveryRecord(1, 30000, 3);
      expect(record.exceededRetryLimit()).toBe(false);

      record.deliveryCount = 3;
      expect(record.exceededRetryLimit()).toBe(false);
    });

    it('should return true when exceeded', () => {
      const record = new DeliveryRecord(1, 30000, 3);
      record.deliveryCount = 4;
      expect(record.exceededRetryLimit()).toBe(true);
    });
  });

  describe('incrementDeliveryCount', () => {
    it('should increment the count', () => {
      const record = new DeliveryRecord(1, 30000, 3);
      expect(record.deliveryCount).toBe(1);

      record.incrementDeliveryCount();
      expect(record.deliveryCount).toBe(2);

      record.incrementDeliveryCount();
      expect(record.deliveryCount).toBe(3);
    });
  });
});

// =============================================================================
// MemoryQueue Tests
// =============================================================================

describe('MemoryQueue', () => {
  describe('constructor', () => {
    it('should create a queue with default options', () => {
      const queue = new MemoryQueue('test');

      expect(queue.name).toBe('test');
      expect(queue.getDepth()).toBe(0);
      expect(queue.options.visibilityTimeout).toBe(30);
      expect(queue.options.retryLimit).toBe(3);
    });

    it('should create a queue with custom options', () => {
      const queue = new MemoryQueue('test', {
        maxSize: 100,
        visibilityTimeout: 60,
        retryLimit: 5,
        deadLetterQueue: 'test-dlq',
      });

      expect(queue.options.maxSize).toBe(100);
      expect(queue.options.visibilityTimeout).toBe(60);
      expect(queue.options.retryLimit).toBe(5);
      expect(queue.options.deadLetterQueue).toBe('test-dlq');
    });
  });

  describe('enqueue', () => {
    it('should enqueue a link', async () => {
      const queue = new MemoryQueue('test');
      const link = createTestLink(1);

      const result = await queue.enqueue(link);

      expect(result.id).toBe(1);
      expect(result.position).toBe(0);
      expect(queue.getDepth()).toBe(1);
    });

    it('should enqueue multiple links', async () => {
      const queue = new MemoryQueue('test');

      const result1 = await queue.enqueue(createTestLink(1));
      const result2 = await queue.enqueue(createTestLink(2));
      const result3 = await queue.enqueue(createTestLink(3));

      expect(result1.position).toBe(0);
      expect(result2.position).toBe(1);
      expect(result3.position).toBe(2);
      expect(queue.getDepth()).toBe(3);
    });

    it('should throw QUEUE_FULL when at capacity', async () => {
      const queue = new MemoryQueue('test', { maxSize: 2 });
      await queue.enqueue(createTestLink(1));
      await queue.enqueue(createTestLink(2));

      let error = null;
      try {
        await queue.enqueue(createTestLink(3));
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error instanceof QueueError).toBe(true);
      expect(error.code).toBe('QUEUE_FULL');
    });

    it('should update stats on enqueue', async () => {
      const queue = new MemoryQueue('test');
      await queue.enqueue(createTestLink(1));
      await queue.enqueue(createTestLink(2));

      const stats = queue.getStats();

      expect(stats.depth).toBe(2);
      expect(stats.enqueued).toBe(2);
      expect(stats.dequeued).toBe(0);
    });
  });

  describe('dequeue', () => {
    it('should return null for empty queue', async () => {
      const queue = new MemoryQueue('test');
      const result = await queue.dequeue();
      expect(result).toBeNull();
    });

    it('should dequeue in FIFO order', async () => {
      const queue = new MemoryQueue('test');
      await queue.enqueue(createTestLink(1));
      await queue.enqueue(createTestLink(2));
      await queue.enqueue(createTestLink(3));

      const d1 = await queue.dequeue();
      const d2 = await queue.dequeue();
      const d3 = await queue.dequeue();

      expect(d1.id).toBe(1);
      expect(d2.id).toBe(2);
      expect(d3.id).toBe(3);
    });

    it('should update stats on dequeue', async () => {
      const queue = new MemoryQueue('test');
      await queue.enqueue(createTestLink(1));
      await queue.dequeue();

      const stats = queue.getStats();

      expect(stats.depth).toBe(0);
      expect(stats.dequeued).toBe(1);
      expect(stats.inFlight).toBe(1);
    });
  });

  describe('peek', () => {
    it('should return null for empty queue', async () => {
      const queue = new MemoryQueue('test');
      const result = await queue.peek();
      expect(result).toBeNull();
    });

    it('should return the next item without removing it', async () => {
      const queue = new MemoryQueue('test');
      await queue.enqueue(createTestLink(1));
      await queue.enqueue(createTestLink(2));

      const peeked = await queue.peek();

      expect(peeked.id).toBe(1);
      expect(queue.getDepth()).toBe(2); // Still 2 items
    });

    it('should return the same item on multiple peeks', async () => {
      const queue = new MemoryQueue('test');
      await queue.enqueue(createTestLink(1));

      const peek1 = await queue.peek();
      const peek2 = await queue.peek();

      expect(peek1.id).toBe(1);
      expect(peek2.id).toBe(1);
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge an in-flight item', async () => {
      const queue = new MemoryQueue('test');
      await queue.enqueue(createTestLink(1));
      const item = await queue.dequeue();

      await queue.acknowledge(item.id);

      const stats = queue.getStats();
      expect(stats.acknowledged).toBe(1);
      expect(stats.inFlight).toBe(0);
    });

    it('should throw ITEM_NOT_IN_FLIGHT for non-existent item', async () => {
      const queue = new MemoryQueue('test');

      let error = null;
      try {
        await queue.acknowledge(999);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error instanceof QueueError).toBe(true);
      expect(error.code).toBe('ITEM_NOT_IN_FLIGHT');
    });

    it('should not allow double acknowledge', async () => {
      const queue = new MemoryQueue('test');
      await queue.enqueue(createTestLink(1));
      const item = await queue.dequeue();
      await queue.acknowledge(item.id);

      let error = null;
      try {
        await queue.acknowledge(item.id);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error.code).toBe('ITEM_NOT_IN_FLIGHT');
    });
  });
});

// =============================================================================
// MemoryQueueWithStorage Tests
// =============================================================================

describe('MemoryQueueWithStorage', () => {
  describe('reject with requeue', () => {
    it('should requeue an item', async () => {
      const queue = new MemoryQueueWithStorage('test', { retryLimit: 3 });
      await queue.enqueue(createTestLink(1));

      const item = await queue.dequeue();
      expect(queue.getDepth()).toBe(0);
      expect(queue.getStats().inFlight).toBe(1);

      await queue.reject(item.id, true);

      const stats = queue.getStats();
      expect(stats.rejected).toBe(1);
      expect(stats.depth).toBe(1); // Back in queue
      expect(stats.inFlight).toBe(0);

      // Should be able to dequeue again
      const requeued = await queue.dequeue();
      expect(requeued.id).toBe(1);
    });

    it('should reject without requeue (drop)', async () => {
      const queue = new MemoryQueueWithStorage('test');
      await queue.enqueue(createTestLink(1));
      const item = await queue.dequeue();

      await queue.reject(item.id, false);

      const stats = queue.getStats();
      expect(stats.rejected).toBe(1);
      expect(stats.depth).toBe(0); // Not requeued
      expect(stats.inFlight).toBe(0);
    });

    it('should throw ITEM_NOT_IN_FLIGHT for non-existent item', async () => {
      const queue = new MemoryQueueWithStorage('test');

      let error = null;
      try {
        await queue.reject(999, true);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error instanceof QueueError).toBe(true);
      expect(error.code).toBe('ITEM_NOT_IN_FLIGHT');
    });
  });

  describe('dead letter queue support', () => {
    it('should move to DLQ when retry limit exceeded', async () => {
      const queue = new MemoryQueueWithStorage('test', {
        retryLimit: 2,
        deadLetterQueue: 'test-dlq',
      });
      await queue.enqueue(createTestLink(1));

      // Dequeue and reject multiple times to exceed retry limit
      // Delivery 1
      let item = await queue.dequeue();
      await queue.reject(item.id, true);

      // Delivery 2
      item = await queue.dequeue();
      await queue.reject(item.id, true);

      // Delivery 3 (exceeds limit of 2)
      item = await queue.dequeue();
      await queue.reject(item.id, true); // Should go to DLQ

      const deadLetters = queue.drainDeadLetters();
      expect(deadLetters.length).toBe(1);
      expect(deadLetters[0].id).toBe(1);
      expect(queue.getDepth()).toBe(0);
    });

    it('should report dead letter queue configuration', () => {
      const queueWithDlq = new MemoryQueueWithStorage('test', {
        deadLetterQueue: 'test-dlq',
      });
      const queueWithoutDlq = new MemoryQueueWithStorage('test2');

      expect(queueWithDlq.hasDeadLetterQueue()).toBe(true);
      expect(queueWithDlq.getDeadLetterQueueName()).toBe('test-dlq');
      expect(queueWithoutDlq.hasDeadLetterQueue()).toBe(false);
      expect(queueWithoutDlq.getDeadLetterQueueName()).toBeUndefined();
    });
  });
});

// =============================================================================
// MemoryQueueManager Tests
// =============================================================================

describe('MemoryQueueManager', () => {
  describe('constructor', () => {
    it('should create an empty manager', () => {
      const manager = new MemoryQueueManager();
      expect(manager.queueCount()).toBe(0);
    });
  });

  describe('createQueue', () => {
    it('should create a queue', async () => {
      const manager = new MemoryQueueManager();
      const queue = await manager.createQueue('test');

      expect(queue.name).toBe('test');
      expect(manager.queueCount()).toBe(1);
      expect(manager.hasQueue('test')).toBe(true);
    });

    it('should create a queue with options', async () => {
      const manager = new MemoryQueueManager();
      const queue = await manager.createQueue('test', {
        maxSize: 100,
        visibilityTimeout: 60,
      });

      expect(queue.options.maxSize).toBe(100);
      expect(queue.options.visibilityTimeout).toBe(60);
    });

    it('should throw QUEUE_ALREADY_EXISTS for duplicate', async () => {
      const manager = new MemoryQueueManager();
      await manager.createQueue('test');

      let error = null;
      try {
        await manager.createQueue('test');
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error instanceof QueueError).toBe(true);
      expect(error.code).toBe('QUEUE_ALREADY_EXISTS');
    });
  });

  describe('getQueue', () => {
    it('should return existing queue', async () => {
      const manager = new MemoryQueueManager();
      await manager.createQueue('test');

      const queue = await manager.getQueue('test');

      expect(queue).not.toBeNull();
      expect(queue.name).toBe('test');
    });

    it('should return null for non-existent queue', async () => {
      const manager = new MemoryQueueManager();
      const queue = await manager.getQueue('non-existent');
      expect(queue).toBeNull();
    });
  });

  describe('deleteQueue', () => {
    it('should delete existing queue', async () => {
      const manager = new MemoryQueueManager();
      await manager.createQueue('test');

      const deleted = await manager.deleteQueue('test');

      expect(deleted).toBe(true);
      expect(manager.hasQueue('test')).toBe(false);
      expect(manager.queueCount()).toBe(0);
    });

    it('should return false for non-existent queue', async () => {
      const manager = new MemoryQueueManager();
      const deleted = await manager.deleteQueue('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('listQueues', () => {
    it('should return empty array for no queues', async () => {
      const manager = new MemoryQueueManager();
      const queues = await manager.listQueues();
      expect(queues.length).toBe(0);
    });

    it('should list all queues', async () => {
      const manager = new MemoryQueueManager();
      await manager.createQueue('queue-a');
      await manager.createQueue('queue-b', { maxSize: 100 });

      const queues = await manager.listQueues();

      expect(queues.length).toBe(2);
      const names = queues.map((q) => q.name);
      expect(names).toContain('queue-a');
      expect(names).toContain('queue-b');
    });

    it('should include queue depth in listing', async () => {
      const manager = new MemoryQueueManager();
      const queue = await manager.createQueue('test');
      await queue.enqueue(createTestLink(1));
      await queue.enqueue(createTestLink(2));
      await queue.enqueue(createTestLink(3));

      const queues = await manager.listQueues();

      expect(queues.length).toBe(1);
      expect(queues[0].depth).toBe(3);
    });
  });

  describe('shared state', () => {
    it('should share state between created and retrieved queues', async () => {
      const manager = new MemoryQueueManager();
      const queue1 = await manager.createQueue('test');

      await queue1.enqueue(createTestLink(1));

      const queue2 = await manager.getQueue('test');
      expect(queue2.getDepth()).toBe(1);

      const item = await queue2.dequeue();
      expect(queue1.getDepth()).toBe(0);
      expect(item.id).toBe(1);
    });
  });

  describe('dead letter queue processing', () => {
    it('should process dead letters', async () => {
      const manager = new MemoryQueueManager();

      // Create DLQ first
      const dlq = await manager.createQueue('tasks-dlq');

      // Create main queue with DLQ reference
      const tasks = await manager.createQueue('tasks', {
        retryLimit: 1,
        deadLetterQueue: 'tasks-dlq',
      });

      await tasks.enqueue(createTestLink(1));

      // Exceed retry limit
      let item = await tasks.dequeue();
      await tasks.reject(item.id, true); // Delivery 1

      item = await tasks.dequeue();
      await tasks.reject(item.id, true); // Delivery 2, exceeds limit

      // Process dead letters
      const moved = await manager.processDeadLetters();

      expect(moved).toBe(1);
      expect(dlq.getDepth()).toBe(1);

      const dlqItem = await dlq.dequeue();
      expect(dlqItem.id).toBe(1);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Queue Integration', () => {
  it('should handle complete message lifecycle', async () => {
    const manager = new MemoryQueueManager();
    const queue = await manager.createQueue('tasks');

    // Enqueue
    await queue.enqueue(createTestLink(1));
    await queue.enqueue(createTestLink(2));
    await queue.enqueue(createTestLink(3));

    expect(queue.getStats().enqueued).toBe(3);

    // Dequeue and process
    const item1 = await queue.dequeue();
    await queue.acknowledge(item1.id);

    const item2 = await queue.dequeue();
    await queue.reject(item2.id, true); // Requeue

    const item3 = await queue.dequeue();
    await queue.acknowledge(item3.id);

    // Process requeued item
    const requeued = await queue.dequeue();
    await queue.acknowledge(requeued.id);

    const stats = queue.getStats();
    expect(stats.acknowledged).toBe(3);
    expect(stats.rejected).toBe(1);
    expect(stats.depth).toBe(0);
    expect(stats.inFlight).toBe(0);
  });

  it('should handle multiple queues independently', async () => {
    const manager = new MemoryQueueManager();
    const queue1 = await manager.createQueue('queue-1');
    const queue2 = await manager.createQueue('queue-2');

    await queue1.enqueue(createTestLink(1));
    await queue1.enqueue(createTestLink(2));
    await queue2.enqueue(createTestLink(3));

    expect(queue1.getDepth()).toBe(2);
    expect(queue2.getDepth()).toBe(1);

    const item1 = await queue1.dequeue();
    expect(item1.id).toBe(1);

    const item3 = await queue2.dequeue();
    expect(item3.id).toBe(3);
  });

  it('should support string IDs in links', async () => {
    const queue = new MemoryQueueWithStorage('test');
    const link = createLink('uuid-123', 'source', 'target');

    await queue.enqueue(link);
    const item = await queue.dequeue();

    expect(item.id).toBe('uuid-123');
    await queue.acknowledge('uuid-123');

    expect(queue.getStats().acknowledged).toBe(1);
  });

  it('should support bigint IDs in links', async () => {
    const queue = new MemoryQueueWithStorage('test');
    const link = createLink(9007199254740993n, 'source', 'target');

    await queue.enqueue(link);
    const item = await queue.dequeue();

    expect(item.id).toBe(9007199254740993n);
    await queue.acknowledge(9007199254740993n);

    expect(queue.getStats().acknowledged).toBe(1);
  });
});
