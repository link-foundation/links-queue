/**
 * Test utility functions for links-queue.
 *
 * Provides helper functions for common testing patterns, assertions,
 * and test setup/teardown operations.
 */

/* eslint-disable no-undef */

import {
  MemoryLinkStore,
  MemoryQueue,
  LinksQueueServer,
} from '../../src/index.js';

// =============================================================================
// Store Helpers
// =============================================================================

/**
 * Creates a fresh MemoryLinkStore instance.
 * Useful for test isolation.
 *
 * @returns {MemoryLinkStore}
 */
export const createTestStore = () => new MemoryLinkStore();

/**
 * Creates a MemoryLinkStore pre-populated with test data.
 *
 * @param {Array<{source: any, target: any}>} links - Links to populate
 * @returns {Promise<MemoryLinkStore>}
 */
export const createPopulatedStore = async (links) => {
  const store = new MemoryLinkStore();
  for (const { source, target } of links) {
    await store.create(source, target);
  }
  return store;
};

/**
 * Creates a standard populated store with common test data.
 * Contains 4 links: (1,10), (1,20), (2,10), (2,20)
 *
 * @returns {Promise<MemoryLinkStore>}
 */
export const createStandardPopulatedStore = async () =>
  createPopulatedStore([
    { source: 1, target: 10 },
    { source: 1, target: 20 },
    { source: 2, target: 10 },
    { source: 2, target: 20 },
  ]);

// =============================================================================
// Queue Helpers
// =============================================================================

/**
 * Creates a fresh MemoryQueue instance.
 *
 * @param {object} options - Queue options
 * @returns {MemoryQueue}
 */
export const createTestQueue = (options = {}) => new MemoryQueue(options);

/**
 * Creates a MemoryQueue pre-populated with items.
 *
 * @param {Array<any>} items - Items to enqueue
 * @param {object} options - Queue options
 * @returns {Promise<MemoryQueue>}
 */
export const createPopulatedQueue = async (items, options = {}) => {
  const queue = new MemoryQueue(options);
  for (const item of items) {
    await queue.enqueue(item);
  }
  return queue;
};

// =============================================================================
// Server Helpers
// =============================================================================

/**
 * Creates a test server on a random available port.
 *
 * @param {object} options - Server options
 * @returns {Promise<{server: LinksQueueServer, port: number, cleanup: Function}>}
 */
export const createTestServer = async (options = {}) => {
  // Use port 0 to get a random available port
  const server = new LinksQueueServer({
    port: 0,
    host: '127.0.0.1',
    ...options,
  });

  await server.start();
  const port = server.port;

  const cleanup = async () => {
    try {
      await server.shutdown();
    } catch {
      // Ignore cleanup errors
    }
  };

  return { server, port, cleanup };
};

// =============================================================================
// Timing Helpers
// =============================================================================

/**
 * Wait for a specified duration.
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export const wait = (ms) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/**
 * Wait until a condition becomes true.
 *
 * @param {() => boolean | Promise<boolean>} condition - Condition to check
 * @param {object} options - Options
 * @param {number} options.timeout - Maximum wait time (default: 5000ms)
 * @param {number} options.interval - Check interval (default: 50ms)
 * @returns {Promise<void>}
 */
export const waitUntil = async (
  condition,
  { timeout = 5000, interval = 50 } = {}
) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await wait(interval);
  }
  throw new Error(`Condition not met within ${timeout}ms`);
};

/**
 * Retry an operation until it succeeds or times out.
 *
 * @param {() => Promise<any>} operation - Operation to retry
 * @param {object} options - Options
 * @param {number} options.retries - Maximum retries (default: 3)
 * @param {number} options.delay - Delay between retries (default: 100ms)
 * @returns {Promise<any>}
 */
export const retry = async (operation, { retries = 3, delay = 100 } = {}) => {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i < retries) {
        await wait(delay);
      }
    }
  }
  throw lastError;
};

// =============================================================================
// Benchmark Helpers
// =============================================================================

/**
 * Measure execution time of an async operation.
 *
 * @param {() => Promise<any>} operation - Operation to measure
 * @returns {Promise<{result: any, durationMs: number}>}
 */
export const measureTime = async (operation) => {
  const start = performance.now();
  const result = await operation();
  const durationMs = performance.now() - start;
  return { result, durationMs };
};

/**
 * Run a benchmark with warmup and multiple iterations.
 *
 * @param {string} name - Benchmark name
 * @param {() => Promise<void>} operation - Operation to benchmark
 * @param {object} options - Options
 * @param {number} options.warmupIterations - Warmup iterations (default: 10)
 * @param {number} options.iterations - Measured iterations (default: 1000)
 * @returns {Promise<{name: string, totalMs: number, avgMs: number, opsPerSec: number}>}
 */
export const runBenchmark = async (
  name,
  operation,
  { warmupIterations = 10, iterations = 1000 } = {}
) => {
  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    await operation();
  }

  // Measure
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await operation();
  }
  const totalMs = performance.now() - start;

  const avgMs = totalMs / iterations;
  const opsPerSec = Math.round(1000 / avgMs);

  return { name, totalMs, avgMs, opsPerSec };
};

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * Assert that two links are equal (by value, not reference).
 *
 * @param {import('../../src/index.d.ts').Link} actual - Actual link
 * @param {import('../../src/index.d.ts').Link} expected - Expected link
 * @throws {Error} If links are not equal
 */
export const assertLinksEqual = (actual, expected) => {
  if (actual.id !== expected.id) {
    throw new Error(`Link IDs differ: ${actual.id} !== ${expected.id}`);
  }
  if (actual.source !== expected.source) {
    throw new Error(
      `Link sources differ: ${actual.source} !== ${expected.source}`
    );
  }
  if (actual.target !== expected.target) {
    throw new Error(
      `Link targets differ: ${actual.target} !== ${expected.target}`
    );
  }
};

/**
 * Assert that an async operation throws an error.
 *
 * @param {() => Promise<any>} operation - Operation that should throw
 * @param {string | RegExp} [expectedMessage] - Expected error message pattern
 * @returns {Promise<Error>} The thrown error
 */
export const assertThrowsAsync = async (operation, expectedMessage) => {
  let threw = false;
  let thrownError;
  try {
    await operation();
  } catch (error) {
    threw = true;
    thrownError = error;
  }

  if (!threw) {
    throw new Error('Expected operation to throw, but it did not');
  }

  if (expectedMessage) {
    const message = thrownError.message || String(thrownError);
    if (typeof expectedMessage === 'string') {
      if (!message.includes(expectedMessage)) {
        throw new Error(
          `Expected error message to include "${expectedMessage}", but got "${message}"`
        );
      }
    } else if (expectedMessage instanceof RegExp) {
      if (!expectedMessage.test(message)) {
        throw new Error(
          `Expected error message to match ${expectedMessage}, but got "${message}"`
        );
      }
    }
  }

  return thrownError;
};

export default {
  createTestStore,
  createPopulatedStore,
  createStandardPopulatedStore,
  createTestQueue,
  createPopulatedQueue,
  createTestServer,
  wait,
  waitUntil,
  retry,
  measureTime,
  runBenchmark,
  assertLinksEqual,
  assertThrowsAsync,
};
