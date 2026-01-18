/**
 * Test file for Pub/Sub module
 * Tests for publish/subscribe messaging patterns
 */

import { describe, it, expect } from 'test-anywhere';
import {
  MessageFilter,
  PubSubBroker,
  ObservableQueue,
  QueueBackedPubSub,
} from '../src/features/pubsub.js';

// =============================================================================
// MessageFilter Tests
// =============================================================================

describe('MessageFilter', () => {
  describe('matches', () => {
    it('should match exact values', () => {
      const link = { id: 1, source: 'user', target: 'created' };

      expect(MessageFilter.matches({ source: 'user' }, link)).toBe(true);
      expect(MessageFilter.matches({ source: 'admin' }, link)).toBe(false);
    });

    it('should match multiple fields', () => {
      const link = { id: 1, source: 'user', target: 'created' };

      expect(
        MessageFilter.matches({ source: 'user', target: 'created' }, link)
      ).toBe(true);
      expect(
        MessageFilter.matches({ source: 'user', target: 'deleted' }, link)
      ).toBe(false);
    });

    it('should match regex patterns', () => {
      const link = { id: 1, source: 'user-123', target: 'created' };

      expect(MessageFilter.matches({ source: /^user-/ }, link)).toBe(true);
      expect(MessageFilter.matches({ source: /^admin-/ }, link)).toBe(false);
    });

    it('should match with function predicates', () => {
      const link = { id: 100, source: 'user', target: 'created' };

      expect(MessageFilter.matches({ id: (v) => v > 50 }, link)).toBe(true);
      expect(MessageFilter.matches({ id: (v) => v > 200 }, link)).toBe(false);
    });

    it('should match empty pattern (all messages)', () => {
      const link = { id: 1, source: 'user', target: 'created' };

      expect(MessageFilter.matches({}, link)).toBe(true);
    });
  });

  describe('createFilter', () => {
    it('should create reusable filter function', () => {
      const filter = MessageFilter.createFilter({ source: 'user' });

      expect(filter({ id: 1, source: 'user', target: 'a' })).toBe(true);
      expect(filter({ id: 2, source: 'admin', target: 'b' })).toBe(false);
    });
  });
});

// =============================================================================
// PubSubBroker Tests
// =============================================================================

describe('PubSubBroker', () => {
  describe('constructor', () => {
    it('should create broker with default options', () => {
      const broker = new PubSubBroker();
      const stats = broker.getStats();

      expect(stats.topics).toBe(0);
      expect(stats.subscriptions).toBe(0);
    });

    it('should create broker with custom options', () => {
      const broker = new PubSubBroker({
        autoCreateTopics: false,
        messageRetention: 60000,
      });

      expect(broker.getStats().topics).toBe(0);
    });
  });

  describe('createTopic', () => {
    it('should create a new topic', () => {
      const broker = new PubSubBroker();

      const topic = broker.createTopic('events');

      expect(topic.name).toBe('events');
      expect(topic.messageCount).toBe(0);
      expect(topic.subscriberCount).toBe(0);
    });

    it('should throw on duplicate topic', () => {
      const broker = new PubSubBroker();

      broker.createTopic('events');

      expect(() => broker.createTopic('events')).toThrow();
    });
  });

  describe('getTopic', () => {
    it('should return topic by name', () => {
      const broker = new PubSubBroker();

      broker.createTopic('events');
      const topic = broker.getTopic('events');

      expect(topic).not.toBeUndefined();
      expect(topic.name).toBe('events');
    });

    it('should return undefined for non-existent topic', () => {
      const broker = new PubSubBroker();

      const topic = broker.getTopic('non-existent');

      expect(topic).toBeUndefined();
    });
  });

  describe('deleteTopic', () => {
    it('should delete topic and subscriptions', async () => {
      const broker = new PubSubBroker();

      broker.createTopic('events');
      broker.subscribe('events', async () => {});

      const result = broker.deleteTopic('events');

      expect(result).toBe(true);
      expect(broker.getTopic('events')).toBeUndefined();
      expect(broker.listSubscriptions().length).toBe(0);
    });

    it('should return false for non-existent topic', () => {
      const broker = new PubSubBroker();

      const result = broker.deleteTopic('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('listTopics', () => {
    it('should list all topics', () => {
      const broker = new PubSubBroker();

      broker.createTopic('events');
      broker.createTopic('logs');

      const topics = broker.listTopics();

      expect(topics.length).toBe(2);
      expect(topics.find((t) => t.name === 'events')).not.toBeUndefined();
      expect(topics.find((t) => t.name === 'logs')).not.toBeUndefined();
    });
  });

  describe('subscribe', () => {
    it('should create subscription', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const sub = broker.subscribe('events', async () => {});

      expect(sub.id).not.toBeUndefined();
      expect(sub.topic).toBe('events');
      expect(sub.active).toBe(true);
    });

    it('should auto-create topic if enabled', () => {
      const broker = new PubSubBroker({ autoCreateTopics: true });

      broker.subscribe('new-topic', async () => {});

      expect(broker.getTopic('new-topic')).not.toBeUndefined();
    });

    it('should throw if topic does not exist and auto-create disabled', () => {
      const broker = new PubSubBroker({ autoCreateTopics: false });

      expect(() => broker.subscribe('non-existent', async () => {})).toThrow();
    });

    it('should increment topic subscriber count', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      broker.subscribe('events', async () => {});
      broker.subscribe('events', async () => {});

      const topic = broker.getTopic('events');
      expect(topic.subscriberCount).toBe(2);
    });

    it('should support filter option', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const sub = broker.subscribe('events', async () => {}, {
        filter: { source: 'user' },
      });

      expect(sub.pattern).toEqual({ source: 'user' });
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const sub = broker.subscribe('events', async () => {});
      const result = broker.unsubscribe(sub.id);

      expect(result).toBe(true);
      expect(broker.getSubscription(sub.id)).toBeUndefined();
    });

    it('should decrement topic subscriber count', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const sub = broker.subscribe('events', async () => {});
      broker.unsubscribe(sub.id);

      const topic = broker.getTopic('events');
      expect(topic.subscriberCount).toBe(0);
    });

    it('should return false for non-existent subscription', () => {
      const broker = new PubSubBroker();

      const result = broker.unsubscribe('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('pause/resume', () => {
    it('should pause subscription', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const sub = broker.subscribe('events', async () => {});
      broker.pause(sub.id);

      expect(broker.getSubscription(sub.id).active).toBe(false);
    });

    it('should resume subscription', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const sub = broker.subscribe('events', async () => {});
      broker.pause(sub.id);
      broker.resume(sub.id);

      expect(broker.getSubscription(sub.id).active).toBe(true);
    });
  });

  describe('listSubscriptions', () => {
    it('should list all subscriptions', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');
      broker.createTopic('logs');

      broker.subscribe('events', async () => {});
      broker.subscribe('logs', async () => {});

      const subs = broker.listSubscriptions();
      expect(subs.length).toBe(2);
    });

    it('should filter by topic', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');
      broker.createTopic('logs');

      broker.subscribe('events', async () => {});
      broker.subscribe('events', async () => {});
      broker.subscribe('logs', async () => {});

      const subs = broker.listSubscriptions('events');
      expect(subs.length).toBe(2);
    });
  });

  describe('publish', () => {
    it('should deliver message to all subscribers', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const received = [];
      broker.subscribe('events', async (msg) => received.push(msg));
      broker.subscribe('events', async (msg) => received.push(msg));

      const link = { id: 1, source: 'test', target: 'item' };
      const result = await broker.publish('events', link);

      expect(result.delivered).toBe(2);
      expect(received.length).toBe(2);
    });

    it('should apply message filters', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const received = [];
      broker.subscribe('events', async (msg) => received.push(msg), {
        filter: { source: 'user' },
      });

      // Should be filtered
      await broker.publish('events', { id: 1, source: 'admin', target: 'a' });
      expect(received.length).toBe(0);

      // Should pass filter
      await broker.publish('events', { id: 2, source: 'user', target: 'b' });
      expect(received.length).toBe(1);
    });

    it('should not deliver to paused subscriptions', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      const received = [];
      const sub = broker.subscribe('events', async (msg) => received.push(msg));
      broker.pause(sub.id);

      await broker.publish('events', { id: 1, source: 'test', target: 'item' });

      expect(received.length).toBe(0);
    });

    it('should include headers in message', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      let receivedHeaders = null;
      broker.subscribe('events', async (msg) => {
        receivedHeaders = msg.headers;
      });

      await broker.publish(
        'events',
        { id: 1, source: 'test', target: 'item' },
        { priority: 'high' }
      );

      expect(receivedHeaders).toEqual({ priority: 'high' });
    });

    it('should update topic message count', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      await broker.publish('events', { id: 1, source: 'a', target: 'b' });
      await broker.publish('events', { id: 2, source: 'c', target: 'd' });

      const topic = broker.getTopic('events');
      expect(topic.messageCount).toBe(2);
    });

    it('should return delivered and filtered counts', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');

      broker.subscribe('events', async () => {});
      broker.subscribe('events', async () => {}, {
        filter: { source: 'admin' },
      });

      const result = await broker.publish('events', {
        id: 1,
        source: 'user',
        target: 'a',
      });

      expect(result.delivered).toBe(1);
      expect(result.filtered).toBe(1);
    });

    it('should auto-create topic if enabled', async () => {
      const broker = new PubSubBroker({ autoCreateTopics: true });

      await broker.publish('new-topic', { id: 1, source: 'a', target: 'b' });

      expect(broker.getTopic('new-topic')).not.toBeUndefined();
    });
  });

  describe('publishMany', () => {
    it('should publish to multiple topics', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');
      broker.createTopic('logs');

      const receivedEvents = [];
      const receivedLogs = [];

      broker.subscribe('events', async (msg) => receivedEvents.push(msg));
      broker.subscribe('logs', async (msg) => receivedLogs.push(msg));

      const results = await broker.publishMany(['events', 'logs'], {
        id: 1,
        source: 'test',
        target: 'item',
      });

      expect(results.get('events').delivered).toBe(1);
      expect(results.get('logs').delivered).toBe(1);
      expect(receivedEvents.length).toBe(1);
      expect(receivedLogs.length).toBe(1);
    });
  });

  describe('getHistory', () => {
    it('should return message history when retention enabled', async () => {
      const broker = new PubSubBroker({ messageRetention: 60000 });
      broker.createTopic('events');

      await broker.publish('events', { id: 1, source: 'a', target: 'b' });
      await broker.publish('events', { id: 2, source: 'c', target: 'd' });

      const history = broker.getHistory('events');

      expect(history.length).toBe(2);
    });

    it('should return empty array when no retention', () => {
      const broker = new PubSubBroker({ messageRetention: 0 });
      broker.createTopic('events');

      const history = broker.getHistory('events');

      expect(history).toEqual([]);
    });

    it('should limit returned messages', async () => {
      const broker = new PubSubBroker({ messageRetention: 60000 });
      broker.createTopic('events');

      for (let i = 0; i < 10; i++) {
        await broker.publish('events', { id: i, source: 'a', target: 'b' });
      }

      const history = broker.getHistory('events', 5);

      expect(history.length).toBe(5);
    });
  });

  describe('getStats', () => {
    it('should return broker statistics', async () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');
      broker.subscribe('events', async () => {});

      await broker.publish('events', { id: 1, source: 'a', target: 'b' });

      const stats = broker.getStats();

      expect(stats.topics).toBe(1);
      expect(stats.subscriptions).toBe(1);
      expect(stats.published).toBe(1);
      expect(stats.delivered).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      const broker = new PubSubBroker();
      broker.createTopic('events');
      broker.subscribe('events', async () => {});

      broker.clear();

      const stats = broker.getStats();
      expect(stats.topics).toBe(0);
      expect(stats.subscriptions).toBe(0);
    });
  });
});

// =============================================================================
// ObservableQueue Tests
// =============================================================================

describe('ObservableQueue', () => {
  // Mock queue for testing
  const createMockQueue = () => ({
    name: 'test-queue',
    _items: [],
    async enqueue(link) {
      this._items.push(link);
      return { id: link.id, position: this._items.length - 1 };
    },
    async dequeue() {
      return this._items.shift() || null;
    },
    async peek() {
      return this._items[0] || null;
    },
    async acknowledge() {},
    async reject() {},
    getStats() {
      return {
        depth: this._items.length,
        enqueued: 0,
        dequeued: 0,
        acknowledged: 0,
        rejected: 0,
        inFlight: 0,
      };
    },
    getDepth() {
      return this._items.length;
    },
    async clear() {
      this._items = [];
    },
  });

  describe('constructor', () => {
    it('should wrap queue', () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      expect(observable.name).toBe('test-queue');
    });
  });

  describe('onEnqueue', () => {
    it('should notify on enqueue', async () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      const received = [];
      observable.onEnqueue(async (link) => received.push(link));

      await observable.enqueue({ id: 1, source: 'a', target: 'b' });

      expect(received.length).toBe(1);
      expect(received[0].id).toBe(1);
    });

    it('should return unsubscribe function', async () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      const received = [];
      const unsubscribe = observable.onEnqueue(async (link) =>
        received.push(link)
      );

      await observable.enqueue({ id: 1, source: 'a', target: 'b' });
      unsubscribe();
      await observable.enqueue({ id: 2, source: 'c', target: 'd' });

      expect(received.length).toBe(1);
    });
  });

  describe('onDequeue', () => {
    it('should notify on dequeue', async () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      const received = [];
      observable.onDequeue(async (link) => received.push(link));

      await observable.enqueue({ id: 1, source: 'a', target: 'b' });
      await observable.dequeue();

      expect(received.length).toBe(1);
      expect(received[0].id).toBe(1);
    });

    it('should not notify when queue is empty', async () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      const received = [];
      observable.onDequeue(async (link) => received.push(link));

      await observable.dequeue();

      expect(received.length).toBe(0);
    });
  });

  describe('onAcknowledge', () => {
    it('should notify on acknowledge', async () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      const received = [];
      observable.onAcknowledge(async (id) => received.push(id));

      await observable.acknowledge(42);

      expect(received.length).toBe(1);
      expect(received[0]).toBe(42);
    });
  });

  describe('onReject', () => {
    it('should notify on reject', async () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      const received = [];
      observable.onReject(async (id, requeue) =>
        received.push({ id, requeue })
      );

      await observable.reject(42, true);

      expect(received.length).toBe(1);
      expect(received[0].id).toBe(42);
      expect(received[0].requeue).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear queue and remove handlers', async () => {
      const mockQueue = createMockQueue();
      const observable = new ObservableQueue(mockQueue);

      const received = [];
      observable.onEnqueue(async (link) => received.push(link));

      await observable.enqueue({ id: 1, source: 'a', target: 'b' });
      await observable.clear();
      await observable.enqueue({ id: 2, source: 'c', target: 'd' });

      // Handler should have been cleared
      expect(received.length).toBe(1);
      expect(observable.getDepth()).toBe(1);
    });
  });
});

// =============================================================================
// QueueBackedPubSub Tests
// =============================================================================

describe('QueueBackedPubSub', () => {
  // Mock queue manager for testing
  const createMockQueueManager = () => {
    const queues = new Map();

    return {
      async createQueue(name) {
        const queue = {
          name,
          _items: [],
          async enqueue(link) {
            this._items.push(link);
            return { id: link.id, position: this._items.length - 1 };
          },
          async dequeue() {
            return this._items.shift() || null;
          },
          async acknowledge() {},
          async reject() {},
          getDepth() {
            return this._items.length;
          },
        };
        queues.set(name, queue);
        return queue;
      },
      async getQueue(name) {
        return queues.get(name) || null;
      },
      async deleteQueue(name) {
        return queues.delete(name);
      },
      queues,
    };
  };

  describe('createTopic', () => {
    it('should create a new topic', () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      const result = pubsub.createTopic('events');

      expect(result).toBe(true);
    });

    it('should return false for duplicate topic', () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      pubsub.createTopic('events');
      const result = pubsub.createTopic('events');

      expect(result).toBe(false);
    });
  });

  describe('deleteTopic', () => {
    it('should delete topic and subscriptions', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      pubsub.createTopic('events');
      await pubsub.subscribe('events', 'consumer1', async () => {});

      const result = await pubsub.deleteTopic('events');

      expect(result).toBe(true);
      expect(pubsub.listTopics().length).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('should create subscription with dedicated queue', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      const sub = await pubsub.subscribe('events', 'consumer1', async () => {});

      expect(sub.id).not.toBeUndefined();
      expect(sub.queueName).toBe('events-consumer1');
      expect(mockManager.queues.has('events-consumer1')).toBe(true);
    });

    it('should auto-create topic', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      await pubsub.subscribe('new-topic', 'consumer1', async () => {});

      expect(
        pubsub.listTopics().find((t) => t.name === 'new-topic')
      ).not.toBeUndefined();
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription and delete queue', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      const sub = await pubsub.subscribe('events', 'consumer1', async () => {});
      const result = await pubsub.unsubscribe(sub.id);

      expect(result).toBe(true);
      expect(mockManager.queues.has('events-consumer1')).toBe(false);
    });
  });

  describe('publish', () => {
    it('should enqueue to all subscriber queues', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      await pubsub.subscribe('events', 'consumer1', async () => {});
      await pubsub.subscribe('events', 'consumer2', async () => {});

      const count = await pubsub.publish('events', {
        id: 1,
        source: 'a',
        target: 'b',
      });

      expect(count).toBe(2);

      const queue1 = await mockManager.getQueue('events-consumer1');
      const queue2 = await mockManager.getQueue('events-consumer2');

      expect(queue1._items.length).toBe(1);
      expect(queue2._items.length).toBe(1);
    });

    it('should return 0 for empty topic', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      pubsub.createTopic('events');

      const count = await pubsub.publish('events', {
        id: 1,
        source: 'a',
        target: 'b',
      });

      expect(count).toBe(0);
    });
  });

  describe('startConsumer/stopConsumer', () => {
    it('should start and stop consumer', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      const sub = await pubsub.subscribe('events', 'consumer1', async () => {});
      await pubsub.startConsumer(sub.id);

      const subs = pubsub.listSubscriptions();
      expect(subs.find((s) => s.id === sub.id).active).toBe(true);

      pubsub.stopConsumer(sub.id);

      const subsAfter = pubsub.listSubscriptions();
      expect(subsAfter.find((s) => s.id === sub.id).active).toBe(false);
    });
  });

  describe('listTopics', () => {
    it('should list all topics with subscriber counts', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      await pubsub.subscribe('events', 'consumer1', async () => {});
      await pubsub.subscribe('events', 'consumer2', async () => {});
      await pubsub.subscribe('logs', 'consumer1', async () => {});

      const topics = pubsub.listTopics();

      expect(topics.length).toBe(2);
      expect(topics.find((t) => t.name === 'events').subscribers).toBe(2);
      expect(topics.find((t) => t.name === 'logs').subscribers).toBe(1);
    });
  });

  describe('listSubscriptions', () => {
    it('should list all subscriptions', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      await pubsub.subscribe('events', 'consumer1', async () => {});
      await pubsub.subscribe('logs', 'consumer1', async () => {});

      const subs = pubsub.listSubscriptions();

      expect(subs.length).toBe(2);
    });

    it('should filter by topic', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      await pubsub.subscribe('events', 'consumer1', async () => {});
      await pubsub.subscribe('events', 'consumer2', async () => {});
      await pubsub.subscribe('logs', 'consumer1', async () => {});

      const subs = pubsub.listSubscriptions('events');

      expect(subs.length).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all state', async () => {
      const mockManager = createMockQueueManager();
      const pubsub = new QueueBackedPubSub(mockManager);

      await pubsub.subscribe('events', 'consumer1', async () => {});
      await pubsub.subscribe('logs', 'consumer1', async () => {});

      await pubsub.clear();

      expect(pubsub.listTopics().length).toBe(0);
      expect(pubsub.listSubscriptions().length).toBe(0);
    });
  });
});
