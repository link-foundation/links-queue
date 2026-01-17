/**
 * Backend registry for links-queue.
 *
 * This module provides a registry for storage backend implementations,
 * allowing backends to be registered and instantiated by name via configuration.
 *
 * @module backends/registry
 *
 * @example
 * // Register a custom backend
 * BackendRegistry.register('my-custom', MyCustomBackend);
 *
 * // Create backend via configuration
 * const backend = BackendRegistry.create({
 *   type: 'my-custom',
 *   options: { /* custom options *\/ }
 * });
 */

import { MemoryLinkStore } from './memory.js';

/**
 * A wrapper that adapts MemoryLinkStore to the StorageBackend interface.
 *
 * This allows MemoryLinkStore to be used as a storage backend while maintaining
 * backward compatibility with its existing interface.
 *
 * @implements {import('./types.ts').StorageBackend}
 */
class MemoryBackendAdapter {
  /**
   * Creates a new MemoryBackendAdapter.
   *
   * @param {import('./types.ts').MemoryBackendOptions} [options] - Configuration options
   */
  constructor(options = {}) {
    /** @private */
    this._store = new MemoryLinkStore();

    /** @private */
    this._options = options;

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
  }

  /**
   * Establishes connection to the backend.
   * For memory backend, this is essentially a no-op but tracks connection state.
   *
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line require-await
  async connect() {
    if (this._connected) {
      return;
    }
    this._connected = true;
    this._connectedAt = new Date().toISOString();
  }

  /**
   * Disconnects from the backend.
   * For memory backend, this clears the connection state.
   *
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line require-await
  async disconnect() {
    this._connected = false;
    this._connectedAt = null;
  }

  /**
   * Checks if the backend is connected.
   *
   * @returns {boolean}
   */
  isConnected() {
    return this._connected;
  }

  /**
   * Saves a link to storage.
   *
   * @param {import('../types.js').Link} link - The link to save
   * @returns {Promise<import('../types.js').LinkId>}
   */
  async save(link) {
    this._ensureConnected();
    this._stats.writes++;

    // If the link has an ID of 0 or is "nothing", create a new link
    if (link.id === 0 || link.id === '' || link.id === 0n) {
      const created = link.values
        ? await this._store.createWithValues(
            link.source,
            link.target,
            link.values
          )
        : await this._store.create(link.source, link.target);
      return created.id;
    }

    // Otherwise, update existing or create with the given ID
    // For memory backend, we'll try to update first, then create if not exists
    const existing = await this._store.get(link.id);
    if (existing) {
      const updated = await this._store.update(
        link.id,
        link.source,
        link.target
      );
      return updated.id;
    }

    // Create new link (will use auto-generated ID)
    const created = link.values
      ? await this._store.createWithValues(
          link.source,
          link.target,
          link.values
        )
      : await this._store.create(link.source, link.target);
    return created.id;
  }

  /**
   * Loads a link by ID.
   *
   * @param {import('../types.js').LinkId} id - The link ID
   * @returns {Promise<import('../types.js').Link | null>}
   */
  // eslint-disable-next-line require-await
  async load(id) {
    this._ensureConnected();
    this._stats.reads++;
    return this._store.get(id);
  }

  /**
   * Deletes a link by ID.
   *
   * @param {import('../types.js').LinkId} id - The link ID
   * @returns {Promise<boolean>}
   */
  // eslint-disable-next-line require-await
  async delete(id) {
    this._ensureConnected();
    this._stats.deletes++;
    return this._store.delete(id);
  }

  /**
   * Queries links by pattern.
   *
   * @param {import('../types.js').LinkPattern} pattern - The pattern to match
   * @returns {Promise<import('../types.js').Link[]>}
   */
  // eslint-disable-next-line require-await
  async query(pattern) {
    this._ensureConnected();
    this._stats.queries++;
    return this._store.find(pattern);
  }

  /**
   * Saves multiple links in batch.
   *
   * @param {readonly import('../types.js').Link[]} links - Links to save
   * @returns {Promise<import('../types.js').LinkId[]>}
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
   * Deletes multiple links in batch.
   *
   * @param {readonly import('../types.js').LinkId[]} ids - IDs to delete
   * @returns {Promise<boolean[]>}
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

  /**
   * Returns backend capabilities.
   *
   * @returns {import('./types.ts').BackendCapabilities}
   */
  getCapabilities() {
    return {
      supportsTransactions: false,
      supportsBatchOperations: false, // We simulate batch ops
      durabilityLevel: 'none',
      maxLinkSize: 0, // Unlimited
      supportsPatternQueries: true,
    };
  }

  /**
   * Returns backend statistics.
   *
   * @returns {import('./types.ts').BackendStats}
   */
  getStats() {
    const now = Date.now();
    const connectedTime = this._connectedAt
      ? new Date(this._connectedAt).getTime()
      : now;

    return {
      totalLinks: this._store._links.size,
      usedSpace: 0, // Not tracked for memory backend
      operations: { ...this._stats },
      connectedAt: this._connectedAt,
      uptimeMs: this._connected ? now - connectedTime : 0,
    };
  }

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
   * Clears all data (for testing).
   *
   * @returns {Promise<void>}
   */
  async clear() {
    await this._store.clear();
    this._stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      queries: 0,
    };
  }
}

/**
 * Registry for storage backend implementations.
 *
 * Provides methods to register custom backends and create backend instances
 * from configuration.
 *
 * @example
 * // Register a custom backend
 * BackendRegistry.register('redis', RedisBackend);
 *
 * // Create from config
 * const backend = BackendRegistry.create({ type: 'redis', options: { host: 'localhost' } });
 */
class BackendRegistryClass {
  constructor() {
    /**
     * Map of backend type names to constructors/factories.
     * @private
     * @type {Map<string, import('./types.ts').BackendConstructor | import('./types.ts').BackendFactory>}
     */
    this._backends = new Map();

    // Register built-in backends
    this._backends.set('memory', MemoryBackendAdapter);
  }

  /**
   * Registers a backend implementation.
   *
   * @param {string} name - The name to register the backend under
   * @param {import('./types.ts').BackendConstructor | import('./types.ts').BackendFactory} backend - The backend constructor or factory
   * @throws {Error} If name is empty or backend is invalid
   *
   * @example
   * // Register with constructor
   * BackendRegistry.register('my-backend', MyBackend);
   *
   * // Register with factory
   * BackendRegistry.register('complex-backend', (opts) => new ComplexBackend(opts));
   */
  register(name, backend) {
    if (!name || typeof name !== 'string') {
      throw new Error('Backend name must be a non-empty string');
    }

    if (typeof backend !== 'function') {
      throw new Error('Backend must be a constructor or factory function');
    }

    this._backends.set(name, backend);
  }

  /**
   * Unregisters a backend implementation.
   *
   * @param {string} name - The name of the backend to unregister
   * @returns {boolean} True if the backend was unregistered, false if it wasn't registered
   *
   * @example
   * BackendRegistry.unregister('my-backend');
   */
  unregister(name) {
    return this._backends.delete(name);
  }

  /**
   * Checks if a backend is registered.
   *
   * @param {string} name - The backend name to check
   * @returns {boolean} True if registered
   *
   * @example
   * if (BackendRegistry.has('redis')) {
   *   const backend = BackendRegistry.create({ type: 'redis' });
   * }
   */
  has(name) {
    return this._backends.has(name);
  }

  /**
   * Creates a backend instance from configuration.
   *
   * @param {import('./types.ts').BackendOptions} config - Backend configuration
   * @returns {import('./types.ts').StorageBackend} The created backend instance
   * @throws {Error} If the backend type is not registered
   *
   * @example
   * const memoryBackend = BackendRegistry.create({ type: 'memory' });
   *
   * const customBackend = BackendRegistry.create({
   *   type: 'my-custom',
   *   options: { host: 'localhost', port: 6379 }
   * });
   */
  create(config) {
    const { type, options } = config;

    const Backend = this._backends.get(type);
    if (!Backend) {
      throw new Error(
        `Unknown backend type: "${type}". ` +
          `Available types: ${this.listTypes().join(', ')}`
      );
    }

    // Try to instantiate - could be constructor or factory
    try {
      // Check if it's a class (has prototype with constructor)
      if (Backend.prototype && Backend.prototype.constructor === Backend) {
        return new Backend(options);
      }
      // Otherwise it's a factory function
      return Backend(options);
    } catch (error) {
      throw new Error(`Failed to create backend "${type}": ${error.message}`);
    }
  }

  /**
   * Lists all registered backend types.
   *
   * @returns {string[]} Array of registered backend type names
   *
   * @example
   * const types = BackendRegistry.listTypes();
   * console.log(types); // ['memory', 'my-custom', ...]
   */
  listTypes() {
    return Array.from(this._backends.keys());
  }

  /**
   * Resets the registry to default state (only built-in backends).
   *
   * Primarily useful for testing.
   */
  reset() {
    this._backends.clear();
    this._backends.set('memory', MemoryBackendAdapter);
  }
}

/**
 * Singleton instance of the backend registry.
 *
 * @type {BackendRegistryClass}
 *
 * @example
 * import { BackendRegistry } from 'links-queue';
 *
 * // Register custom backend
 * BackendRegistry.register('redis', RedisBackend);
 *
 * // Create backend
 * const backend = BackendRegistry.create({ type: 'redis' });
 */
export const BackendRegistry = new BackendRegistryClass();

/**
 * The memory backend adapter class (exported for direct use).
 */
export { MemoryBackendAdapter };
