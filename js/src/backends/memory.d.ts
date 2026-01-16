/**
 * In-memory LinkStore implementation type definitions.
 *
 * @module backends/memory
 */

import type {
  Link,
  LinkId,
  LinkRef,
  LinkPattern,
  LinkStore,
} from '../index.d.ts';

/**
 * In-memory implementation of the LinkStore interface.
 *
 * Features:
 * - O(1) lookups by ID using Map
 * - Link deduplication (identical source/target pairs share same ID)
 * - Pattern matching with wildcard support via Any symbol
 * - Async API for consistency with other backends
 *
 * @example
 * import { MemoryLinkStore, Any } from 'links-queue';
 *
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
export declare class MemoryLinkStore implements LinkStore {
  /**
   * Creates a new MemoryLinkStore instance.
   */
  constructor();

  /**
   * Creates a new link from source to target.
   *
   * If a link with identical source and target already exists,
   * returns the existing link (deduplication).
   *
   * @param source - The source reference
   * @param target - The target reference
   * @returns The created or existing link
   */
  create(source: LinkRef, target: LinkRef): Promise<Link>;

  /**
   * Creates a new link with additional values (universal link).
   *
   * Note: Links with values are NOT deduplicated since values are
   * considered part of the link's identity.
   *
   * @param source - The source reference
   * @param target - The target reference
   * @param values - Additional values
   * @returns The created link
   */
  createWithValues(
    source: LinkRef,
    target: LinkRef,
    values: readonly LinkRef[]
  ): Promise<Link>;

  /**
   * Retrieves a link by its ID.
   *
   * @param id - The ID of the link to retrieve
   * @returns The link if found, null otherwise
   */
  get(id: LinkId): Promise<Link | null>;

  /**
   * Checks if a link with the given ID exists.
   *
   * @param id - The ID to check
   * @returns True if the link exists
   */
  exists(id: LinkId): Promise<boolean>;

  /**
   * Finds all links matching the given pattern.
   *
   * @param pattern - The pattern to match
   * @returns Array of matching links
   */
  find(pattern: LinkPattern): Promise<Link[]>;

  /**
   * Counts links matching the given pattern.
   *
   * @param pattern - Optional pattern to match
   * @returns Count of matching links
   */
  count(pattern?: LinkPattern): Promise<number>;

  /**
   * Updates an existing link's source and/or target.
   *
   * @param id - The ID of the link to update
   * @param source - New source reference
   * @param target - New target reference
   * @returns The updated link
   * @throws If the link with given ID does not exist
   */
  update(id: LinkId, source: LinkRef, target: LinkRef): Promise<Link>;

  /**
   * Deletes a link by its ID.
   *
   * @param id - The ID of the link to delete
   * @returns True if deleted, false if not found
   */
  delete(id: LinkId): Promise<boolean>;

  /**
   * Deletes all links matching the given pattern.
   *
   * @param pattern - The pattern to match
   * @returns Count of deleted links
   */
  deleteMatching(pattern: LinkPattern): Promise<number>;

  /**
   * Iterates over all links matching the given pattern.
   *
   * @param pattern - Optional pattern to filter
   * @returns Async iterable of matching links
   */
  iterate(pattern?: LinkPattern): AsyncIterable<Link>;

  /**
   * Removes all links from the store.
   */
  clear(): Promise<void>;
}
