/**
 * Test file for Router module
 * Tests for topic routing, exchanges, and pattern matching
 */

import { describe, it, expect } from 'test-anywhere';
import {
  ExchangeType,
  TopicMatcher,
  DirectExchange,
  TopicExchange,
  FanoutExchange,
  HeadersExchange,
  Router,
  RoutedQueueManager,
} from '../src/features/router.js';

// =============================================================================
// ExchangeType Tests
// =============================================================================

describe('ExchangeType', () => {
  it('should define all exchange types', () => {
    expect(ExchangeType.DIRECT).toBe('direct');
    expect(ExchangeType.TOPIC).toBe('topic');
    expect(ExchangeType.FANOUT).toBe('fanout');
    expect(ExchangeType.HEADERS).toBe('headers');
  });

  it('should be frozen', () => {
    expect(Object.isFrozen(ExchangeType)).toBe(true);
  });
});

// =============================================================================
// TopicMatcher Tests
// =============================================================================

describe('TopicMatcher', () => {
  describe('matches', () => {
    it('should match exact routing key', () => {
      expect(TopicMatcher.matches('logs.error', 'logs.error')).toBe(true);
      expect(TopicMatcher.matches('logs.error', 'logs.info')).toBe(false);
    });

    it('should match single-word wildcard (*)', () => {
      expect(TopicMatcher.matches('logs.*', 'logs.error')).toBe(true);
      expect(TopicMatcher.matches('logs.*', 'logs.info')).toBe(true);
      expect(TopicMatcher.matches('logs.*', 'logs.error.db')).toBe(false);
      expect(TopicMatcher.matches('*.error', 'logs.error')).toBe(true);
      expect(TopicMatcher.matches('*.error', 'app.error')).toBe(true);
    });

    it('should match multi-word wildcard (#)', () => {
      // logs.# matches logs followed by zero or more .word sequences
      expect(TopicMatcher.matches('logs.#', 'logs')).toBe(true);
      expect(TopicMatcher.matches('logs.#', 'logs.error')).toBe(true);
      expect(TopicMatcher.matches('logs.#', 'logs.error.db')).toBe(true);
      expect(TopicMatcher.matches('logs.#', 'logs.a.b.c.d')).toBe(true);
    });

    it('should match # at beginning', () => {
      // #.error matches zero or more words followed by .error
      expect(TopicMatcher.matches('#.error', 'error')).toBe(true);
      expect(TopicMatcher.matches('#.error', 'logs.error')).toBe(true);
      expect(TopicMatcher.matches('#.error', 'a.b.c.error')).toBe(true);
    });

    it('should match # alone', () => {
      expect(TopicMatcher.matches('#', 'anything')).toBe(true);
      expect(TopicMatcher.matches('#', 'a.b.c')).toBe(true);
    });

    it('should handle complex patterns', () => {
      expect(TopicMatcher.matches('*.system.*', 'app.system.startup')).toBe(
        true
      );
      expect(TopicMatcher.matches('*.system.*', 'db.system.shutdown')).toBe(
        true
      );
      expect(TopicMatcher.matches('*.system.*', 'system.startup')).toBe(false);
    });
  });

  describe('specificity', () => {
    it('should score exact matches highest', () => {
      const exactScore = TopicMatcher.specificity('logs.error.db');
      const wildcardScore = TopicMatcher.specificity('logs.*.db');
      const hashScore = TopicMatcher.specificity('logs.#');

      expect(exactScore).toBeGreaterThan(wildcardScore);
      expect(wildcardScore).toBeGreaterThan(hashScore);
    });

    it('should give # lowest specificity', () => {
      const score = TopicMatcher.specificity('#');
      expect(score).toBe(1);
    });

    it('should give * medium specificity', () => {
      const score = TopicMatcher.specificity('*');
      expect(score).toBe(10);
    });

    it('should give exact word highest specificity', () => {
      const score = TopicMatcher.specificity('logs');
      expect(score).toBe(100);
    });
  });
});

// =============================================================================
// DirectExchange Tests
// =============================================================================

describe('DirectExchange', () => {
  describe('constructor', () => {
    it('should create exchange with name and type', () => {
      const exchange = new DirectExchange('logs');

      expect(exchange.name).toBe('logs');
      expect(exchange.type).toBe(ExchangeType.DIRECT);
    });
  });

  describe('bind', () => {
    it('should bind queue with routing key', () => {
      const exchange = new DirectExchange('logs');

      const binding = exchange.bind('errors-queue', 'error');

      expect(binding.exchange).toBe('logs');
      expect(binding.queue).toBe('errors-queue');
      expect(binding.routingKey).toBe('error');
    });

    it('should support multiple queues for same routing key', () => {
      const exchange = new DirectExchange('logs');

      exchange.bind('queue1', 'error');
      exchange.bind('queue2', 'error');

      const queues = exchange.route('error');
      expect(queues).toContain('queue1');
      expect(queues).toContain('queue2');
    });
  });

  describe('unbind', () => {
    it('should unbind queue from routing key', () => {
      const exchange = new DirectExchange('logs');

      exchange.bind('errors-queue', 'error');
      const result = exchange.unbind('errors-queue', 'error');

      expect(result).toBe(true);
      expect(exchange.route('error')).toEqual([]);
    });

    it('should return false for non-existent binding', () => {
      const exchange = new DirectExchange('logs');

      const result = exchange.unbind('non-existent', 'error');

      expect(result).toBe(false);
    });
  });

  describe('route', () => {
    it('should route to exact match', () => {
      const exchange = new DirectExchange('logs');

      exchange.bind('errors-queue', 'error');
      exchange.bind('info-queue', 'info');

      expect(exchange.route('error')).toEqual(['errors-queue']);
      expect(exchange.route('info')).toEqual(['info-queue']);
    });

    it('should return empty array for no match', () => {
      const exchange = new DirectExchange('logs');

      exchange.bind('errors-queue', 'error');

      expect(exchange.route('warning')).toEqual([]);
    });
  });

  describe('getBindings', () => {
    it('should return all bindings', () => {
      const exchange = new DirectExchange('logs');

      exchange.bind('errors-queue', 'error');
      exchange.bind('info-queue', 'info');

      const bindings = exchange.getBindings();
      expect(bindings.length).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all bindings', () => {
      const exchange = new DirectExchange('logs');

      exchange.bind('errors-queue', 'error');
      exchange.bind('info-queue', 'info');

      exchange.clear();

      expect(exchange.getBindings().length).toBe(0);
    });
  });
});

// =============================================================================
// TopicExchange Tests
// =============================================================================

describe('TopicExchange', () => {
  describe('constructor', () => {
    it('should create exchange with name and type', () => {
      const exchange = new TopicExchange('events');

      expect(exchange.name).toBe('events');
      expect(exchange.type).toBe(ExchangeType.TOPIC);
    });
  });

  describe('bind', () => {
    it('should bind queue with pattern', () => {
      const exchange = new TopicExchange('events');

      const binding = exchange.bind('all-logs', 'logs.#');

      expect(binding.exchange).toBe('events');
      expect(binding.queue).toBe('all-logs');
      expect(binding.routingKey).toBe('logs.#');
    });
  });

  describe('unbind', () => {
    it('should unbind queue from pattern', () => {
      const exchange = new TopicExchange('events');

      exchange.bind('all-logs', 'logs.#');
      const result = exchange.unbind('all-logs', 'logs.#');

      expect(result).toBe(true);
      expect(exchange.route('logs.error')).toEqual([]);
    });
  });

  describe('route', () => {
    it('should route using wildcard patterns', () => {
      const exchange = new TopicExchange('events');

      exchange.bind('all-logs', 'logs.#');
      exchange.bind('errors-only', 'logs.error');

      const queues = exchange.route('logs.error');
      expect(queues).toContain('all-logs');
      expect(queues).toContain('errors-only');
    });

    it('should deduplicate queues', () => {
      const exchange = new TopicExchange('events');

      // Same queue with different patterns
      exchange.bind('my-queue', 'logs.#');
      exchange.bind('my-queue', 'logs.error');

      const queues = exchange.route('logs.error');
      expect(queues.length).toBe(1);
      expect(queues[0]).toBe('my-queue');
    });

    it('should match complex patterns', () => {
      const exchange = new TopicExchange('events');

      exchange.bind('system-queue', '*.system.*');

      expect(exchange.route('app.system.startup')).toEqual(['system-queue']);
      expect(exchange.route('db.system.shutdown')).toEqual(['system-queue']);
      expect(exchange.route('system.startup')).toEqual([]);
    });
  });
});

// =============================================================================
// FanoutExchange Tests
// =============================================================================

describe('FanoutExchange', () => {
  describe('constructor', () => {
    it('should create exchange with name and type', () => {
      const exchange = new FanoutExchange('notifications');

      expect(exchange.name).toBe('notifications');
      expect(exchange.type).toBe(ExchangeType.FANOUT);
    });
  });

  describe('bind', () => {
    it('should bind queue (routing key ignored)', () => {
      const exchange = new FanoutExchange('notifications');

      const binding = exchange.bind('email-queue');

      expect(binding.exchange).toBe('notifications');
      expect(binding.queue).toBe('email-queue');
      expect(binding.routingKey).toBe('');
    });
  });

  describe('unbind', () => {
    it('should unbind queue', () => {
      const exchange = new FanoutExchange('notifications');

      exchange.bind('email-queue');
      const result = exchange.unbind('email-queue');

      expect(result).toBe(true);
      expect(exchange.route()).toEqual([]);
    });
  });

  describe('route', () => {
    it('should route to all bound queues', () => {
      const exchange = new FanoutExchange('notifications');

      exchange.bind('email-queue');
      exchange.bind('sms-queue');
      exchange.bind('push-queue');

      const queues = exchange.route();

      expect(queues).toContain('email-queue');
      expect(queues).toContain('sms-queue');
      expect(queues).toContain('push-queue');
      expect(queues.length).toBe(3);
    });
  });
});

// =============================================================================
// HeadersExchange Tests
// =============================================================================

describe('HeadersExchange', () => {
  describe('constructor', () => {
    it('should create exchange with name and type', () => {
      const exchange = new HeadersExchange('tasks');

      expect(exchange.name).toBe('tasks');
      expect(exchange.type).toBe(ExchangeType.HEADERS);
    });
  });

  describe('bind', () => {
    it('should bind queue with headers (match all)', () => {
      const exchange = new HeadersExchange('tasks');

      const binding = exchange.bind(
        'high-priority',
        { priority: 'high' },
        'all'
      );

      expect(binding.exchange).toBe('tasks');
      expect(binding.queue).toBe('high-priority');
      expect(binding.arguments.headers.priority).toBe('high');
      expect(binding.arguments.matchType).toBe('all');
    });

    it('should default to match all', () => {
      const exchange = new HeadersExchange('tasks');

      exchange.bind('queue', { type: 'system' });
      const bindings = exchange.getBindings();

      expect(bindings[0].arguments.matchType).toBe('all');
    });
  });

  describe('unbind', () => {
    it('should unbind queue', () => {
      const exchange = new HeadersExchange('tasks');

      exchange.bind('high-priority', { priority: 'high' });
      const result = exchange.unbind('high-priority', { priority: 'high' });

      expect(result).toBe(true);
      expect(exchange.route({ priority: 'high' })).toEqual([]);
    });
  });

  describe('route', () => {
    it('should route with match all', () => {
      const exchange = new HeadersExchange('tasks');

      exchange.bind(
        'urgent-system',
        { priority: 'high', type: 'system' },
        'all'
      );

      expect(exchange.route({ priority: 'high', type: 'system' })).toEqual([
        'urgent-system',
      ]);
      expect(exchange.route({ priority: 'high' })).toEqual([]);
      expect(exchange.route({ type: 'system' })).toEqual([]);
    });

    it('should route with match any', () => {
      const exchange = new HeadersExchange('tasks');

      exchange.bind('special', { priority: 'high', type: 'system' }, 'any');

      expect(exchange.route({ priority: 'high' })).toEqual(['special']);
      expect(exchange.route({ type: 'system' })).toEqual(['special']);
      expect(exchange.route({ priority: 'low' })).toEqual([]);
    });

    it('should handle multiple bindings', () => {
      const exchange = new HeadersExchange('tasks');

      exchange.bind('high-priority', { priority: 'high' }, 'all');
      exchange.bind('system-tasks', { type: 'system' }, 'all');

      const queues = exchange.route({ priority: 'high', type: 'system' });
      expect(queues).toContain('high-priority');
      expect(queues).toContain('system-tasks');
    });
  });
});

// =============================================================================
// Router Tests
// =============================================================================

describe('Router', () => {
  describe('declareExchange', () => {
    it('should create direct exchange', () => {
      const router = new Router();

      const exchange = router.declareExchange('logs', 'direct');

      expect(exchange.type).toBe('direct');
    });

    it('should create topic exchange', () => {
      const router = new Router();

      const exchange = router.declareExchange('events', 'topic');

      expect(exchange.type).toBe('topic');
    });

    it('should create fanout exchange', () => {
      const router = new Router();

      const exchange = router.declareExchange('notifications', 'fanout');

      expect(exchange.type).toBe('fanout');
    });

    it('should create headers exchange', () => {
      const router = new Router();

      const exchange = router.declareExchange('tasks', 'headers');

      expect(exchange.type).toBe('headers');
    });

    it('should return existing exchange with same type', () => {
      const router = new Router();

      const exchange1 = router.declareExchange('logs', 'direct');
      const exchange2 = router.declareExchange('logs', 'direct');

      expect(exchange1).toBe(exchange2);
    });

    it('should throw when redeclaring with different type', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');

      expect(() => router.declareExchange('logs', 'topic')).toThrow();
    });

    it('should throw for unknown type', () => {
      const router = new Router();

      expect(() => router.declareExchange('logs', 'invalid')).toThrow();
    });
  });

  describe('getExchange', () => {
    it('should return exchange by name', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      const exchange = router.getExchange('logs');

      expect(exchange).not.toBeUndefined();
      expect(exchange.name).toBe('logs');
    });

    it('should return undefined for non-existent exchange', () => {
      const router = new Router();

      const exchange = router.getExchange('non-existent');

      expect(exchange).toBeUndefined();
    });
  });

  describe('deleteExchange', () => {
    it('should delete exchange', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      const result = router.deleteExchange('logs');

      expect(result).toBe(true);
      expect(router.getExchange('logs')).toBeUndefined();
    });

    it('should return false for non-existent exchange', () => {
      const router = new Router();

      const result = router.deleteExchange('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('bind/unbind', () => {
    it('should bind queue to direct exchange', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      const binding = router.bind('logs', 'errors-queue', 'error');

      expect(binding.queue).toBe('errors-queue');
      expect(binding.routingKey).toBe('error');
    });

    it('should bind queue to topic exchange', () => {
      const router = new Router();

      router.declareExchange('events', 'topic');
      const binding = router.bind('events', 'all-logs', 'logs.#');

      expect(binding.routingKey).toBe('logs.#');
    });

    it('should bind queue to fanout exchange', () => {
      const router = new Router();

      router.declareExchange('notifications', 'fanout');
      const binding = router.bind('notifications', 'email-queue');

      expect(binding.queue).toBe('email-queue');
    });

    it('should bind queue to headers exchange', () => {
      const router = new Router();

      router.declareExchange('tasks', 'headers');
      const binding = router.bind('tasks', 'high-priority', '', {
        headers: { priority: 'high' },
        matchType: 'all',
      });

      expect(binding.arguments.headers.priority).toBe('high');
    });

    it('should throw when binding to non-existent exchange', () => {
      const router = new Router();

      expect(() => router.bind('non-existent', 'queue', 'key')).toThrow();
    });

    it('should unbind queue', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      router.bind('logs', 'errors-queue', 'error');

      const result = router.unbind('logs', 'errors-queue', 'error');

      expect(result).toBe(true);
    });
  });

  describe('route', () => {
    it('should route through direct exchange', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      router.bind('logs', 'errors-queue', 'error');

      const queues = router.route('logs', 'error');

      expect(queues).toEqual(['errors-queue']);
    });

    it('should route through topic exchange', () => {
      const router = new Router();

      router.declareExchange('events', 'topic');
      router.bind('events', 'all-logs', 'logs.#');

      const queues = router.route('events', 'logs.error.db');

      expect(queues).toEqual(['all-logs']);
    });

    it('should route through fanout exchange', () => {
      const router = new Router();

      router.declareExchange('notifications', 'fanout');
      router.bind('notifications', 'email-queue');
      router.bind('notifications', 'sms-queue');

      const queues = router.route('notifications');

      expect(queues).toContain('email-queue');
      expect(queues).toContain('sms-queue');
    });

    it('should route through headers exchange', () => {
      const router = new Router();

      router.declareExchange('tasks', 'headers');
      router.bind('tasks', 'high-priority', '', {
        headers: { priority: 'high' },
      });

      const queues = router.route('tasks', '', { priority: 'high' });

      expect(queues).toEqual(['high-priority']);
    });

    it('should return empty array for non-existent exchange', () => {
      const router = new Router();

      const queues = router.route('non-existent', 'key');

      expect(queues).toEqual([]);
    });
  });

  describe('listExchanges', () => {
    it('should list all exchanges', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      router.declareExchange('events', 'topic');

      const exchanges = router.listExchanges();

      expect(exchanges.length).toBe(2);
      expect(exchanges.find((e) => e.name === 'logs')).not.toBeUndefined();
      expect(exchanges.find((e) => e.name === 'events')).not.toBeUndefined();
    });

    it('should include binding count', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      router.bind('logs', 'queue1', 'key1');
      router.bind('logs', 'queue2', 'key2');

      const exchanges = router.listExchanges();

      expect(exchanges.find((e) => e.name === 'logs').bindings).toBe(2);
    });
  });

  describe('getBindings', () => {
    it('should return bindings for exchange', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      router.bind('logs', 'queue1', 'key1');
      router.bind('logs', 'queue2', 'key2');

      const bindings = router.getBindings('logs');

      expect(bindings.length).toBe(2);
    });

    it('should return empty array for non-existent exchange', () => {
      const router = new Router();

      const bindings = router.getBindings('non-existent');

      expect(bindings).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all exchanges', () => {
      const router = new Router();

      router.declareExchange('logs', 'direct');
      router.declareExchange('events', 'topic');
      router.bind('logs', 'queue', 'key');

      router.clear();

      expect(router.listExchanges().length).toBe(0);
    });
  });
});

// =============================================================================
// RoutedQueueManager Tests
// =============================================================================

describe('RoutedQueueManager', () => {
  // Mock queue manager for testing
  const createMockQueueManager = () => {
    const queues = new Map();

    return {
      async createQueue(name, options = {}) {
        const queue = {
          name,
          options,
          _items: [],
          async enqueue(link) {
            this._items.push(link);
            return { id: link.id, position: this._items.length - 1 };
          },
          async dequeue() {
            return this._items.shift() || null;
          },
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
      async listQueues() {
        return [...queues.values()].map((q) => ({
          name: q.name,
          depth: q._items.length,
        }));
      },
    };
  };

  describe('createQueue', () => {
    it('should create queue and register with router', async () => {
      const mockManager = createMockQueueManager();
      const routedManager = new RoutedQueueManager(mockManager);

      const queue = await routedManager.createQueue('tasks');

      expect(queue.name).toBe('tasks');
    });
  });

  describe('declareExchange', () => {
    it('should delegate to router', () => {
      const mockManager = createMockQueueManager();
      const routedManager = new RoutedQueueManager(mockManager);

      const exchange = routedManager.declareExchange('logs', 'topic');

      expect(exchange.type).toBe('topic');
    });
  });

  describe('bindTopic', () => {
    it('should bind topic pattern', async () => {
      const mockManager = createMockQueueManager();
      const routedManager = new RoutedQueueManager(mockManager);

      await routedManager.createQueue('all-logs');
      routedManager.declareExchange('logs', 'topic');

      const binding = routedManager.bindTopic('logs', 'all-logs', 'logs.#');

      expect(binding.routingKey).toBe('logs.#');
    });
  });

  describe('publish', () => {
    it('should route message to matching queues', async () => {
      const mockManager = createMockQueueManager();
      const routedManager = new RoutedQueueManager(mockManager);

      await routedManager.createQueue('errors');
      await routedManager.createQueue('all-logs');
      routedManager.declareExchange('logs', 'topic');
      routedManager.bindTopic('logs', 'errors', 'logs.error');
      routedManager.bindTopic('logs', 'all-logs', 'logs.#');

      const link = { id: 1, source: 'test', target: 'item' };
      const queues = await routedManager.publish('logs', link, 'logs.error');

      expect(queues).toContain('errors');
      expect(queues).toContain('all-logs');

      const errorsQueue = await routedManager.getQueue('errors');
      const allLogsQueue = await routedManager.getQueue('all-logs');

      expect(errorsQueue._items.length).toBe(1);
      expect(allLogsQueue._items.length).toBe(1);
    });

    it('should return empty array for no matches', async () => {
      const mockManager = createMockQueueManager();
      const routedManager = new RoutedQueueManager(mockManager);

      routedManager.declareExchange('logs', 'topic');

      const queues = await routedManager.publish(
        'logs',
        { id: 1, source: 'a', target: 'b' },
        'no.match'
      );

      expect(queues).toEqual([]);
    });
  });

  describe('fanout', () => {
    it('should set up fanout routing', async () => {
      const mockManager = createMockQueueManager();
      const routedManager = new RoutedQueueManager(mockManager);

      await routedManager.createQueue('email');
      await routedManager.createQueue('sms');
      await routedManager.createQueue('push');

      routedManager.fanout('notifications', ['email', 'sms', 'push']);

      const link = { id: 1, source: 'test', target: 'item' };
      const queues = await routedManager.publish('notifications', link);

      expect(queues).toContain('email');
      expect(queues).toContain('sms');
      expect(queues).toContain('push');
    });
  });

  describe('getRouter', () => {
    it('should return the router', () => {
      const mockManager = createMockQueueManager();
      const routedManager = new RoutedQueueManager(mockManager);

      const router = routedManager.getRouter();

      expect(router instanceof Router).toBe(true);
    });
  });
});
