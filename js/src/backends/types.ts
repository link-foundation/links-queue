/**
 * Storage backend type definitions for links-queue.
 *
 * This module defines the StorageBackend interface that enables pluggable
 * storage backends. Implementations can provide different tradeoffs between
 * performance, durability, and features.
 *
 * @module backends/types
 *
 * @see ARCHITECTURE.md - Storage Backend Layer
 * @see REQUIREMENTS.md - REQ-STORE-001 through REQ-STORE-022
 */

import type { Link, LinkId, LinkPattern, LinkRef } from '../types.js';

// =============================================================================
// Backend Capabilities
// =============================================================================

/**
 * Durability level supported by a storage backend.
 *
 * - `none`: No durability guarantees (in-memory only)
 * - `fsync`: Data is synced to disk
 * - `replicated`: Data is replicated across multiple nodes
 */
export type DurabilityLevel = 'none' | 'fsync' | 'replicated';

/**
 * Describes the capabilities of a storage backend.
 *
 * This allows the system to validate that a backend meets the requirements
 * for a given operating mode and to adapt behavior accordingly.
 *
 * @example
 * const capabilities = backend.getCapabilities();
 * if (capabilities.supportsTransactions) {
 *   // Use transactional operations
 * }
 */
export interface BackendCapabilities {
  /**
   * Whether the backend supports atomic transactions.
   */
  readonly supportsTransactions: boolean;

  /**
   * Whether the backend supports batch operations natively.
   * If false, batch operations are simulated with individual operations.
   */
  readonly supportsBatchOperations: boolean;

  /**
   * The durability level provided by this backend.
   */
  readonly durabilityLevel: DurabilityLevel;

  /**
   * Maximum size of a single link in bytes (0 for unlimited).
   */
  readonly maxLinkSize: number;

  /**
   * Whether the backend supports pattern-based queries natively.
   * If false, queries are performed by scanning all links.
   */
  readonly supportsPatternQueries: boolean;
}

// =============================================================================
// Backend Statistics
// =============================================================================

/**
 * Operation counters for backend statistics.
 */
export interface OperationStats {
  /**
   * Number of read operations performed.
   */
  readonly reads: number;

  /**
   * Number of write operations performed (save/update).
   */
  readonly writes: number;

  /**
   * Number of delete operations performed.
   */
  readonly deletes: number;

  /**
   * Number of query operations performed.
   */
  readonly queries: number;
}

/**
 * Statistics and metrics for a storage backend.
 *
 * @example
 * const stats = backend.getStats();
 * console.log(`Total links: ${stats.totalLinks}`);
 * console.log(`Used space: ${stats.usedSpace} bytes`);
 */
export interface BackendStats {
  /**
   * Total number of links stored.
   */
  readonly totalLinks: number;

  /**
   * Approximate storage space used in bytes.
   */
  readonly usedSpace: number;

  /**
   * Operation counters.
   */
  readonly operations: OperationStats;

  /**
   * Timestamp when the backend was connected (ISO string).
   */
  readonly connectedAt: string | null;

  /**
   * Uptime in milliseconds since connection.
   */
  readonly uptimeMs: number;
}

// =============================================================================
// Storage Backend Interface
// =============================================================================

/**
 * Interface for pluggable storage backends.
 *
 * This abstraction allows switching between memory, link-cli, and custom
 * backends via configuration without code changes.
 *
 * Following [code-architecture-principles](https://github.com/link-foundation/code-architecture-principles):
 * - **Interfaces & Abstraction**: Hide implementation details behind stable contracts
 * - **Configuration Over Code**: Scale from embedded to distributed without code changes
 *
 * @example
 * // Create a backend
 * const backend = new MemoryBackend();
 *
 * // Connect and use
 * await backend.connect();
 *
 * // Save a link
 * const id = await backend.save({ id: 0, source: 1, target: 2 });
 *
 * // Load it back
 * const link = await backend.load(id);
 *
 * // Query by pattern
 * const links = await backend.query({ source: 1 });
 *
 * // Disconnect when done
 * await backend.disconnect();
 */
export interface StorageBackend {
  // ---------------------------------------------------------------------------
  // Lifecycle Operations
  // ---------------------------------------------------------------------------

  /**
   * Establishes a connection to the storage backend.
   *
   * This should be called before any other operations. For in-memory backends,
   * this may be a no-op but should still be called for consistency.
   *
   * @throws If connection fails
   *
   * @example
   * const backend = new LinkCliBackend({ path: './data/db.links' });
   * await backend.connect();
   */
  connect(): Promise<void>;

  /**
   * Gracefully disconnects from the storage backend.
   *
   * This should flush any pending writes and release resources.
   *
   * @example
   * await backend.disconnect();
   */
  disconnect(): Promise<void>;

  /**
   * Checks if the backend is currently connected.
   *
   * @returns True if connected and ready for operations
   *
   * @example
   * if (!backend.isConnected()) {
   *   await backend.connect();
   * }
   */
  isConnected(): boolean;

  // ---------------------------------------------------------------------------
  // Core Operations
  // ---------------------------------------------------------------------------

  /**
   * Saves a link to storage.
   *
   * If the link's ID is 0 or represents "nothing", a new ID will be assigned.
   * If the link already exists (by structure, for deduplication), the existing
   * ID may be returned depending on the backend's deduplication strategy.
   *
   * @param link - The link to save
   * @returns The ID of the saved link (may be new or existing)
   *
   * @example
   * const id = await backend.save({ id: 0, source: 1, target: 2 });
   * console.log(`Saved link with ID: ${id}`);
   */
  save(link: Link): Promise<LinkId>;

  /**
   * Loads a link by its ID.
   *
   * @param id - The ID of the link to load
   * @returns The link if found, null otherwise
   *
   * @example
   * const link = await backend.load(42);
   * if (link) {
   *   console.log(`Link: ${link.source} -> ${link.target}`);
   * }
   */
  load(id: LinkId): Promise<Link | null>;

  /**
   * Deletes a link by its ID.
   *
   * @param id - The ID of the link to delete
   * @returns True if the link was deleted, false if it didn't exist
   *
   * @example
   * const deleted = await backend.delete(42);
   * if (deleted) {
   *   console.log('Link deleted');
   * }
   */
  delete(id: LinkId): Promise<boolean>;

  /**
   * Queries links matching a pattern.
   *
   * @param pattern - The pattern to match
   * @returns Array of matching links
   *
   * @example
   * // Find all links with source = 5
   * const links = await backend.query({ source: 5 });
   */
  query(pattern: LinkPattern): Promise<Link[]>;

  // ---------------------------------------------------------------------------
  // Batch Operations
  // ---------------------------------------------------------------------------

  /**
   * Saves multiple links in a batch.
   *
   * For backends that support native batch operations, this is more efficient
   * than calling save() repeatedly. For others, it falls back to individual saves.
   *
   * @param links - Array of links to save
   * @returns Array of IDs (in the same order as input)
   *
   * @example
   * const ids = await backend.saveBatch([
   *   { id: 0, source: 1, target: 2 },
   *   { id: 0, source: 3, target: 4 },
   * ]);
   */
  saveBatch(links: readonly Link[]): Promise<LinkId[]>;

  /**
   * Deletes multiple links by their IDs.
   *
   * @param ids - Array of IDs to delete
   * @returns Array of booleans indicating success for each deletion (in order)
   *
   * @example
   * const results = await backend.deleteBatch([1, 2, 3]);
   * const deletedCount = results.filter(Boolean).length;
   */
  deleteBatch(ids: readonly LinkId[]): Promise<boolean[]>;

  // ---------------------------------------------------------------------------
  // Metadata Operations
  // ---------------------------------------------------------------------------

  /**
   * Returns the capabilities of this backend.
   *
   * @returns Backend capabilities descriptor
   *
   * @example
   * const caps = backend.getCapabilities();
   * if (caps.durabilityLevel === 'none') {
   *   console.warn('Data will be lost on restart');
   * }
   */
  getCapabilities(): BackendCapabilities;

  /**
   * Returns statistics about the backend.
   *
   * @returns Current backend statistics
   *
   * @example
   * const stats = backend.getStats();
   * console.log(`Total links: ${stats.totalLinks}`);
   */
  getStats(): BackendStats;
}

// =============================================================================
// Backend Configuration
// =============================================================================

/**
 * Configuration options for memory backend.
 */
export interface MemoryBackendOptions {
  /**
   * Initial capacity for the link storage (hint for pre-allocation).
   */
  initialCapacity?: number;

  /**
   * Whether to enable link deduplication.
   * @default true
   */
  deduplication?: boolean;
}

/**
 * Configuration options for link-cli backend.
 */
export interface LinkCliBackendOptions {
  /**
   * Path to the SQLite database file.
   */
  path: string;

  /**
   * Whether to create the database if it doesn't exist.
   * @default true
   */
  createIfMissing?: boolean;

  /**
   * Whether to enable write-ahead logging (WAL) mode.
   * @default true
   */
  walMode?: boolean;
}

/**
 * Generic backend configuration for custom backends.
 */
export interface CustomBackendOptions {
  [key: string]: unknown;
}

/**
 * Union type for all backend configuration options.
 */
export type BackendOptions =
  | { type: 'memory'; options?: MemoryBackendOptions }
  | { type: 'link-cli'; options: LinkCliBackendOptions }
  | { type: string; options?: CustomBackendOptions };

// =============================================================================
// Backend Factory Types
// =============================================================================

/**
 * Constructor type for storage backends.
 *
 * Used by the backend registry for creating backend instances.
 */
export type BackendConstructor = new (
  options?: CustomBackendOptions
) => StorageBackend;

/**
 * Factory function type for creating storage backends.
 *
 * Can be used instead of a constructor for more complex initialization.
 */
export type BackendFactory = (options?: CustomBackendOptions) => StorageBackend;
