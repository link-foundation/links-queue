/**
 * Test file for Rate Limiter module
 * Tests for sliding window, token bucket, and rate-limited queue
 */

import { describe, it, expect } from 'test-anywhere';
import {
  SlidingWindowCounter,
  TokenBucket,
  RateLimiter,
  RateLimitedQueue,
  RateLimitError,
} from '../src/features/rate-limiter.js';

// =============================================================================
// SlidingWindowCounter Tests
// =============================================================================

describe('SlidingWindowCounter', () => {
  describe('constructor', () => {
    it('should create counter with config', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });
      const stats = counter.getStats();

      expect(stats.max).toBe(10);
      expect(stats.windowMs).toBe(60000);
      expect(stats.currentCount).toBe(0);
      expect(stats.previousCount).toBe(0);
    });
  });

  describe('check', () => {
    it('should allow requests under the limit', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });

      const result = counter.check();

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
      expect(result.retryAfter).toBe(0);
    });

    it('should not increment counter on check', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });

      counter.check();
      counter.check();
      counter.check();

      const stats = counter.getStats();
      expect(stats.currentCount).toBe(0);
    });
  });

  describe('increment', () => {
    it('should increment counter', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });

      counter.increment();
      counter.increment();
      counter.increment();

      const stats = counter.getStats();
      expect(stats.currentCount).toBe(3);
    });

    it('should return updated state after increment', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });

      const result = counter.increment();

      expect(result.remaining).toBe(9);
    });
  });

  describe('consume', () => {
    it('should check and increment atomically', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });

      const result1 = counter.consume();
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(9);

      const result2 = counter.consume();
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(8);
    });

    it('should deny when limit reached', () => {
      const counter = new SlidingWindowCounter({ max: 2, window: 60000 });

      counter.consume();
      counter.consume();
      const result = counter.consume();

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should not increment when denied', () => {
      const counter = new SlidingWindowCounter({ max: 2, window: 60000 });

      counter.consume();
      counter.consume();
      counter.consume(); // Should be denied

      const stats = counter.getStats();
      expect(stats.currentCount).toBe(2);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });

      counter.consume();
      counter.consume();
      counter.consume();

      counter.reset();

      const stats = counter.getStats();
      expect(stats.currentCount).toBe(0);
      expect(stats.previousCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      const counter = new SlidingWindowCounter({ max: 10, window: 60000 });

      counter.consume();
      counter.consume();

      const stats = counter.getStats();

      expect(stats.currentCount).toBe(2);
      expect(stats.max).toBe(10);
      expect(stats.windowMs).toBe(60000);
      expect(typeof stats.weightedCount).toBe('number');
    });
  });
});

// =============================================================================
// TokenBucket Tests
// =============================================================================

describe('TokenBucket', () => {
  describe('constructor', () => {
    it('should create bucket with full capacity', () => {
      const bucket = new TokenBucket({ max: 10, window: 60000 });
      const stats = bucket.getStats();

      expect(stats.tokens).toBe(10);
      expect(stats.max).toBe(10);
    });
  });

  describe('check', () => {
    it('should allow when tokens available', () => {
      const bucket = new TokenBucket({ max: 10, window: 60000 });

      const result = bucket.check();

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });

    it('should not consume tokens on check', () => {
      const bucket = new TokenBucket({ max: 10, window: 60000 });

      bucket.check();
      bucket.check();

      const stats = bucket.getStats();
      expect(stats.tokens).toBe(10);
    });
  });

  describe('consume', () => {
    it('should consume one token', () => {
      const bucket = new TokenBucket({ max: 10, window: 60000 });

      const result = bucket.consume();

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('should deny when no tokens available', () => {
      const bucket = new TokenBucket({ max: 2, window: 60000 });

      bucket.consume();
      bucket.consume();
      const result = bucket.consume();

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should allow burst usage', () => {
      const bucket = new TokenBucket({ max: 5, window: 60000 });

      // Should allow all 5 quickly (burst)
      for (let i = 0; i < 5; i++) {
        const result = bucket.consume();
        expect(result.allowed).toBe(true);
      }

      // 6th should be denied
      const result = bucket.consume();
      expect(result.allowed).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset bucket to full', () => {
      const bucket = new TokenBucket({ max: 10, window: 60000 });

      bucket.consume();
      bucket.consume();
      bucket.consume();

      bucket.reset();

      const stats = bucket.getStats();
      expect(stats.tokens).toBe(10);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      const bucket = new TokenBucket({ max: 10, window: 60000 });

      bucket.consume();
      bucket.consume();

      const stats = bucket.getStats();

      expect(stats.tokens).toBe(8);
      expect(stats.max).toBe(10);
      expect(typeof stats.refillRate).toBe('number');
    });
  });
});

// =============================================================================
// RateLimiter Tests
// =============================================================================

describe('RateLimiter', () => {
  describe('constructor', () => {
    it('should create rate limiter with default algorithm', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });
      expect(limiter.keyCount).toBe(0);
      limiter.stop();
    });

    it('should create rate limiter with token-bucket algorithm', () => {
      const limiter = new RateLimiter({
        max: 10,
        window: 60000,
        algorithm: 'token-bucket',
      });
      expect(limiter.keyCount).toBe(0);
      limiter.stop();
    });
  });

  describe('check', () => {
    it('should check default key', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      const result = limiter.check();

      expect(result.allowed).toBe(true);
      limiter.stop();
    });

    it('should create limiter for key on first access', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      limiter.check('user:123');

      expect(limiter.keyCount).toBe(1);
      limiter.stop();
    });
  });

  describe('consume', () => {
    it('should consume for default key', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      const result = limiter.consume();

      expect(result.allowed).toBe(true);
      limiter.stop();
    });

    it('should track separate limits per key', () => {
      const limiter = new RateLimiter({ max: 2, window: 60000 });

      // Exhaust limit for key1
      limiter.consume('key1');
      limiter.consume('key1');
      const result1 = limiter.consume('key1');
      expect(result1.allowed).toBe(false);

      // key2 should still be allowed
      const result2 = limiter.consume('key2');
      expect(result2.allowed).toBe(true);

      limiter.stop();
    });
  });

  describe('reset', () => {
    it('should reset specific key', () => {
      const limiter = new RateLimiter({ max: 2, window: 60000 });

      limiter.consume('key1');
      limiter.consume('key1');

      limiter.reset('key1');

      const result = limiter.consume('key1');
      expect(result.allowed).toBe(true);

      limiter.stop();
    });
  });

  describe('resetAll', () => {
    it('should reset all keys', () => {
      const limiter = new RateLimiter({ max: 2, window: 60000 });

      limiter.consume('key1');
      limiter.consume('key1');
      limiter.consume('key2');
      limiter.consume('key2');

      limiter.resetAll();

      expect(limiter.consume('key1').allowed).toBe(true);
      expect(limiter.consume('key2').allowed).toBe(true);

      limiter.stop();
    });
  });

  describe('remove', () => {
    it('should remove specific key', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      limiter.consume('key1');
      expect(limiter.keyCount).toBe(1);

      limiter.remove('key1');
      expect(limiter.keyCount).toBe(0);

      limiter.stop();
    });
  });

  describe('getStats', () => {
    it('should return stats for key', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      limiter.consume('key1');
      limiter.consume('key1');

      const stats = limiter.getStats('key1');

      expect(stats).not.toBe(null);
      limiter.stop();
    });

    it('should return null for non-existent key', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      const stats = limiter.getStats('non-existent');

      expect(stats).toBe(null);
      limiter.stop();
    });
  });

  describe('listKeys', () => {
    it('should list all tracked keys', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      limiter.consume('key1');
      limiter.consume('key2');
      limiter.consume('key3');

      const keys = limiter.listKeys();

      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');

      limiter.stop();
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      const limiter = new RateLimiter({ max: 10, window: 60000 });

      limiter.consume('key1');
      limiter.consume('key2');

      limiter.clear();

      expect(limiter.keyCount).toBe(0);
    });
  });
});

// =============================================================================
// RateLimitedQueue Tests
// =============================================================================

describe('RateLimitedQueue', () => {
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
    it('should create rate-limited queue', () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 10,
        window: 60000,
      });

      expect(rateLimitedQueue.name).toBe('test-queue');
      rateLimitedQueue.stop();
    });
  });

  describe('enqueue', () => {
    it('should enqueue when under limit', async () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 10,
        window: 60000,
      });

      const link = { id: 1, source: 'test', target: 'item' };
      const result = await rateLimitedQueue.enqueue(link);

      expect(result.id).toBe(1);
      expect(mockQueue._items.length).toBe(1);

      rateLimitedQueue.stop();
    });

    it('should throw RateLimitError when limit exceeded', async () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 2,
        window: 60000,
      });

      await rateLimitedQueue.enqueue({ id: 1, source: 'a', target: 'b' });
      await rateLimitedQueue.enqueue({ id: 2, source: 'c', target: 'd' });

      let caught = false;
      try {
        await rateLimitedQueue.enqueue({ id: 3, source: 'e', target: 'f' });
      } catch (error) {
        caught = true;
        expect(error instanceof RateLimitError).toBe(true);
        expect(error.code).toBe('RATE_LIMITED');
        expect(error.retryAfter).toBeGreaterThanOrEqual(0);
      }

      expect(caught).toBe(true);
      rateLimitedQueue.stop();
    });
  });

  describe('dequeue', () => {
    it('should dequeue when under limit', async () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 10,
        window: 60000,
      });

      const link = { id: 1, source: 'test', target: 'item' };
      await rateLimitedQueue.enqueue(link);

      const result = await rateLimitedQueue.dequeue();

      expect(result).toEqual(link);
      rateLimitedQueue.stop();
    });

    it('should apply per-consumer rate limit', async () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 2,
        window: 60000,
      });

      await rateLimitedQueue.enqueue({ id: 1, source: 'a', target: 'b' });
      await rateLimitedQueue.enqueue({ id: 2, source: 'c', target: 'd' });

      // Reset enqueue limiter to allow fresh dequeue test
      await rateLimitedQueue.clear();
      await rateLimitedQueue.enqueue({ id: 1, source: 'a', target: 'b' });
      await rateLimitedQueue.enqueue({ id: 2, source: 'c', target: 'd' });

      await rateLimitedQueue.dequeue('consumer1');
      await rateLimitedQueue.dequeue('consumer1');

      let caught = false;
      try {
        await rateLimitedQueue.dequeue('consumer1');
      } catch (error) {
        caught = true;
        expect(error instanceof RateLimitError).toBe(true);
      }

      expect(caught).toBe(true);
      rateLimitedQueue.stop();
    });
  });

  describe('peek', () => {
    it('should not be rate limited', async () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 1,
        window: 60000,
      });

      await rateLimitedQueue.enqueue({ id: 1, source: 'a', target: 'b' });

      // Peek multiple times should not throw
      await rateLimitedQueue.peek();
      await rateLimitedQueue.peek();
      await rateLimitedQueue.peek();

      rateLimitedQueue.stop();
    });
  });

  describe('getStats', () => {
    it('should include rate limit info in stats', async () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 10,
        window: 60000,
      });

      await rateLimitedQueue.enqueue({ id: 1, source: 'a', target: 'b' });

      const stats = rateLimitedQueue.getStats();

      expect(stats.depth).toBe(1);
      expect(stats.rateLimit).not.toBeUndefined();
      expect(stats.rateLimit.enqueue).not.toBeUndefined();
      expect(stats.rateLimit.dequeue).not.toBeUndefined();

      rateLimitedQueue.stop();
    });
  });

  describe('clear', () => {
    it('should reset rate limiters and clear queue', async () => {
      const mockQueue = createMockQueue();
      const rateLimitedQueue = new RateLimitedQueue(mockQueue, {
        max: 2,
        window: 60000,
      });

      await rateLimitedQueue.enqueue({ id: 1, source: 'a', target: 'b' });
      await rateLimitedQueue.enqueue({ id: 2, source: 'c', target: 'd' });

      await rateLimitedQueue.clear();

      // Should be able to enqueue again
      await rateLimitedQueue.enqueue({ id: 3, source: 'e', target: 'f' });
      await rateLimitedQueue.enqueue({ id: 4, source: 'g', target: 'h' });

      expect(rateLimitedQueue.getDepth()).toBe(2);

      rateLimitedQueue.stop();
    });
  });
});

// =============================================================================
// RateLimitError Tests
// =============================================================================

describe('RateLimitError', () => {
  it('should create error with all properties', () => {
    const error = new RateLimitError('Rate limit exceeded', 5000, {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfter: 5000,
    });

    expect(error.name).toBe('RateLimitError');
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toBe('Rate limit exceeded');
    expect(error.retryAfter).toBe(5000);
    expect(error.remaining).toBe(0);
    expect(error.resetAt).toBeGreaterThan(Date.now());
  });

  it('should be an instance of Error', () => {
    const error = new RateLimitError('Test', 0, {
      allowed: false,
      remaining: 0,
      resetAt: Date.now(),
      retryAfter: 0,
    });

    expect(error instanceof Error).toBe(true);
  });
});
