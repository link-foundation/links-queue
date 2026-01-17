/**
 * Core Link and LinkStore type definitions for links-queue.
 *
 * This module provides the foundational interfaces for the Link data model
 * and LinkStore operations. These interfaces establish the API contract that
 * implementations must follow.
 *
 * @module types
 *
 * Design goals:
 * - Compatible with links-notation (supports nested/recursive structures)
 * - Compatible with doublets-rs patterns (source/target model)
 * - Extensible for universal links with any number of references
 *
 * @see https://github.com/link-foundation/links-notation
 * @see https://github.com/linksplatform/doublets-rs
 */

// =============================================================================
// ID Types
// =============================================================================

/**
 * A link identifier. Can be a number, bigint, or string.
 *
 * @example
 * const numericId: LinkId = 42;
 * const bigId: LinkId = 9007199254740993n;
 * const stringId: LinkId = "custom-uuid-here";
 */
export type LinkId = number | bigint | string;

// =============================================================================
// Link Reference Types
// =============================================================================

/**
 * A reference to a link, which can be:
 * - A link ID (direct reference by identifier)
 * - A nested Link object (inline definition)
 *
 * This allows for flexible link compositions and nested structures,
 * supporting arbitrary levels of recursion as required by links-notation.
 *
 * @example
 * // Direct reference by ID
 * const ref1: LinkRef = 42;
 *
 * // Nested link reference
 * const ref2: LinkRef = { id: 1, source: 2, target: 3 };
 *
 * // Deeply nested
 * const ref3: LinkRef = {
 *   id: 1,
 *   source: { id: 2, source: 3, target: 4 },
 *   target: 5
 * };
 */
export type LinkRef = LinkId | Link;

// =============================================================================
// Link Interface
// =============================================================================

/**
 * Represents a link (associative data structure) connecting source to target.
 *
 * A Link is the fundamental unit of data in links-queue. It represents
 * a directed relationship from a source to a target, identified by a unique ID.
 *
 * For compatibility with links-notation's universal link model, additional
 * values can be provided beyond the basic source/target pair.
 *
 * @property id - Unique identifier for this link
 * @property source - Reference to the source (can be another Link or LinkId)
 * @property target - Reference to the target (can be another Link or LinkId)
 * @property values - Optional additional values for universal links (extensibility)
 *
 * @example
 * // Simple doublet-style link
 * const link: Link = {
 *   id: 1,
 *   source: 2,
 *   target: 3
 * };
 *
 * @example
 * // Nested link structure
 * const nestedLink: Link = {
 *   id: 1,
 *   source: { id: 2, source: 0, target: 0 },
 *   target: { id: 3, source: 4, target: 5 }
 * };
 *
 * @example
 * // Universal link with additional values
 * const universalLink: Link = {
 *   id: 1,
 *   source: 2,
 *   target: 3,
 *   values: [4, 5, { id: 6, source: 7, target: 8 }]
 * };
 */
export interface Link {
  /**
   * Unique identifier for this link.
   */
  readonly id: LinkId;

  /**
   * Reference to the source of this link.
   * Can be a LinkId for direct reference or a nested Link for inline definition.
   */
  readonly source: LinkRef;

  /**
   * Reference to the target of this link.
   * Can be a LinkId for direct reference or a nested Link for inline definition.
   */
  readonly target: LinkRef;

  /**
   * Optional additional values for universal links.
   * Supports arbitrary number of references beyond source/target.
   * Compatible with links-notation's values array model.
   */
  readonly values?: readonly LinkRef[];
}

// =============================================================================
// Pattern Matching Types
// =============================================================================

/**
 * Special value indicating "any" match in pattern queries.
 * When used in a LinkPattern, matches any value in that position.
 */
export const Any = Symbol('Any');
export type AnyType = typeof Any;

/**
 * Pattern for matching links in queries.
 *
 * Uses `Any` symbol as a wildcard to match any value in that position.
 * Each field can be:
 * - A specific LinkRef value (exact match)
 * - The `Any` symbol (matches anything)
 * - undefined (not included in match criteria)
 *
 * @example
 * // Match all links with source = 5
 * const pattern: LinkPattern = { source: 5 };
 *
 * // Match all links with any source and target = 10
 * const pattern2: LinkPattern = { source: Any, target: 10 };
 *
 * // Match all links (equivalent to no filter)
 * const pattern3: LinkPattern = { source: Any, target: Any };
 */
export interface LinkPattern {
  /**
   * Match criteria for link ID.
   */
  readonly id?: LinkId | AnyType;

  /**
   * Match criteria for link source.
   */
  readonly source?: LinkRef | AnyType;

  /**
   * Match criteria for link target.
   */
  readonly target?: LinkRef | AnyType;
}

// =============================================================================
// LinkStore Interface
// =============================================================================

/**
 * Interface for link storage operations.
 *
 * Provides CRUD operations for managing links, plus query capabilities
 * with pattern matching support. This is the main interface that
 * implementations must satisfy.
 *
 * The design follows the doublets-rs trait pattern while maintaining
 * JavaScript/TypeScript idioms.
 *
 * @example
 * class InMemoryLinkStore implements LinkStore {
 *   // ... implementation
 * }
 *
 * const store: LinkStore = new InMemoryLinkStore();
 * const link = await store.create(1, 2);
 * console.log(link.id); // auto-generated ID
 */
export interface LinkStore {
  // ---------------------------------------------------------------------------
  // Create Operations
  // ---------------------------------------------------------------------------

  /**
   * Creates a new link from source to target.
   *
   * The implementation should auto-generate a unique ID for the link.
   *
   * @param source - The source reference for the new link
   * @param target - The target reference for the new link
   * @returns The newly created Link with its assigned ID
   *
   * @example
   * const link = await store.create(1, 2);
   * console.log(link); // { id: 1, source: 1, target: 2 }
   */
  create(source: LinkRef, target: LinkRef): Promise<Link>;

  /**
   * Creates a new link with additional values (universal link).
   *
   * @param source - The source reference for the new link
   * @param target - The target reference for the new link
   * @param values - Additional value references
   * @returns The newly created Link
   */
  createWithValues(
    source: LinkRef,
    target: LinkRef,
    values: readonly LinkRef[]
  ): Promise<Link>;

  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a link by its ID.
   *
   * @param id - The ID of the link to retrieve
   * @returns The Link if found, null otherwise
   *
   * @example
   * const link = await store.get(42);
   * if (link) {
   *   console.log(`Found: ${link.source} -> ${link.target}`);
   * }
   */
  get(id: LinkId): Promise<Link | null>;

  /**
   * Checks if a link with the given ID exists.
   *
   * @param id - The ID to check
   * @returns True if the link exists, false otherwise
   *
   * @example
   * if (await store.exists(42)) {
   *   console.log('Link 42 exists');
   * }
   */
  exists(id: LinkId): Promise<boolean>;

  /**
   * Finds links matching the given pattern.
   *
   * Supports wildcards via the `Any` symbol for flexible querying.
   *
   * @param pattern - The pattern to match against
   * @returns Array of matching links
   *
   * @example
   * // Find all links with source = 5
   * const links = await store.find({ source: 5 });
   *
   * // Find all links with any source, target = 10
   * const links2 = await store.find({ source: Any, target: 10 });
   */
  find(pattern: LinkPattern): Promise<Link[]>;

  /**
   * Counts links matching the given pattern.
   *
   * If no pattern is provided, counts all links.
   *
   * @param pattern - Optional pattern to match against
   * @returns Count of matching links
   *
   * @example
   * const total = await store.count();
   * const withSource5 = await store.count({ source: 5 });
   */
  count(pattern?: LinkPattern): Promise<number>;

  // ---------------------------------------------------------------------------
  // Update Operations
  // ---------------------------------------------------------------------------

  /**
   * Updates an existing link's source and/or target.
   *
   * @param id - The ID of the link to update
   * @param source - New source reference
   * @param target - New target reference
   * @returns The updated Link
   * @throws If the link with given ID does not exist
   *
   * @example
   * const updated = await store.update(1, 10, 20);
   * console.log(updated); // { id: 1, source: 10, target: 20 }
   */
  update(id: LinkId, source: LinkRef, target: LinkRef): Promise<Link>;

  // ---------------------------------------------------------------------------
  // Delete Operations
  // ---------------------------------------------------------------------------

  /**
   * Deletes a link by its ID.
   *
   * @param id - The ID of the link to delete
   * @returns True if the link was deleted, false if it didn't exist
   *
   * @example
   * const deleted = await store.delete(42);
   * if (deleted) {
   *   console.log('Link 42 was deleted');
   * }
   */
  delete(id: LinkId): Promise<boolean>;

  /**
   * Deletes all links matching the given pattern.
   *
   * @param pattern - The pattern to match for deletion
   * @returns Count of deleted links
   *
   * @example
   * // Delete all links with source = 5
   * const count = await store.deleteMatching({ source: 5 });
   * console.log(`Deleted ${count} links`);
   */
  deleteMatching(pattern: LinkPattern): Promise<number>;

  // ---------------------------------------------------------------------------
  // Iteration Operations
  // ---------------------------------------------------------------------------

  /**
   * Iterates over all links matching the given pattern.
   *
   * Provides an async iterator for memory-efficient traversal of large datasets.
   *
   * @param pattern - Optional pattern to filter links
   * @returns AsyncIterable of matching links
   *
   * @example
   * for await (const link of store.iterate({ source: 5 })) {
   *   console.log(link);
   * }
   */
  iterate(pattern?: LinkPattern): AsyncIterable<Link>;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Extracts the ID type from a Link type.
 */
export type LinkIdOf<L extends Link> = L['id'];

/**
 * A mutable version of Link for internal use.
 */
export interface MutableLink {
  id: LinkId;
  source: LinkRef;
  target: LinkRef;
  values?: LinkRef[];
}

/**
 * Options for creating a new link.
 */
export interface CreateLinkOptions {
  /**
   * The source reference for the new link.
   */
  source: LinkRef;

  /**
   * The target reference for the new link.
   */
  target: LinkRef;

  /**
   * Optional additional values for universal links.
   */
  values?: LinkRef[];
}

/**
 * Result type for operations that might fail.
 */
export type LinkResult<T> =
  | { success: true; value: T }
  | { success: false; error: string };

// =============================================================================
// Re-exports for convenience
// =============================================================================

/**
 * @deprecated Use Link instead. ILink is provided for backward compatibility.
 */
export type ILink = Link;
