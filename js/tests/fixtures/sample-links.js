/**
 * Sample link data for testing.
 *
 * This module provides standardized test data that can be used across
 * unit tests, integration tests, and benchmarks to ensure consistency.
 */

import { createLink } from '../../src/index.js';

// =============================================================================
// Simple Links - Basic test cases
// =============================================================================

/**
 * Simple links with numeric IDs for basic testing.
 */
export const simpleLinks = {
  basic: createLink(1, 10, 20),
  withZero: createLink(0, 0, 0),
  withNegative: createLink(-1, -10, -20),
  selfReferential: createLink(5, 5, 5),
};

/**
 * Links with string IDs for testing string-based systems.
 */
export const stringLinks = {
  uuid: createLink('a1b2c3d4', 'source-uuid', 'target-uuid'),
  named: createLink('task-1', 'queue', 'payload'),
  empty: createLink('', 'empty-source', 'empty-target'),
};

/**
 * Links with bigint IDs for testing large number support.
 */
export const bigintLinks = {
  large: createLink(9007199254740993n, 9007199254740994n, 9007199254740995n),
  small: createLink(1n, 2n, 3n),
  mixed: createLink(100n, 200n, 300n),
};

// =============================================================================
// Nested Links - Hierarchical structures
// =============================================================================

/**
 * Nested link structures for testing recursive patterns.
 */
export const nestedLinks = {
  // Two levels deep
  twoLevel: (() => {
    const inner = createLink(2, 20, 21);
    return createLink(1, inner, 10);
  })(),

  // Three levels deep
  threeLevel: (() => {
    const level3 = createLink(3, 30, 31);
    const level2 = createLink(2, level3, 21);
    return createLink(1, level2, 10);
  })(),

  // Both source and target are links
  bothNested: (() => {
    const source = createLink(2, 20, 21);
    const target = createLink(3, 30, 31);
    return createLink(1, source, target);
  })(),
};

// =============================================================================
// Links with Values - Universal links
// =============================================================================

/**
 * Links with additional values (universal links).
 */
export const valueLinks = {
  withNumbers: createLink(1, 10, 20, [30, 40, 50]),
  withStrings: createLink('msg', 'sender', 'receiver', ['hello', 'world']),
  withMixed: createLink(1, 2, 3, [4, 'five', 6n]),
  empty: createLink(1, 2, 3, []),
};

// =============================================================================
// Queue Item Links - Common queue patterns
// =============================================================================

/**
 * Sample queue items for testing queue operations.
 */
export const queueItems = {
  // Simple task
  task: createLink(1, 'task', 'process-data'),

  // Task with priority (using values)
  priorityTask: createLink(2, 'task', 'urgent-work', [10]), // priority: 10

  // Delayed task
  delayedTask: createLink(3, 'task', 'scheduled-work', [Date.now() + 60000]),

  // Message with metadata
  message: createLink(4, 'sender-1', 'receiver-1', ['hello', Date.now()]),
};

// =============================================================================
// Bulk Data - For performance testing
// =============================================================================

/**
 * Generate a batch of sequential links.
 * @param {number} count - Number of links to generate
 * @param {number} startId - Starting ID (default: 1)
 * @returns {Array<import('../../src/index.d.ts').Link>}
 */
export const generateSequentialLinks = (count, startId = 1) => {
  const links = [];
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    links.push(createLink(id, id * 10, id * 10 + 1));
  }
  return links;
};

/**
 * Generate links with random source/target values.
 * @param {number} count - Number of links to generate
 * @param {number} maxValue - Maximum value for source/target
 * @returns {Array<import('../../src/index.d.ts').Link>}
 */
export const generateRandomLinks = (count, maxValue = 1000) => {
  const links = [];
  for (let i = 0; i < count; i++) {
    const source = Math.floor(Math.random() * maxValue);
    const target = Math.floor(Math.random() * maxValue);
    links.push(createLink(i + 1, source, target));
  }
  return links;
};

/**
 * Pre-generated bulk data sets for benchmarks.
 */
export const bulkData = {
  small: generateSequentialLinks(100),
  medium: generateSequentialLinks(1000),
  // Note: Large datasets should be generated on-demand to avoid memory issues
  // large: generateSequentialLinks(10000),
};

// =============================================================================
// Pattern Matching Test Data
// =============================================================================

/**
 * Links specifically designed for testing pattern matching.
 * All links have source in [1, 2] and target in [10, 20].
 */
export const patternTestLinks = [
  createLink(1, 1, 10),
  createLink(2, 1, 20),
  createLink(3, 2, 10),
  createLink(4, 2, 20),
];

/**
 * Expected results for pattern queries on patternTestLinks.
 */
export const patternExpectedResults = {
  source1: [patternTestLinks[0], patternTestLinks[1]], // source: 1
  source2: [patternTestLinks[2], patternTestLinks[3]], // source: 2
  target10: [patternTestLinks[0], patternTestLinks[2]], // target: 10
  target20: [patternTestLinks[1], patternTestLinks[3]], // target: 20
  source1target10: [patternTestLinks[0]], // source: 1, target: 10
  all: patternTestLinks,
};

export default {
  simpleLinks,
  stringLinks,
  bigintLinks,
  nestedLinks,
  valueLinks,
  queueItems,
  generateSequentialLinks,
  generateRandomLinks,
  bulkData,
  patternTestLinks,
  patternExpectedResults,
};
