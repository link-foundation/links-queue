/**
 * Mock backend implementations for testing.
 *
 * Provides mock implementations of storage backends that can be used
 * to test components in isolation without real storage dependencies.
 */

// =============================================================================
// Mock Memory Backend
// =============================================================================

/**
 * MockBackend - A configurable mock storage backend for testing.
 *
 * Features:
 * - Configurable latency simulation
 * - Failure injection
 * - Operation tracking (spy functionality)
 * - Capacity limits
 *
 * @example
 * const mock = new MockBackend({ latencyMs: 10 });
 * await mock.connect();
 * await mock.save({ source: 1, target: 2 });
 * console.log(mock.operationLog); // ['connect', 'save']
 */
export class MockBackend {
  /**
   * @param {object} options - Configuration options
   * @param {number} options.latencyMs - Simulated latency in ms (default: 0)
   * @param {number} options.failureRate - Probability of failure 0-1 (default: 0)
   * @param {number} options.capacity - Maximum stored items (default: Infinity)
   * @param {boolean} options.trackOperations - Track all operations (default: true)
   */
  constructor({
    latencyMs = 0,
    failureRate = 0,
    capacity = Number.POSITIVE_INFINITY,
    trackOperations = true,
  } = {}) {
    this.latencyMs = latencyMs;
    this.failureRate = failureRate;
    this.capacity = capacity;
    this.trackOperations = trackOperations;

    this._links = new Map();
    this._nextId = 1;
    this._connected = false;
    this._operationLog = [];
    this._stats = {
      saveCount: 0,
      loadCount: 0,
      deleteCount: 0,
      queryCount: 0,
    };
  }

  /**
   * Get the operation log for verification.
   * @returns {Array<{operation: string, args: any[], timestamp: number}>}
   */
  get operationLog() {
    return [...this._operationLog];
  }

  /**
   * Get operation statistics.
   * @returns {object}
   */
  get stats() {
    return { ...this._stats };
  }

  /**
   * Check if connected.
   * @returns {boolean}
   */
  get isConnected() {
    return this._connected;
  }

  /**
   * Internal helper to simulate latency and failures.
   * @private
   */
  async _simulateConditions(operation, args = []) {
    if (this.trackOperations) {
      this._operationLog.push({
        operation,
        args,
        timestamp: Date.now(),
      });
    }

    if (this.latencyMs > 0) {
      await new Promise((resolve) =>
        globalThis.setTimeout(resolve, this.latencyMs)
      );
    }

    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new Error(`Simulated failure in ${operation}`);
    }
  }

  /**
   * Connect to the mock backend.
   * @returns {Promise<void>}
   */
  async connect() {
    await this._simulateConditions('connect');
    this._connected = true;
  }

  /**
   * Disconnect from the mock backend.
   * @returns {Promise<void>}
   */
  async disconnect() {
    await this._simulateConditions('disconnect');
    this._connected = false;
  }

  /**
   * Save a link to the mock storage.
   * @param {object} link - Link to save (source, target)
   * @returns {Promise<number>} The assigned link ID
   */
  async save(link) {
    await this._simulateConditions('save', [link]);
    this._stats.saveCount++;

    if (this._links.size >= this.capacity) {
      throw new Error('Backend capacity exceeded');
    }

    const id = this._nextId++;
    this._links.set(id, { id, ...link });
    return id;
  }

  /**
   * Load a link by ID.
   * @param {number} id - Link ID
   * @returns {Promise<object|null>}
   */
  async load(id) {
    await this._simulateConditions('load', [id]);
    this._stats.loadCount++;
    return this._links.get(id) || null;
  }

  /**
   * Delete a link by ID.
   * @param {number} id - Link ID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    await this._simulateConditions('delete', [id]);
    this._stats.deleteCount++;
    return this._links.delete(id);
  }

  /**
   * Query links by pattern.
   * @param {object} pattern - Pattern to match
   * @returns {Promise<Array<object>>}
   */
  async query(pattern) {
    await this._simulateConditions('query', [pattern]);
    this._stats.queryCount++;

    const results = [];
    for (const link of this._links.values()) {
      if (this._matchesPattern(link, pattern)) {
        results.push(link);
      }
    }
    return results;
  }

  /**
   * Clear all stored links.
   * @returns {Promise<void>}
   */
  async clear() {
    await this._simulateConditions('clear');
    this._links.clear();
    this._nextId = 1;
  }

  /**
   * Reset the mock backend to initial state.
   * Clears all data and resets operation tracking.
   */
  reset() {
    this._links.clear();
    this._nextId = 1;
    this._connected = false;
    this._operationLog = [];
    this._stats = {
      saveCount: 0,
      loadCount: 0,
      deleteCount: 0,
      queryCount: 0,
    };
  }

  /**
   * Set the failure rate dynamically.
   * @param {number} rate - Failure rate 0-1
   */
  setFailureRate(rate) {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Set the latency dynamically.
   * @param {number} ms - Latency in milliseconds
   */
  setLatency(ms) {
    this.latencyMs = Math.max(0, ms);
  }

  /**
   * Internal pattern matching helper.
   * @private
   */
  _matchesPattern(link, pattern) {
    if (pattern.source !== undefined && link.source !== pattern.source) {
      return false;
    }
    if (pattern.target !== undefined && link.target !== pattern.target) {
      return false;
    }
    if (pattern.id !== undefined && link.id !== pattern.id) {
      return false;
    }
    return true;
  }
}

// =============================================================================
// Mock Queue Backend
// =============================================================================

/**
 * MockQueueBackend - A mock queue storage for testing queue components.
 */
export class MockQueueBackend {
  constructor(options = {}) {
    this.latencyMs = options.latencyMs || 0;
    this.failureRate = options.failureRate || 0;
    this._queues = new Map();
    this._operationLog = [];
  }

  get operationLog() {
    return [...this._operationLog];
  }

  async _simulateConditions(operation, args = []) {
    this._operationLog.push({ operation, args, timestamp: Date.now() });

    if (this.latencyMs > 0) {
      await new Promise((resolve) =>
        globalThis.setTimeout(resolve, this.latencyMs)
      );
    }

    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new Error(`Simulated failure in ${operation}`);
    }
  }

  async createQueue(name, options = {}) {
    await this._simulateConditions('createQueue', [name, options]);
    if (this._queues.has(name)) {
      throw new Error(`Queue "${name}" already exists`);
    }
    this._queues.set(name, { items: [], options });
  }

  async deleteQueue(name) {
    await this._simulateConditions('deleteQueue', [name]);
    return this._queues.delete(name);
  }

  async enqueue(queueName, item) {
    await this._simulateConditions('enqueue', [queueName, item]);
    const queue = this._queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }
    queue.items.push(item);
  }

  async dequeue(queueName) {
    await this._simulateConditions('dequeue', [queueName]);
    const queue = this._queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }
    return queue.items.shift() || null;
  }

  async peek(queueName) {
    await this._simulateConditions('peek', [queueName]);
    const queue = this._queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }
    return queue.items[0] || null;
  }

  async getQueueSize(queueName) {
    await this._simulateConditions('getQueueSize', [queueName]);
    const queue = this._queues.get(queueName);
    return queue ? queue.items.length : 0;
  }

  async listQueues() {
    await this._simulateConditions('listQueues');
    return Array.from(this._queues.keys());
  }

  reset() {
    this._queues.clear();
    this._operationLog = [];
  }
}

// =============================================================================
// Mock Network Connection
// =============================================================================

/**
 * MockConnection - Simulates a network connection for testing client/server.
 */
export class MockConnection {
  constructor(options = {}) {
    this.latencyMs = options.latencyMs || 0;
    this.connected = false;
    this._messageQueue = [];
    this._handlers = new Map();
    this._operationLog = [];
  }

  get operationLog() {
    return [...this._operationLog];
  }

  async connect(host, port) {
    this._operationLog.push({ operation: 'connect', args: [host, port] });
    if (this.latencyMs > 0) {
      await new Promise((resolve) =>
        globalThis.setTimeout(resolve, this.latencyMs)
      );
    }
    this.connected = true;
  }

  async disconnect() {
    this._operationLog.push({ operation: 'disconnect' });
    this.connected = false;
  }

  async send(message) {
    this._operationLog.push({ operation: 'send', args: [message] });
    if (!this.connected) {
      throw new Error('Not connected');
    }
    this._messageQueue.push(message);
  }

  on(event, handler) {
    this._handlers.set(event, handler);
  }

  off(event) {
    this._handlers.delete(event);
  }

  // Test helper: simulate receiving a message
  simulateReceive(message) {
    const handler = this._handlers.get('message');
    if (handler) {
      handler(message);
    }
  }

  // Test helper: simulate connection close
  simulateClose() {
    this.connected = false;
    const handler = this._handlers.get('close');
    if (handler) {
      handler();
    }
  }

  // Test helper: simulate error
  simulateError(error) {
    const handler = this._handlers.get('error');
    if (handler) {
      handler(error);
    }
  }

  reset() {
    this.connected = false;
    this._messageQueue = [];
    this._handlers.clear();
    this._operationLog = [];
  }
}

export default {
  MockBackend,
  MockQueueBackend,
  MockConnection,
};
