/**
 * link-cli storage backend for links-queue.
 *
 * This backend provides persistent storage via link-cli, a command-line tool
 * for manipulating links using CRUD operations. Data is stored in a SQLite-like
 * database file, enabling durable queue storage.
 *
 * @module backends/link-cli
 *
 * @see ARCHITECTURE.md - link-cli Backend section
 * @see REQUIREMENTS.md - REQ-MODE-010 through REQ-MODE-013
 * @see https://github.com/link-foundation/link-cli
 */

import { LinkCliProcess } from './link-cli-process.js';
import { createLink, getLinkId } from '../index.js';

/**
 * Storage backend implementation using link-cli.
 *
 * This backend communicates with link-cli via child processes, executing
 * queries using the Links Notation format. Each operation spawns a new
 * process (link-cli operates in command mode).
 *
 * @implements {import('./types.ts').StorageBackend}
 *
 * @example
 * import { LinkCliBackend } from 'links-queue';
 *
 * const backend = new LinkCliBackend({
 *   path: './data/db.links',
 *   // Optional: path to link-cli binary
 *   binaryPath: '/usr/local/bin/clink'
 * });
 *
 * await backend.connect();
 *
 * // All operations are durable
 * const id = await backend.save({ id: 0, source: 1, target: 2 });
 * const link = await backend.load(id);
 *
 * await backend.disconnect();
 */
export class LinkCliBackend {
  /**
   * Creates a new LinkCliBackend instance.
   *
   * @param {import('./types.ts').LinkCliBackendOptions} options - Configuration options
   * @param {string} options.path - Path to the SQLite database file
   * @param {boolean} [options.createIfMissing=true] - Create database if missing
   * @param {boolean} [options.walMode=true] - Enable WAL mode
   * @param {string} [options.binaryPath='clink'] - Path to link-cli binary
   */
  constructor(options) {
    if (!options || !options.path) {
      throw new Error('LinkCliBackend requires a path option');
    }

    /** @private */
    this._options = {
      createIfMissing: true,
      walMode: true,
      binaryPath: 'clink',
      ...options,
    };

    /** @private */
    this._process = new LinkCliProcess({
      dbPath: this._options.path,
      binaryPath: this._options.binaryPath,
    });

    /** @private */
    this._connected = false;

    /** @private */
    this._connectedAt = null;

    /** @private */
    this._stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      queries: 0,
    };

    /**
     * Cache for link-to-ID mapping (for deduplication).
     * @private
     * @type {Map<string, import('../index.d.ts').LinkId>}
     */
    this._linkIdCache = new Map();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Operations
  // ---------------------------------------------------------------------------

  /**
   * Establishes connection to the link-cli backend.
   *
   * Verifies that the link-cli binary is available and optionally
   * initializes the database.
   *
   * @returns {Promise<void>}
   * @throws {Error} If link-cli binary is not available
   *
   * @example
   * const backend = new LinkCliBackend({ path: './data/db.links' });
   * await backend.connect();
   */
  async connect() {
    if (this._connected) {
      return;
    }

    // Check if binary is available
    const available = await this._process.checkBinaryAvailable();
    if (!available) {
      throw new Error(
        `link-cli binary not found at "${this._options.binaryPath}". ` +
          'Install it with: dotnet tool install --global clink'
      );
    }

    // Initialize database by executing a read query
    // This creates the database file if it doesn't exist
    try {
      await this._process.readLinks();
    } catch {
      // If the database doesn't exist and createIfMissing is false, throw
      if (!this._options.createIfMissing) {
        throw new Error(`Database not found at ${this._options.path}`);
      }
      // Otherwise, the database will be created on first write
    }

    this._connected = true;
    this._connectedAt = new Date().toISOString();
  }

  /**
   * Disconnects from the link-cli backend.
   *
   * Clears internal caches and connection state.
   *
   * @returns {Promise<void>}
   *
   * @example
   * await backend.disconnect();
   */
  // eslint-disable-next-line require-await
  async disconnect() {
    this._connected = false;
    this._connectedAt = null;
    this._linkIdCache.clear();
  }

  /**
   * Checks if the backend is currently connected.
   *
   * @returns {boolean} True if connected
   */
  isConnected() {
    return this._connected;
  }

  // ---------------------------------------------------------------------------
  // Core Operations
  // ---------------------------------------------------------------------------

  /**
   * Saves a link to storage.
   *
   * If the link's ID is 0 or represents "nothing", a new link is created.
   * link-cli automatically handles deduplication of identical structures.
   *
   * @param {import('../index.d.ts').Link} link - The link to save
   * @returns {Promise<import('../index.d.ts').LinkId>} The ID of the saved link
   *
   * @example
   * const id = await backend.save({ id: 0, source: 1, target: 2 });
   * console.log(`Saved link with ID: ${id}`);
   */
  async save(link) {
    this._ensureConnected();
    this._stats.writes++;

    const source = getLinkId(link.source);
    const target = getLinkId(link.target);

    // Create the link via link-cli
    const created = await this._process.createLink(source, target);

    if (created) {
      // Cache the mapping for future lookups
      const cacheKey = this._getCacheKey(source, target);
      this._linkIdCache.set(cacheKey, created.id);
      return created.id;
    }

    // If create didn't return a result, try to read the existing link
    // (link-cli deduplicates, so identical structures share the same ID)
    const existing = await this._process.readLinks({ source, target });
    if (existing.length > 0) {
      const id = existing[0].id;
      const cacheKey = this._getCacheKey(source, target);
      this._linkIdCache.set(cacheKey, id);
      return id;
    }

    throw new Error('Failed to save link: no ID returned');
  }

  /**
   * Loads a link by its ID.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the link to load
   * @returns {Promise<import('../index.d.ts').Link | null>} The link if found
   *
   * @example
   * const link = await backend.load(42);
   * if (link) {
   *   console.log(`Link: ${link.source} -> ${link.target}`);
   * }
   */
  async load(id) {
    this._ensureConnected();
    this._stats.reads++;

    const numericId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
    const links = await this._process.readLinks({ id: numericId });

    if (links.length === 0) {
      return null;
    }

    const link = links[0];
    return createLink(link.id, link.source, link.target);
  }

  /**
   * Deletes a link by its ID.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the link to delete
   * @returns {Promise<boolean>} True if the link was deleted
   *
   * @example
   * const deleted = await backend.delete(42);
   * if (deleted) {
   *   console.log('Link deleted');
   * }
   */
  async delete(id) {
    this._ensureConnected();
    this._stats.deletes++;

    const numericId = typeof id === 'string' ? parseInt(id, 10) : Number(id);

    // First load the link to get its source/target (needed for deletion)
    const links = await this._process.readLinks({ id: numericId });
    if (links.length === 0) {
      return false;
    }

    const link = links[0];
    const deleted = await this._process.deleteLink(link.source, link.target);

    if (deleted) {
      // Remove from cache
      const cacheKey = this._getCacheKey(link.source, link.target);
      this._linkIdCache.delete(cacheKey);
    }

    return deleted;
  }

  /**
   * Queries links matching a pattern.
   *
   * @param {import('../index.d.ts').LinkPattern} pattern - The pattern to match
   * @returns {Promise<import('../index.d.ts').Link[]>} Array of matching links
   *
   * @example
   * // Find all links with source = 5
   * const links = await backend.query({ source: 5 });
   */
  async query(pattern) {
    this._ensureConnected();
    this._stats.queries++;

    // Build pattern for link-cli
    const queryPattern = {};

    if (pattern.id !== undefined && pattern.id !== Symbol.for('Any')) {
      queryPattern.id = getLinkId(pattern.id);
    }
    if (pattern.source !== undefined && pattern.source !== Symbol.for('Any')) {
      queryPattern.source = getLinkId(pattern.source);
    }
    if (pattern.target !== undefined && pattern.target !== Symbol.for('Any')) {
      queryPattern.target = getLinkId(pattern.target);
    }

    const rawLinks = await this._process.readLinks(queryPattern);

    return rawLinks.map((link) =>
      createLink(link.id, link.source, link.target)
    );
  }

  // ---------------------------------------------------------------------------
  // Batch Operations
  // ---------------------------------------------------------------------------

  /**
   * Saves multiple links in a batch.
   *
   * Note: link-cli doesn't support native batch operations, so this
   * executes individual save operations sequentially.
   *
   * @param {readonly import('../index.d.ts').Link[]} links - Links to save
   * @returns {Promise<import('../index.d.ts').LinkId[]>} Array of IDs
   *
   * @example
   * const ids = await backend.saveBatch([
   *   { id: 0, source: 1, target: 2 },
   *   { id: 0, source: 3, target: 4 },
   * ]);
   */
  async saveBatch(links) {
    this._ensureConnected();
    const ids = [];

    for (const link of links) {
      const id = await this.save(link);
      ids.push(id);
    }

    return ids;
  }

  /**
   * Deletes multiple links by their IDs.
   *
   * @param {readonly import('../index.d.ts').LinkId[]} ids - IDs to delete
   * @returns {Promise<boolean[]>} Array of results
   *
   * @example
   * const results = await backend.deleteBatch([1, 2, 3]);
   */
  async deleteBatch(ids) {
    this._ensureConnected();
    const results = [];

    for (const id of ids) {
      const result = await this.delete(id);
      results.push(result);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Metadata Operations
  // ---------------------------------------------------------------------------

  /**
   * Returns the capabilities of this backend.
   *
   * @returns {import('./types.ts').BackendCapabilities}
   *
   * @example
   * const caps = backend.getCapabilities();
   * console.log(caps.durabilityLevel); // 'fsync'
   */
  getCapabilities() {
    return {
      supportsTransactions: false, // link-cli doesn't expose transaction API
      supportsBatchOperations: false, // We simulate batch ops
      durabilityLevel: 'fsync', // SQLite with fsync
      maxLinkSize: 0, // Unlimited
      supportsPatternQueries: true,
    };
  }

  /**
   * Returns statistics about the backend.
   *
   * @returns {import('./types.ts').BackendStats}
   *
   * @example
   * const stats = backend.getStats();
   * console.log(`Total links: ${stats.totalLinks}`);
   */
  getStats() {
    const now = Date.now();
    const connectedTime = this._connectedAt
      ? new Date(this._connectedAt).getTime()
      : now;

    // Get total links count (this is a blocking operation)
    let totalLinks = 0;
    if (this._connected) {
      // Note: This is synchronous based on cache, actual count requires async
      totalLinks = this._linkIdCache.size;
    }

    return {
      totalLinks,
      usedSpace: 0, // Would require file stat
      operations: { ...this._stats },
      connectedAt: this._connectedAt,
      uptimeMs: this._connected ? now - connectedTime : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensures the backend is connected before operations.
   *
   * @private
   * @throws {Error} If not connected
   */
  _ensureConnected() {
    if (!this._connected) {
      throw new Error('Backend is not connected. Call connect() first.');
    }
  }

  /**
   * Generates a cache key for source/target pairs.
   *
   * @private
   * @param {number|string} source - Source reference
   * @param {number|string} target - Target reference
   * @returns {string} Cache key
   */
  _getCacheKey(source, target) {
    return `${source}:${target}`;
  }
}
