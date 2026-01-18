/**
 * Test file for Queue and QueueManager implementations
 * Works with Node.js, Bun, and Deno via test-anywhere
 */

import { describe, it, expect } from 'test-anywhere';
import {
  LinksQueue,
  MemoryQueueManager,
  DeliveryTracker,
  MemoryLinkStore,
  createLink,
} from '../src/index.js';

// =============================================================================
// DeliveryTracker Implementation Tests
// =============================================================================

describe('DeliveryTracker', () => {
  describe('constructor', () => {
    it('should create tracker with default options', () => {
      const tracker = new DeliveryTracker();

      expect(tracker.inFlightCount).toBe(0);
      expect(tracker.retryLimit).toBe(3);
      expect(tracker.visibilityTimeout).toBe(30000);
    });

    it('should create tracker with custom options', () => {
      const tracker = new DeliveryTracker({
        visibilityTimeout: 60000,
        retryLimit: 5,
      });

      expect(tracker.retryLimit).toBe(5);
      expect(tracker.visibilityTimeout).toBe(60000);
    });
  });

  describe('track', () => {
    it('should track an item with delivery count', () => {
      const tracker = new DeliveryTracker();
      const link = createLink(1, 'source', 'target');

      const item = tracker.track(1, link);

      expect(item.link).toBe(link);
      expect(item.deliveryCount).toBe(1);
      expect(tracker.inFlightCount).toBe(1);
      expect(tracker.isInFlight(1)).toBe(true);
      tracker.clear();
    });

    it('should increment delivery count on retrack', () => {
      const tracker = new DeliveryTracker();
      const link = createLink(1, 'source', 'target');

      tracker.track(1, link);
      tracker.reject(1, true); // Reject with requeue to keep delivery count
      const item2 = tracker.track(1, link);

      expect(item2.deliveryCount).toBe(2);
      tracker.clear();
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge an in-flight item', () => {
      const tracker = new DeliveryTracker();
      const link = createLink(1, 'source', 'target');

      tracker.track(1, link);
      const ackItem = tracker.acknowledge(1);

      expect(ackItem).not.toBe(null);
      expect(ackItem.link).toBe(link);
      expect(tracker.inFlightCount).toBe(0);
      expect(tracker.isInFlight(1)).toBe(false);
    });

    it('should return null for non-existent item', () => {
      const tracker = new DeliveryTracker();

      const result = tracker.acknowledge(999);

      expect(result).toBe(null);
    });

    it('should clear delivery count on acknowledge', () => {
      const tracker = new DeliveryTracker();
      const link = createLink(1, 'source', 'target');

      tracker.track(1, link);
      tracker.acknowledge(1);

      expect(tracker.getDeliveryCount(1)).toBe(0);
    });
  });

  describe('reject', () => {
    it('should reject an in-flight item without requeue', () => {
      const tracker = new DeliveryTracker();
      const link = createLink(1, 'source', 'target');

      tracker.track(1, link);
      const rejected = tracker.reject(1, false);

      expect(rejected).not.toBe(null);
      expect(tracker.inFlightCount).toBe(0);
      expect(tracker.getDeliveryCount(1)).toBe(0);
    });

    it('should reject an in-flight item with requeue', () => {
      const tracker = new DeliveryTracker();
      const link = createLink(1, 'source', 'target');

      tracker.track(1, link);
      const rejected = tracker.reject(1, true);

      expect(rejected).not.toBe(null);
      expect(tracker.inFlightCount).toBe(0);
      // Delivery count should be preserved for requeue
      expect(tracker.getDeliveryCount(1)).toBe(1);
    });

    it('should return null for non-existent item', () => {
      const tracker = new DeliveryTracker();

      const result = tracker.reject(999);

      expect(result).toBe(null);
    });
  });

  describe('getSnapshot', () => {
    it('should return empty array when no items', () => {
      const tracker = new DeliveryTracker();

      const snapshot = tracker.getSnapshot();

      expect(snapshot).toEqual([]);
    });

    it('should return snapshot of in-flight items', () => {
      const tracker = new DeliveryTracker();
      const link1 = createLink(1, 'a', 'b');
      const link2 = createLink(2, 'c', 'd');

      tracker.track(1, link1);
      tracker.track(2, link2);

      const snapshot = tracker.getSnapshot();

      expect(snapshot.length).toBe(2);
      expect(snapshot[0].id).toBe(1);
      expect(snapshot[1].id).toBe(2);
      tracker.clear();
    });
  });

  describe('clear', () => {
    it('should clear all tracking data', () => {
      const tracker = new DeliveryTracker();
      const link = createLink(1, 'source', 'target');

      tracker.track(1, link);
      tracker.clear();

      expect(tracker.inFlightCount).toBe(0);
      expect(tracker.getDeliveryCount(1)).toBe(0);
    });
  });
});

// =============================================================================
// LinksQueue Implementation Tests
// =============================================================================

describe('LinksQueue constructor', () => {
  it('should create queue with name and store', () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    expect(queue.name).toBe('tasks');
    expect(queue.getDepth()).toBe(0);
  });

  it('should apply default options', () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    expect(queue.options.maxSize).toBe(Number.MAX_SAFE_INTEGER);
    expect(queue.options.visibilityTimeout).toBe(30);
    expect(queue.options.retryLimit).toBe(3);
    expect(queue.options.priority).toBe(false);
  });

  it('should accept custom options', () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({
      name: 'tasks',
      store,
      options: {
        maxSize: 100,
        visibilityTimeout: 60,
        retryLimit: 5,
        priority: true,
      },
    });

    expect(queue.options.maxSize).toBe(100);
    expect(queue.options.visibilityTimeout).toBe(60);
    expect(queue.options.retryLimit).toBe(5);
    expect(queue.options.priority).toBe(true);
  });
});

describe('LinksQueue enqueue', () => {
  it('should enqueue a link and return result', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });
    const link = createLink(1, 'task', 'process');

    const result = await queue.enqueue(link);

    expect(result.id).toBe(1);
    expect(result.position).toBe(0);
    expect(queue.getDepth()).toBe(1);
  });

  it('should maintain FIFO order', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'first', 'a'));
    await queue.enqueue(createLink(2, 'second', 'b'));
    await queue.enqueue(createLink(3, 'third', 'c'));

    const first = await queue.peek();
    expect(first.id).toBe(1);
  });

  it('should throw QUEUE_FULL when at capacity', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({
      name: 'tasks',
      store,
      options: { maxSize: 2 },
    });

    await queue.enqueue(createLink(1, 'a', 'b'));
    await queue.enqueue(createLink(2, 'c', 'd'));

    let caught = false;
    try {
      await queue.enqueue(createLink(3, 'e', 'f'));
    } catch (error) {
      caught = true;
      expect(error.code).toBe('QUEUE_FULL');
    }
    expect(caught).toBe(true);
  });

  it('should support priority ordering', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({
      name: 'tasks',
      store,
      options: { priority: true },
    });

    await queue.enqueue(createLink(1, 5, 'medium'));
    await queue.enqueue(createLink(2, 1, 'high'));
    await queue.enqueue(createLink(3, 10, 'low'));

    const first = await queue.peek();
    expect(first.source).toBe(1); // Lowest source = highest priority
  });
});

describe('LinksQueue dequeue', () => {
  it('should dequeue and return the first item', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'first', 'a'));
    await queue.enqueue(createLink(2, 'second', 'b'));

    const item = await queue.dequeue();

    expect(item.id).toBe(1);
    expect(queue.getDepth()).toBe(1);
    // Clean up the visibility timeout timer to avoid Deno resource leak
    await queue.clear();
  });

  it('should return null when queue is empty', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    const item = await queue.dequeue();

    expect(item).toBe(null);
  });

  it('should track dequeued item as in-flight', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'task', 'process'));
    await queue.dequeue();

    const stats = queue.getStats();
    expect(stats.inFlight).toBe(1);
    expect(stats.depth).toBe(0);
    await queue.acknowledge(1);
  });
});

describe('LinksQueue peek', () => {
  it('should return the first item without removing', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'task', 'process'));

    const item1 = await queue.peek();
    const item2 = await queue.peek();

    expect(item1).toEqual(item2);
    expect(queue.getDepth()).toBe(1);
  });

  it('should return null when queue is empty', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    const item = await queue.peek();

    expect(item).toBe(null);
  });
});

describe('LinksQueue acknowledge', () => {
  it('should acknowledge an in-flight item', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'task', 'process'));
    await queue.dequeue();
    await queue.acknowledge(1);

    const stats = queue.getStats();
    expect(stats.inFlight).toBe(0);
    expect(stats.acknowledged).toBe(1);
  });

  it('should throw ITEM_NOT_IN_FLIGHT for non-existent item', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    let caught = false;
    try {
      await queue.acknowledge(999);
    } catch (error) {
      caught = true;
      expect(error.code).toBe('ITEM_NOT_IN_FLIGHT');
    }
    expect(caught).toBe(true);
  });
});

describe('LinksQueue reject', () => {
  it('should reject an item without requeue', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'task', 'process'));
    await queue.dequeue();
    await queue.reject(1, false);

    const stats = queue.getStats();
    expect(stats.rejected).toBe(1);
    expect(stats.inFlight).toBe(0);
    expect(stats.depth).toBe(0);
  });

  it('should reject an item with requeue', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'task', 'process'));
    await queue.dequeue();
    await queue.reject(1, true);

    const stats = queue.getStats();
    expect(stats.rejected).toBe(1);
    expect(stats.depth).toBe(1);

    // Should be requeued at front
    const requeued = await queue.peek();
    expect(requeued.id).toBe(1);
    await queue.clear();
  });

  it('should throw ITEM_NOT_IN_FLIGHT for non-existent item', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    let caught = false;
    try {
      await queue.reject(999);
    } catch (error) {
      caught = true;
      expect(error.code).toBe('ITEM_NOT_IN_FLIGHT');
    }
    expect(caught).toBe(true);
  });
});

describe('LinksQueue getStats', () => {
  it('should return accurate statistics', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'a', 'b'));
    await queue.enqueue(createLink(2, 'c', 'd'));
    await queue.enqueue(createLink(3, 'e', 'f'));

    await queue.dequeue();
    await queue.acknowledge(1);

    await queue.dequeue();

    const stats = queue.getStats();

    expect(stats.depth).toBe(1);
    expect(stats.enqueued).toBe(3);
    expect(stats.dequeued).toBe(2);
    expect(stats.acknowledged).toBe(1);
    expect(stats.rejected).toBe(0);
    expect(stats.inFlight).toBe(1);
    await queue.clear();
  });
});

describe('LinksQueue clear', () => {
  it('should clear all items and reset statistics', async () => {
    const store = new MemoryLinkStore();
    const queue = new LinksQueue({ name: 'tasks', store });

    await queue.enqueue(createLink(1, 'a', 'b'));
    await queue.enqueue(createLink(2, 'c', 'd'));
    await queue.dequeue();

    await queue.clear();

    const stats = queue.getStats();
    expect(stats.depth).toBe(0);
    expect(stats.enqueued).toBe(0);
    expect(stats.inFlight).toBe(0);
  });
});

// =============================================================================
// MemoryQueueManager Implementation Tests
// =============================================================================

describe('MemoryQueueManager constructor', () => {
  it('should create manager with store', () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    expect(manager.getQueueCount()).toBe(0);
  });
});

describe('MemoryQueueManager createQueue', () => {
  it('should create a new queue', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const queue = await manager.createQueue('tasks');

    expect(queue.name).toBe('tasks');
    expect(manager.hasQueue('tasks')).toBe(true);
    expect(manager.getQueueCount()).toBe(1);
  });

  it('should create queue with options', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const queue = await manager.createQueue('tasks', {
      maxSize: 100,
      visibilityTimeout: 60,
    });

    expect(queue.options.maxSize).toBe(100);
    expect(queue.options.visibilityTimeout).toBe(60);
  });

  it('should throw QUEUE_ALREADY_EXISTS for duplicate', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    await manager.createQueue('tasks');

    let caught = false;
    try {
      await manager.createQueue('tasks');
    } catch (error) {
      caught = true;
      expect(error.code).toBe('QUEUE_ALREADY_EXISTS');
    }
    expect(caught).toBe(true);
  });
});

describe('MemoryQueueManager deleteQueue', () => {
  it('should delete an existing queue', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    await manager.createQueue('tasks');
    const deleted = await manager.deleteQueue('tasks');

    expect(deleted).toBe(true);
    expect(manager.hasQueue('tasks')).toBe(false);
  });

  it('should return false for non-existent queue', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const deleted = await manager.deleteQueue('non-existent');

    expect(deleted).toBe(false);
  });
});

describe('MemoryQueueManager getQueue', () => {
  it('should return existing queue', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    await manager.createQueue('tasks');
    const queue = await manager.getQueue('tasks');

    expect(queue).not.toBe(null);
    expect(queue.name).toBe('tasks');
  });

  it('should return null for non-existent queue', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const queue = await manager.getQueue('non-existent');

    expect(queue).toBe(null);
  });
});

describe('MemoryQueueManager listQueues', () => {
  it('should list all queues', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    await manager.createQueue('tasks');
    await manager.createQueue('events');

    const queues = await manager.listQueues();

    expect(queues.length).toBe(2);
    expect(queues.map((q) => q.name).sort()).toEqual(['events', 'tasks']);
  });

  it('should return empty array when no queues', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const queues = await manager.listQueues();

    expect(queues).toEqual([]);
  });

  it('should include queue info with depth', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const queue = await manager.createQueue('tasks');
    await queue.enqueue(createLink(1, 'a', 'b'));
    await queue.enqueue(createLink(2, 'c', 'd'));

    const queues = await manager.listQueues();
    const tasksInfo = queues.find((q) => q.name === 'tasks');

    expect(tasksInfo.depth).toBe(2);
    expect(tasksInfo.createdAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('MemoryQueueManager dead letter queue integration', () => {
  it('should move items to DLQ after retry limit', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    // Create DLQ first
    const dlq = await manager.createQueue('tasks-dlq');

    // Create main queue with DLQ reference and low retry limit
    const queue = await manager.createQueue('tasks', {
      retryLimit: 2,
      deadLetterQueue: 'tasks-dlq',
    });

    // Enqueue an item
    await queue.enqueue(createLink(1, 'task', 'process'));

    // Dequeue and reject with requeue (attempt 1)
    await queue.dequeue();
    await queue.reject(1, true);

    // Dequeue and reject with requeue (attempt 2 - should go to DLQ)
    await queue.dequeue();
    await queue.reject(1, true);

    // Item should now be in DLQ
    expect(dlq.getDepth()).toBe(1);
    expect(queue.getDepth()).toBe(0);

    const dlqItem = await dlq.peek();
    expect(dlqItem.id).toBe(1);
    await dlq.clear();
    await queue.clear();
  });
});

describe('MemoryQueueManager clearAll', () => {
  it('should clear all queues', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const queue1 = await manager.createQueue('tasks');
    const queue2 = await manager.createQueue('events');

    await queue1.enqueue(createLink(1, 'a', 'b'));
    await queue2.enqueue(createLink(2, 'c', 'd'));

    await manager.clearAll();

    expect(manager.getQueueCount()).toBe(0);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Queue integration tests', () => {
  it('should handle complete enqueue-dequeue-ack flow', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const queue = await manager.createQueue('tasks', {
      visibilityTimeout: 30,
      retryLimit: 3,
    });

    // Enqueue items
    await queue.enqueue(createLink(1, 'task', 'processA'));
    await queue.enqueue(createLink(2, 'task', 'processB'));
    await queue.enqueue(createLink(3, 'task', 'processC'));

    // Dequeue and acknowledge first
    const item1 = await queue.dequeue();
    expect(item1.id).toBe(1);
    await queue.acknowledge(1);

    // Dequeue second but reject with requeue
    const item2 = await queue.dequeue();
    expect(item2.id).toBe(2);
    await queue.reject(2, true);

    // Third should still be at position 1 (after requeued item)
    const item2Again = await queue.dequeue();
    expect(item2Again.id).toBe(2);
    await queue.acknowledge(2);

    const item3 = await queue.dequeue();
    expect(item3.id).toBe(3);
    await queue.acknowledge(3);

    // Queue should be empty
    expect(queue.getDepth()).toBe(0);
    expect(queue.getStats().acknowledged).toBe(3);
    expect(queue.getStats().rejected).toBe(1);
  });

  it('should handle multiple queues independently', async () => {
    const store = new MemoryLinkStore();
    const manager = new MemoryQueueManager({ store });

    const tasksQueue = await manager.createQueue('tasks');
    const eventsQueue = await manager.createQueue('events');

    await tasksQueue.enqueue(createLink(1, 'task', 'a'));
    await eventsQueue.enqueue(createLink(2, 'event', 'b'));
    await eventsQueue.enqueue(createLink(3, 'event', 'c'));

    expect(tasksQueue.getDepth()).toBe(1);
    expect(eventsQueue.getDepth()).toBe(2);

    await tasksQueue.dequeue();
    await tasksQueue.acknowledge(1);

    expect(tasksQueue.getDepth()).toBe(0);
    expect(eventsQueue.getDepth()).toBe(2);
    await eventsQueue.clear();
  });
});
