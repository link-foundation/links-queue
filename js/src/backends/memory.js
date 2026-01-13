/**
 * In-memory LinkStore implementation.
 *
 * Provides O(1) access for development and testing scenarios.
 * This implementation uses JavaScript Map for efficient lookups by ID
 * and supports link deduplication (identical structures share the same ID).
 *
 * @module backends/memory
 */

/*
 * Note: The require-await warnings are intentional.
 * This implementation uses async methods for API consistency with other backends
 * (e.g., file-based or network-based stores) even though the in-memory operations
 * are synchronous. This allows for seamless backend swapping.
 */
/* eslint-disable require-await */

import { getLinkId, createLink, matchesPattern } from '../index.js';

/**
 * In-memory implementation of the LinkStore interface.
 *
 * Features:
 * - O(1) lookups by ID using Map
 * - Link deduplication (identical source/target pairs share same ID)
 * - Pattern matching with wildcard support via Any symbol
 * - Async API for consistency with other backends
 *
 * @implements {import('../index.d.ts').LinkStore}
 *
 * @example
 * const store = new MemoryLinkStore();
 *
 * // Create a link
 * const link = await store.create('hello', 'world');
 * console.log(link); // { id: 1, source: 'hello', target: 'world' }
 *
 * // Find links
 * const results = await store.find({ source: 'hello', target: Any });
 *
 * // Deduplication - returns existing link
 * const duplicate = await store.create('hello', 'world');
 * console.log(duplicate.id === link.id); // true
 */
export class MemoryLinkStore {
  /**
   * Creates a new MemoryLinkStore instance.
   */
  constructor() {
    /**
     * Primary storage - maps link ID to link object.
     * @type {Map<import('../index.d.ts').LinkId, import('../index.d.ts').Link>}
     * @private
     */
    this._links = new Map();

    /**
     * Index for deduplication - maps "source:target" hash to link ID.
     * @type {Map<string, import('../index.d.ts').LinkId>}
     * @private
     */
    this._deduplicationIndex = new Map();

    /**
     * Counter for generating sequential IDs.
     * @type {number}
     * @private
     */
    this._nextId = 1;
  }

  /**
   * Generates a unique hash key for deduplication based on source and target.
   * @param {import('../index.d.ts').LinkRef} source - The source reference
   * @param {import('../index.d.ts').LinkRef} target - The target reference
   * @returns {string} A hash key for the source/target pair
   * @private
   */
  _getDeduplicationKey(source, target) {
    const sourceId = getLinkId(source);
    const targetId = getLinkId(target);
    // Convert to string representation with type prefix to handle different types
    // and prevent collisions (e.g., number 1 vs string "1" vs bigint 1n)
    const serializeId = (id) => {
      if (typeof id === 'bigint') {
        return `bigint:${id.toString()}`;
      }
      if (typeof id === 'number') {
        return `number:${id}`;
      }
      return `string:${id}`;
    };
    return `${serializeId(sourceId)}|${serializeId(targetId)}`;
  }

  /**
   * Creates a new link from source to target.
   *
   * If a link with identical source and target already exists,
   * returns the existing link (deduplication).
   *
   * @param {import('../index.d.ts').LinkRef} source - The source reference
   * @param {import('../index.d.ts').LinkRef} target - The target reference
   * @returns {Promise<import('../index.d.ts').Link>} The created or existing link
   *
   * @example
   * const link = await store.create(1, 2);
   * // { id: 1, source: 1, target: 2 }
   *
   * const duplicate = await store.create(1, 2);
   * // Returns the same link (deduplication)
   * console.log(duplicate.id === link.id); // true
   */
  async create(source, target) {
    // Check for existing link with same source/target (deduplication)
    const dedupeKey = this._getDeduplicationKey(source, target);
    const existingId = this._deduplicationIndex.get(dedupeKey);

    if (existingId !== undefined) {
      return this._links.get(existingId);
    }

    // Create new link
    const id = this._nextId++;
    const link = createLink(id, source, target);

    this._links.set(id, link);
    this._deduplicationIndex.set(dedupeKey, id);

    return link;
  }

  /**
   * Creates a new link with additional values (universal link).
   *
   * Note: Links with values are NOT deduplicated since values are
   * considered part of the link's identity.
   *
   * @param {import('../index.d.ts').LinkRef} source - The source reference
   * @param {import('../index.d.ts').LinkRef} target - The target reference
   * @param {readonly import('../index.d.ts').LinkRef[]} values - Additional values
   * @returns {Promise<import('../index.d.ts').Link>} The created link
   */
  async createWithValues(source, target, values) {
    // Universal links with values are not deduplicated
    const id = this._nextId++;
    const link = createLink(id, source, target, [...values]);

    this._links.set(id, link);

    return link;
  }

  /**
   * Retrieves a link by its ID.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the link to retrieve
   * @returns {Promise<import('../index.d.ts').Link | null>} The link if found, null otherwise
   *
   * @example
   * const link = await store.get(42);
   * if (link) {
   *   console.log(`Found: ${link.source} -> ${link.target}`);
   * }
   */
  async get(id) {
    return this._links.get(id) ?? null;
  }

  /**
   * Checks if a link with the given ID exists.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID to check
   * @returns {Promise<boolean>} True if the link exists
   *
   * @example
   * if (await store.exists(42)) {
   *   console.log('Link 42 exists');
   * }
   */
  async exists(id) {
    return this._links.has(id);
  }

  /**
   * Finds all links matching the given pattern.
   *
   * @param {import('../index.d.ts').LinkPattern} pattern - The pattern to match
   * @returns {Promise<import('../index.d.ts').Link[]>} Array of matching links
   *
   * @example
   * // Find all links with source = 5
   * const links = await store.find({ source: 5 });
   *
   * // Find all links with any source, target = 10
   * const links2 = await store.find({ source: Any, target: 10 });
   */
  async find(pattern) {
    const results = [];

    for (const link of this._links.values()) {
      if (matchesPattern(link, pattern)) {
        results.push(link);
      }
    }

    return results;
  }

  /**
   * Counts links matching the given pattern.
   *
   * @param {import('../index.d.ts').LinkPattern} [pattern] - Optional pattern to match
   * @returns {Promise<number>} Count of matching links
   *
   * @example
   * const total = await store.count();
   * const withSource5 = await store.count({ source: 5 });
   */
  async count(pattern) {
    if (!pattern) {
      return this._links.size;
    }

    let count = 0;
    for (const link of this._links.values()) {
      if (matchesPattern(link, pattern)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Updates an existing link's source and/or target.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the link to update
   * @param {import('../index.d.ts').LinkRef} source - New source reference
   * @param {import('../index.d.ts').LinkRef} target - New target reference
   * @returns {Promise<import('../index.d.ts').Link>} The updated link
   * @throws {Error} If the link with given ID does not exist
   *
   * @example
   * const updated = await store.update(1, 10, 20);
   * console.log(updated); // { id: 1, source: 10, target: 20 }
   */
  async update(id, source, target) {
    const existingLink = this._links.get(id);

    if (!existingLink) {
      throw new Error(`Link with id ${id} not found`);
    }

    // Remove old deduplication entry
    const oldDedupeKey = this._getDeduplicationKey(
      existingLink.source,
      existingLink.target
    );
    this._deduplicationIndex.delete(oldDedupeKey);

    // Create updated link (preserving values if any)
    const updatedLink = existingLink.values
      ? createLink(id, source, target, [...existingLink.values])
      : createLink(id, source, target);

    this._links.set(id, updatedLink);

    // Add new deduplication entry (only for links without values)
    if (!existingLink.values) {
      const newDedupeKey = this._getDeduplicationKey(source, target);
      this._deduplicationIndex.set(newDedupeKey, id);
    }

    return updatedLink;
  }

  /**
   * Deletes a link by its ID.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the link to delete
   * @returns {Promise<boolean>} True if deleted, false if not found
   *
   * @example
   * const deleted = await store.delete(42);
   * if (deleted) {
   *   console.log('Link 42 was deleted');
   * }
   */
  async delete(id) {
    const link = this._links.get(id);

    if (!link) {
      return false;
    }

    // Remove from deduplication index (only for links without values)
    if (!link.values) {
      const dedupeKey = this._getDeduplicationKey(link.source, link.target);
      this._deduplicationIndex.delete(dedupeKey);
    }

    this._links.delete(id);
    return true;
  }

  /**
   * Deletes all links matching the given pattern.
   *
   * @param {import('../index.d.ts').LinkPattern} pattern - The pattern to match
   * @returns {Promise<number>} Count of deleted links
   *
   * @example
   * const count = await store.deleteMatching({ source: 5 });
   * console.log(`Deleted ${count} links`);
   */
  async deleteMatching(pattern) {
    const toDelete = [];

    for (const [id, link] of this._links.entries()) {
      if (matchesPattern(link, pattern)) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      await this.delete(id);
    }

    return toDelete.length;
  }

  /**
   * Iterates over all links matching the given pattern.
   *
   * @param {import('../index.d.ts').LinkPattern} [pattern] - Optional pattern to filter
   * @returns {AsyncIterable<import('../index.d.ts').Link>} Async iterable of matching links
   *
   * @example
   * for await (const link of store.iterate({ source: 5 })) {
   *   console.log(link);
   * }
   */
  async *iterate(pattern) {
    for (const link of this._links.values()) {
      if (!pattern || matchesPattern(link, pattern)) {
        yield link;
      }
    }
  }

  /**
   * Removes all links from the store.
   *
   * @returns {Promise<void>}
   *
   * @example
   * await store.clear();
   * console.log(await store.count()); // 0
   */
  async clear() {
    this._links.clear();
    this._deduplicationIndex.clear();
    this._nextId = 1;
  }
}
