/**
 * links-queue - Core module entry point
 *
 * This module exports the Link and LinkStore interface definitions
 * along with utility functions and constants.
 */

// =============================================================================
// Pattern Matching Constants
// =============================================================================

/**
 * Special value indicating "any" match in pattern queries.
 * Use this in LinkPattern to match any value in that position.
 *
 * @example
 * // Find all links with source = 5, any target
 * const links = await store.find({ source: 5, target: Any });
 */
export const Any = Symbol('Any');

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if a value is a Link object (has id, source, target properties).
 *
 * @param {unknown} value - The value to check
 * @returns {boolean} True if value is a Link object
 *
 * @example
 * isLink({ id: 1, source: 2, target: 3 }) // true
 * isLink(42) // false
 * isLink("hello") // false
 */
export const isLink = (value) =>
  value !== null &&
  typeof value === 'object' &&
  'id' in value &&
  'source' in value &&
  'target' in value;

/**
 * Checks if a value is a valid LinkId (number, bigint, or string).
 *
 * @param {unknown} value - The value to check
 * @returns {boolean} True if value is a valid LinkId
 *
 * @example
 * isLinkId(42) // true
 * isLinkId(9007199254740993n) // true
 * isLinkId("uuid-here") // true
 * isLinkId({}) // false
 */
export const isLinkId = (value) =>
  typeof value === 'number' ||
  typeof value === 'bigint' ||
  typeof value === 'string';

/**
 * Checks if a value is a valid LinkRef (LinkId or Link).
 *
 * @param {unknown} value - The value to check
 * @returns {boolean} True if value is a valid LinkRef
 *
 * @example
 * isLinkRef(42) // true
 * isLinkRef({ id: 1, source: 2, target: 3 }) // true
 */
export const isLinkRef = (value) => isLinkId(value) || isLink(value);

/**
 * Extracts the LinkId from a LinkRef.
 * If the ref is a Link, returns its id. Otherwise returns the ref itself.
 *
 * @param {import('./index.d.ts').LinkRef} ref - The reference to extract ID from
 * @returns {import('./index.d.ts').LinkId} The extracted LinkId
 *
 * @example
 * getLinkId(42) // 42
 * getLinkId({ id: 1, source: 2, target: 3 }) // 1
 */
export const getLinkId = (ref) => (isLink(ref) ? ref.id : ref);

/**
 * Creates a Link object from source and target references.
 *
 * @param {import('./index.d.ts').LinkId} id - The link ID
 * @param {import('./index.d.ts').LinkRef} source - The source reference
 * @param {import('./index.d.ts').LinkRef} target - The target reference
 * @param {import('./index.d.ts').LinkRef[]} [values] - Optional additional values
 * @returns {import('./index.d.ts').Link} The created Link object
 *
 * @example
 * const link = createLink(1, 2, 3);
 * console.log(link); // { id: 1, source: 2, target: 3 }
 *
 * const universalLink = createLink(1, 2, 3, [4, 5]);
 * console.log(universalLink); // { id: 1, source: 2, target: 3, values: [4, 5] }
 */
export const createLink = (id, source, target, values = undefined) => {
  const link = { id, source, target };
  if (values !== undefined && values.length > 0) {
    link.values = values;
  }
  return Object.freeze(link);
};

/**
 * Checks if a pattern matches a link.
 *
 * @param {import('./index.d.ts').Link} link - The link to check
 * @param {import('./index.d.ts').LinkPattern} pattern - The pattern to match against
 * @returns {boolean} True if the link matches the pattern
 *
 * @example
 * const link = { id: 1, source: 2, target: 3 };
 * matchesPattern(link, { source: 2 }) // true
 * matchesPattern(link, { source: 5 }) // false
 * matchesPattern(link, { source: Any }) // true
 */
export const matchesPattern = (link, pattern) => {
  if (pattern.id !== undefined && pattern.id !== Any) {
    if (getLinkId(link.id) !== getLinkId(pattern.id)) {
      return false;
    }
  }
  if (pattern.source !== undefined && pattern.source !== Any) {
    if (getLinkId(link.source) !== getLinkId(pattern.source)) {
      return false;
    }
  }
  if (pattern.target !== undefined && pattern.target !== Any) {
    if (getLinkId(link.target) !== getLinkId(pattern.target)) {
      return false;
    }
  }
  return true;
};

// =============================================================================
// Backward Compatible Exports (deprecated)
// =============================================================================

/**
 * Example function that adds two numbers
 * @deprecated Use the new Link interfaces instead
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} Sum of a and b
 */
export const add = (a, b) => a + b;

/**
 * Example function that multiplies two numbers
 * @deprecated Use the new Link interfaces instead
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} Product of a and b
 */
export const multiply = (a, b) => a * b;

/**
 * Example async function
 * @deprecated Will be removed in future versions
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export const delay = (ms) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

// =============================================================================
// Backend Exports
// =============================================================================

export { MemoryLinkStore } from './backends/memory.js';

// Storage backend interface and registry
export { BackendRegistry, MemoryBackendAdapter } from './backends/registry.js';

// link-cli backend for persistent storage
export { LinkCliBackend } from './backends/link-cli.js';
export { LinkCliProcess, ProcessState } from './backends/link-cli-process.js';

// =============================================================================
// Queue Exports
// =============================================================================

export {
  QueueError,
  DeliveryState,
  DeliveryRecord,
  DeliveryTracker,
  PollableDeliveryTracker,
  LinksQueue,
  MemoryQueue,
  MemoryQueueWithStorage,
  MemoryQueueManager,
  LinksQueueManager,
} from './queue/index.js';

// =============================================================================
// Protocol Exports
// =============================================================================

export {
  LinksNotation,
  NotationParser,
  NotationStreamParser,
  NotationParseError,
} from './protocol/notation.js';

export {
  Message,
  MessageBuilder,
  RequestType,
  ResponseStatus,
  ErrorCode,
  createOkResponse,
  createErrorResponse,
  createEnqueueRequest,
  createDequeueRequest,
  createPeekRequest,
  createAckRequest,
  createRejectRequest,
  createQueryRequest,
  createGetStatsRequest,
  createListQueuesRequest,
  createCreateQueueRequest,
  createDeleteQueueRequest,
} from './protocol/messages.js';

// =============================================================================
// Server Exports
// =============================================================================

export {
  LinksQueueServer,
  ServerState,
  ServerConnection,
  ConnectionState,
  RequestRouter,
} from './server/index.js';

// =============================================================================
// Client Exports
// =============================================================================

export {
  LinksQueueClient,
  ClientConnection,
  ClientConnectionState,
} from './client/index.js';
