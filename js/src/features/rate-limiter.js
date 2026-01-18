/**
 * Rate limiting module for links-queue.
 *
 * This module provides rate limiting features for queue operations:
 * - Per-queue rate limits
 * - Per-consumer rate limits
 * - Sliding window algorithm
 * - Backpressure signaling
 *
 * @module features/rate-limiter
 *
 * @see REQUIREMENTS.md - Feature Parity with Competitors
 * @see ROADMAP.md - Phase 7: Advanced Features
 */

// =============================================================================
// Rate Limit Configuration
// =============================================================================

/**
 * Configuration for rate limiting.
 *
 * @typedef {Object} RateLimitConfig
 * @property {number} max - Maximum number of operations allowed
 * @property {number} window - Time window in milliseconds
 * @property {string} [key] - Optional key for per-key rate limiting
 */

// =============================================================================
// Rate Limit Result
// =============================================================================

/**
 * Result of a rate limit check.
 *
 * @typedef {Object} RateLimitResult
 * @property {boolean} allowed - Whether the operation is allowed
 * @property {number} remaining - Number of operations remaining in the window
 * @property {number} resetAt - Timestamp when the window resets
 * @property {number} retryAfter - Milliseconds to wait before retrying (0 if allowed)
 */

// =============================================================================
// Sliding Window Counter
// =============================================================================

/**
 * Implements a sliding window rate limiter.
 *
 * Uses a sliding window algorithm that provides smoother rate limiting
 * compared to fixed windows by interpolating between the previous and
 * current window counts.
 *
 * @example
 * const limiter = new SlidingWindowCounter({
 *   max: 100,
 *   window: 60000 // 1 minute
 * });
 *
 * const result = limiter.check();
 * if (result.allowed) {
 *   limiter.increment();
 *   // Perform operation
 * } else {
 *   // Wait retryAfter milliseconds
 * }
 */
export class SlidingWindowCounter {
  /**
   * Creates a new SlidingWindowCounter.
   *
   * @param {RateLimitConfig} config - Rate limit configuration
   */
  constructor(config) {
    /**
     * Maximum allowed operations per window.
     * @type {number}
     * @private
     */
    this._max = config.max;

    /**
     * Window size in milliseconds.
     * @type {number}
     * @private
     */
    this._windowMs = config.window;

    /**
     * Count in the previous window.
     * @type {number}
     * @private
     */
    this._previousCount = 0;

    /**
     * Count in the current window.
     * @type {number}
     * @private
     */
    this._currentCount = 0;

    /**
     * Start time of the current window.
     * @type {number}
     * @private
     */
    this._windowStart = Date.now();
  }

  /**
   * Updates the window if necessary.
   *
   * @private
   */
  _updateWindow() {
    const now = Date.now();
    const elapsed = now - this._windowStart;

    if (elapsed >= this._windowMs) {
      // Window has fully elapsed
      const windowsElapsed = Math.floor(elapsed / this._windowMs);

      if (windowsElapsed >= 2) {
        // More than one full window has passed
        this._previousCount = 0;
        this._currentCount = 0;
      } else {
        // Exactly one window has passed
        this._previousCount = this._currentCount;
        this._currentCount = 0;
      }

      this._windowStart = now - (elapsed % this._windowMs);
    }
  }

  /**
   * Calculates the weighted count using sliding window interpolation.
   *
   * @returns {number} The effective count
   * @private
   */
  _getWeightedCount() {
    this._updateWindow();

    const now = Date.now();
    const elapsed = now - this._windowStart;
    const weight = elapsed / this._windowMs;

    // Sliding window: count = current + previous * (1 - weight)
    return this._currentCount + this._previousCount * (1 - weight);
  }

  /**
   * Checks if an operation is allowed.
   *
   * @returns {RateLimitResult} The rate limit check result
   */
  check() {
    const count = this._getWeightedCount();
    const allowed = count < this._max;
    const remaining = Math.max(0, Math.floor(this._max - count));
    const resetAt = this._windowStart + this._windowMs;

    let retryAfter = 0;
    if (!allowed) {
      // Calculate when we'll be under the limit
      // We need to wait until enough of the previous window has "expired"
      const excess = count - this._max + 1;
      const timeToExpire = (excess / this._previousCount) * this._windowMs;
      retryAfter = Math.max(0, Math.ceil(timeToExpire));
    }

    return { allowed, remaining, resetAt, retryAfter };
  }

  /**
   * Increments the counter (use after operation is performed).
   *
   * @returns {RateLimitResult} The updated rate limit state
   */
  increment() {
    this._updateWindow();
    this._currentCount++;
    return this.check();
  }

  /**
   * Checks and increments in one operation.
   *
   * @returns {RateLimitResult} The rate limit result
   */
  consume() {
    const result = this.check();
    if (result.allowed) {
      this._currentCount++;
      result.remaining = Math.max(0, result.remaining - 1);
    }
    return result;
  }

  /**
   * Resets the counter.
   */
  reset() {
    this._previousCount = 0;
    this._currentCount = 0;
    this._windowStart = Date.now();
  }

  /**
   * Gets current statistics.
   *
   * @returns {{currentCount: number, previousCount: number, weightedCount: number, max: number, windowMs: number}}
   */
  getStats() {
    return {
      currentCount: this._currentCount,
      previousCount: this._previousCount,
      weightedCount: this._getWeightedCount(),
      max: this._max,
      windowMs: this._windowMs,
    };
  }
}

// =============================================================================
// Token Bucket Rate Limiter
// =============================================================================

/**
 * Implements a token bucket rate limiter.
 *
 * Tokens are added at a constant rate. Each operation consumes one token.
 * This provides burst capacity while maintaining an average rate limit.
 *
 * @example
 * const limiter = new TokenBucket({
 *   max: 100,      // Bucket capacity
 *   window: 60000  // Refill time for all tokens
 * });
 *
 * if (limiter.consume().allowed) {
 *   // Perform operation
 * }
 */
export class TokenBucket {
  /**
   * Creates a new TokenBucket.
   *
   * @param {RateLimitConfig} config - Rate limit configuration
   */
  constructor(config) {
    /**
     * Maximum tokens (bucket capacity).
     * @type {number}
     * @private
     */
    this._max = config.max;

    /**
     * Current number of tokens.
     * @type {number}
     * @private
     */
    this._tokens = config.max;

    /**
     * Tokens added per millisecond.
     * @type {number}
     * @private
     */
    this._refillRate = config.max / config.window;

    /**
     * Last refill timestamp.
     * @type {number}
     * @private
     */
    this._lastRefill = Date.now();

    /**
     * Window size in milliseconds.
     * @type {number}
     * @private
     */
    this._windowMs = config.window;
  }

  /**
   * Refills tokens based on elapsed time.
   *
   * @private
   */
  _refill() {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    const tokensToAdd = elapsed * this._refillRate;

    this._tokens = Math.min(this._max, this._tokens + tokensToAdd);
    this._lastRefill = now;
  }

  /**
   * Checks if an operation is allowed.
   *
   * @returns {RateLimitResult} The rate limit check result
   */
  check() {
    this._refill();

    const allowed = this._tokens >= 1;
    const remaining = Math.floor(this._tokens);
    const resetAt = this._lastRefill + this._windowMs;

    let retryAfter = 0;
    if (!allowed) {
      // Calculate time to get at least 1 token
      retryAfter = Math.ceil((1 - this._tokens) / this._refillRate);
    }

    return { allowed, remaining, resetAt, retryAfter };
  }

  /**
   * Consumes a token if available.
   *
   * @returns {RateLimitResult} The rate limit result
   */
  consume() {
    this._refill();

    if (this._tokens >= 1) {
      this._tokens--;
      return {
        allowed: true,
        remaining: Math.floor(this._tokens),
        resetAt: this._lastRefill + this._windowMs,
        retryAfter: 0,
      };
    }

    return this.check();
  }

  /**
   * Resets the bucket to full.
   */
  reset() {
    this._tokens = this._max;
    this._lastRefill = Date.now();
  }

  /**
   * Gets current statistics.
   *
   * @returns {{tokens: number, max: number, refillRate: number}}
   */
  getStats() {
    this._refill();
    return {
      tokens: this._tokens,
      max: this._max,
      refillRate: this._refillRate,
    };
  }
}

// =============================================================================
// Rate Limiter (Multi-key)
// =============================================================================

/**
 * A rate limiter that supports multiple keys.
 *
 * Useful for per-queue, per-consumer, or per-client rate limiting.
 *
 * @example
 * const limiter = new RateLimiter({
 *   max: 100,
 *   window: 60000,
 *   algorithm: 'sliding-window'
 * });
 *
 * // Per-queue rate limiting
 * const result = limiter.consume('queue:tasks');
 *
 * // Per-consumer rate limiting
 * const result2 = limiter.consume('consumer:user-123');
 */
export class RateLimiter {
  /**
   * Creates a new RateLimiter.
   *
   * @param {Object} config - Configuration
   * @param {number} config.max - Maximum operations per window
   * @param {number} config.window - Window size in milliseconds
   * @param {'sliding-window' | 'token-bucket'} [config.algorithm='sliding-window'] - Algorithm to use
   * @param {number} [config.cleanupInterval=60000] - Interval to clean up old entries
   */
  constructor(config) {
    /**
     * Maximum operations per window.
     * @type {number}
     * @private
     */
    this._max = config.max;

    /**
     * Window size in milliseconds.
     * @type {number}
     * @private
     */
    this._windowMs = config.window;

    /**
     * Algorithm to use.
     * @type {'sliding-window' | 'token-bucket'}
     * @private
     */
    this._algorithm = config.algorithm ?? 'sliding-window';

    /**
     * Per-key limiters.
     * @type {Map<string, SlidingWindowCounter | TokenBucket>}
     * @private
     */
    this._limiters = new Map();

    /**
     * Cleanup interval handle.
     * @type {NodeJS.Timeout|null}
     * @private
     */
    this._cleanupHandle = null;

    /**
     * Cleanup interval in milliseconds.
     * @type {number}
     * @private
     */
    this._cleanupInterval = config.cleanupInterval ?? 60000;

    /**
     * Last access time for each key.
     * @type {Map<string, number>}
     * @private
     */
    this._lastAccess = new Map();

    // Start cleanup
    this._startCleanup();
  }

  /**
   * Gets or creates a limiter for the given key.
   *
   * @param {string} key - The rate limit key
   * @returns {SlidingWindowCounter | TokenBucket}
   * @private
   */
  _getLimiter(key) {
    let limiter = this._limiters.get(key);
    if (!limiter) {
      const config = { max: this._max, window: this._windowMs };
      limiter =
        this._algorithm === 'token-bucket'
          ? new TokenBucket(config)
          : new SlidingWindowCounter(config);
      this._limiters.set(key, limiter);
    }
    this._lastAccess.set(key, Date.now());
    return limiter;
  }

  /**
   * Checks if an operation is allowed for the given key.
   *
   * @param {string} [key='default'] - The rate limit key
   * @returns {RateLimitResult} The rate limit check result
   */
  check(key = 'default') {
    return this._getLimiter(key).check();
  }

  /**
   * Consumes one permit for the given key.
   *
   * @param {string} [key='default'] - The rate limit key
   * @returns {RateLimitResult} The rate limit result
   */
  consume(key = 'default') {
    return this._getLimiter(key).consume();
  }

  /**
   * Resets the limiter for the given key.
   *
   * @param {string} [key='default'] - The rate limit key
   */
  reset(key = 'default') {
    const limiter = this._limiters.get(key);
    if (limiter) {
      limiter.reset();
    }
  }

  /**
   * Resets all limiters.
   */
  resetAll() {
    for (const limiter of this._limiters.values()) {
      limiter.reset();
    }
  }

  /**
   * Removes a limiter for the given key.
   *
   * @param {string} key - The rate limit key
   * @returns {boolean} True if the limiter was removed
   */
  remove(key) {
    this._lastAccess.delete(key);
    return this._limiters.delete(key);
  }

  /**
   * Gets statistics for a key.
   *
   * @param {string} [key='default'] - The rate limit key
   * @returns {Object} Statistics
   */
  getStats(key = 'default') {
    const limiter = this._limiters.get(key);
    if (limiter) {
      return limiter.getStats();
    }
    return null;
  }

  /**
   * Gets the number of tracked keys.
   *
   * @returns {number}
   */
  get keyCount() {
    return this._limiters.size;
  }

  /**
   * Lists all tracked keys.
   *
   * @returns {string[]}
   */
  listKeys() {
    return [...this._limiters.keys()];
  }

  /**
   * Starts the cleanup process.
   *
   * @private
   */
  _startCleanup() {
    this._cleanupHandle = globalThis.setInterval(() => {
      const now = Date.now();
      const expiry = this._windowMs * 2; // Keep for 2 windows after last access

      for (const [key, lastAccess] of this._lastAccess) {
        if (now - lastAccess > expiry) {
          this._limiters.delete(key);
          this._lastAccess.delete(key);
        }
      }
    }, this._cleanupInterval);
  }

  /**
   * Stops the rate limiter and cleans up.
   */
  stop() {
    if (this._cleanupHandle) {
      globalThis.clearInterval(this._cleanupHandle);
      this._cleanupHandle = null;
    }
  }

  /**
   * Clears all state.
   */
  clear() {
    this.stop();
    this._limiters.clear();
    this._lastAccess.clear();
  }
}

// =============================================================================
// Rate Limited Queue
// =============================================================================

/**
 * A queue wrapper that adds rate limiting.
 *
 * @example
 * const baseQueue = new LinksQueue({ name: 'api-calls', store });
 * const rateLimitedQueue = new RateLimitedQueue(baseQueue, {
 *   max: 100,
 *   window: 60000
 * });
 *
 * try {
 *   await rateLimitedQueue.enqueue(link);
 * } catch (error) {
 *   if (error.code === 'RATE_LIMITED') {
 *     console.log(`Rate limited. Retry after ${error.retryAfter}ms`);
 *   }
 * }
 */
export class RateLimitedQueue {
  /**
   * Creates a new RateLimitedQueue.
   *
   * @param {import('../queue/queue.js').LinksQueue} queue - The underlying queue
   * @param {RateLimitConfig} config - Rate limit configuration
   */
  constructor(queue, config) {
    /**
     * The underlying queue.
     * @type {import('../queue/queue.js').LinksQueue}
     * @private
     */
    this._queue = queue;

    /**
     * Rate limiter for enqueue operations.
     * @type {SlidingWindowCounter}
     * @private
     */
    this._enqueueLimiter = new SlidingWindowCounter(config);

    /**
     * Rate limiter for dequeue operations.
     * @type {SlidingWindowCounter}
     * @private
     */
    this._dequeueLimiter = new SlidingWindowCounter(config);

    /**
     * Per-consumer rate limiters.
     * @type {RateLimiter}
     * @private
     */
    this._consumerLimiter = new RateLimiter(config);
  }

  /**
   * Gets the queue name.
   *
   * @returns {string}
   */
  get name() {
    return this._queue.name;
  }

  /**
   * Enqueues a link with rate limiting.
   *
   * @param {import('../index.d.ts').Link} link - The link to enqueue
   * @returns {Promise<import('../queue/types.ts').EnqueueResult>}
   * @throws {RateLimitError} If rate limited
   */
  async enqueue(link) {
    const result = this._enqueueLimiter.consume();
    if (!result.allowed) {
      throw new RateLimitError(
        'Enqueue rate limit exceeded',
        result.retryAfter,
        result
      );
    }
    return this._queue.enqueue(link);
  }

  /**
   * Dequeues with rate limiting.
   *
   * @param {string} [consumerId] - Optional consumer ID for per-consumer limits
   * @returns {Promise<import('../index.d.ts').Link | null>}
   * @throws {RateLimitError} If rate limited
   */
  async dequeue(consumerId) {
    // Check global rate limit
    let result = this._dequeueLimiter.consume();
    if (!result.allowed) {
      throw new RateLimitError(
        'Dequeue rate limit exceeded',
        result.retryAfter,
        result
      );
    }

    // Check per-consumer rate limit if consumerId provided
    if (consumerId) {
      result = this._consumerLimiter.consume(`consumer:${consumerId}`);
      if (!result.allowed) {
        throw new RateLimitError(
          `Consumer ${consumerId} rate limit exceeded`,
          result.retryAfter,
          result
        );
      }
    }

    return this._queue.dequeue();
  }

  /**
   * Peeks at the next item (not rate limited).
   *
   * @returns {Promise<import('../index.d.ts').Link | null>}
   */
  async peek() {
    return this._queue.peek();
  }

  /**
   * Acknowledges an item (not rate limited).
   *
   * @param {import('../index.d.ts').LinkId} id - Item ID
   */
  async acknowledge(id) {
    return this._queue.acknowledge(id);
  }

  /**
   * Rejects an item (not rate limited).
   *
   * @param {import('../index.d.ts').LinkId} id - Item ID
   * @param {boolean} [requeue=false] - Whether to requeue
   */
  async reject(id, requeue = false) {
    return this._queue.reject(id, requeue);
  }

  /**
   * Gets queue statistics including rate limit info.
   *
   * @returns {Object}
   */
  getStats() {
    return {
      ...this._queue.getStats(),
      rateLimit: {
        enqueue: this._enqueueLimiter.getStats(),
        dequeue: this._dequeueLimiter.getStats(),
      },
    };
  }

  /**
   * Gets the queue depth.
   *
   * @returns {number}
   */
  getDepth() {
    return this._queue.getDepth();
  }

  /**
   * Clears the queue and resets rate limiters.
   */
  async clear() {
    this._enqueueLimiter.reset();
    this._dequeueLimiter.reset();
    this._consumerLimiter.resetAll();
    await this._queue.clear();
  }

  /**
   * Stops the rate limiter.
   */
  stop() {
    this._consumerLimiter.stop();
  }
}

// =============================================================================
// Rate Limit Error
// =============================================================================

/**
 * Error thrown when rate limit is exceeded.
 */
export class RateLimitError extends Error {
  /**
   * Creates a new RateLimitError.
   *
   * @param {string} message - Error message
   * @param {number} retryAfter - Milliseconds to wait before retrying
   * @param {RateLimitResult} result - The rate limit result
   */
  constructor(message, retryAfter, result) {
    super(message);
    this.name = 'RateLimitError';
    this.code = 'RATE_LIMITED';
    this.retryAfter = retryAfter;
    this.remaining = result.remaining;
    this.resetAt = result.resetAt;
  }
}
