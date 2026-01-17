/**
 * Tests for BackendRegistry and MemoryBackendAdapter
 *
 * Note: This test avoids beforeEach for Deno compatibility.
 * Deno's node:test compatibility layer doesn't support beforeEach.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BackendRegistry,
  MemoryBackendAdapter,
  createLink,
} from '../src/index.js';

/**
 * Creates a connected backend for testing.
 * @returns {Promise<MemoryBackendAdapter>}
 */
async function createConnectedBackend() {
  const backend = new MemoryBackendAdapter();
  await backend.connect();
  return backend;
}

// eslint-disable-next-line max-lines-per-function
describe('MemoryBackendAdapter', () => {
  describe('lifecycle', () => {
    it('should start disconnected', () => {
      const backend = new MemoryBackendAdapter();
      assert.strictEqual(backend.isConnected(), false);
    });

    it('should connect and disconnect', async () => {
      const backend = new MemoryBackendAdapter();

      await backend.connect();
      assert.strictEqual(backend.isConnected(), true);

      await backend.disconnect();
      assert.strictEqual(backend.isConnected(), false);
    });

    it('should track connection time in stats', async () => {
      const backend = new MemoryBackendAdapter();
      const statsBefore = backend.getStats();
      assert.strictEqual(statsBefore.connectedAt, null);

      await backend.connect();
      const statsAfter = backend.getStats();
      assert.ok(statsAfter.connectedAt !== null);
      // connectedAt is stored as ISO string
      assert.ok(typeof statsAfter.connectedAt === 'string');
      assert.ok(new Date(statsAfter.connectedAt).getTime() > 0);
    });
  });

  describe('CRUD operations', () => {
    it('should save a link and return ID', async () => {
      const backend = await createConnectedBackend();
      const link = createLink(0, 1, 2);
      const id = await backend.save(link);
      assert.ok(id !== 0);
    });

    it('should load a saved link', async () => {
      const backend = await createConnectedBackend();
      const link = createLink(0, 1, 2);
      const id = await backend.save(link);

      const loaded = await backend.load(id);
      assert.ok(loaded !== null);
      assert.strictEqual(loaded.source, 1);
      assert.strictEqual(loaded.target, 2);
    });

    it('should return null for non-existent link', async () => {
      const backend = await createConnectedBackend();
      const loaded = await backend.load(999);
      assert.strictEqual(loaded, null);
    });

    it('should delete a link', async () => {
      const backend = await createConnectedBackend();
      const link = createLink(0, 1, 2);
      const id = await backend.save(link);

      const deleted = await backend.delete(id);
      assert.strictEqual(deleted, true);

      const loaded = await backend.load(id);
      assert.strictEqual(loaded, null);
    });

    it('should return false when deleting non-existent link', async () => {
      const backend = await createConnectedBackend();
      const deleted = await backend.delete(999);
      assert.strictEqual(deleted, false);
    });

    it('should query links by pattern', async () => {
      const backend = await createConnectedBackend();
      await backend.save(createLink(0, 1, 2));
      await backend.save(createLink(0, 1, 3));
      await backend.save(createLink(0, 2, 3));

      const results = await backend.query({ source: 1 });
      assert.strictEqual(results.length, 2);
    });

    it('should query all links with empty pattern', async () => {
      const backend = await createConnectedBackend();
      await backend.save(createLink(0, 1, 2));
      await backend.save(createLink(0, 3, 4));

      const results = await backend.query({});
      assert.strictEqual(results.length, 2);
    });
  });

  describe('batch operations', () => {
    it('should save multiple links in batch', async () => {
      const backend = await createConnectedBackend();
      const links = [
        createLink(0, 1, 2),
        createLink(0, 3, 4),
        createLink(0, 5, 6),
      ];

      const ids = await backend.saveBatch(links);
      assert.strictEqual(ids.length, 3);
      assert.ok(ids.every((id) => id !== 0));
    });

    it('should delete multiple links in batch', async () => {
      const backend = await createConnectedBackend();
      const id1 = await backend.save(createLink(0, 1, 2));
      const id2 = await backend.save(createLink(0, 3, 4));

      const results = await backend.deleteBatch([id1, id2, 999]);
      assert.deepStrictEqual(results, [true, true, false]);
    });
  });

  describe('capabilities and stats', () => {
    it('should return correct capabilities', () => {
      const backend = new MemoryBackendAdapter();
      const caps = backend.getCapabilities();

      assert.strictEqual(caps.supportsTransactions, false);
      assert.strictEqual(caps.supportsBatchOperations, false);
      assert.strictEqual(caps.durabilityLevel, 'none');
      assert.strictEqual(caps.maxLinkSize, 0);
      assert.strictEqual(caps.supportsPatternQueries, true);
    });

    it('should track operation statistics', async () => {
      const backend = await createConnectedBackend();

      const id = await backend.save(createLink(0, 1, 2));
      await backend.load(id);
      await backend.query({});
      await backend.delete(id);

      const stats = backend.getStats();
      assert.strictEqual(stats.operations.writes, 1);
      assert.strictEqual(stats.operations.reads, 1);
      assert.strictEqual(stats.operations.queries, 1);
      assert.strictEqual(stats.operations.deletes, 1);
    });

    it('should track total links count', async () => {
      const backend = await createConnectedBackend();

      await backend.save(createLink(0, 1, 2));
      await backend.save(createLink(0, 3, 4));

      const stats = backend.getStats();
      assert.strictEqual(stats.totalLinks, 2);
    });
  });

  describe('clear', () => {
    it('should clear all links', async () => {
      const backend = await createConnectedBackend();

      await backend.save(createLink(0, 1, 2));
      await backend.save(createLink(0, 3, 4));

      await backend.clear();

      const stats = backend.getStats();
      assert.strictEqual(stats.totalLinks, 0);
    });
  });

  describe('error handling', () => {
    it('should throw when saving without connection', async () => {
      const backend = new MemoryBackendAdapter();
      // Not connected

      await assert.rejects(async () => {
        await backend.save(createLink(0, 1, 2));
      }, /not connected/i);
    });

    it('should throw when loading without connection', async () => {
      const backend = new MemoryBackendAdapter();

      await assert.rejects(async () => {
        await backend.load(1);
      }, /not connected/i);
    });

    it('should throw when deleting without connection', async () => {
      const backend = new MemoryBackendAdapter();

      await assert.rejects(async () => {
        await backend.delete(1);
      }, /not connected/i);
    });

    it('should throw when querying without connection', async () => {
      const backend = new MemoryBackendAdapter();

      await assert.rejects(async () => {
        await backend.query({});
      }, /not connected/i);
    });
  });
});

describe('BackendRegistry', () => {
  // Note: Each test resets the registry to ensure clean state
  // This replaces beforeEach for Deno compatibility

  describe('registration', () => {
    it('should have memory backend registered by default', () => {
      BackendRegistry.reset();
      assert.strictEqual(BackendRegistry.has('memory'), true);
    });

    it('should list registered types', () => {
      BackendRegistry.reset();
      const types = BackendRegistry.listTypes();
      assert.ok(types.includes('memory'));
    });

    it('should register a custom backend', () => {
      BackendRegistry.reset();
      BackendRegistry.register('custom', () => new MemoryBackendAdapter());
      assert.strictEqual(BackendRegistry.has('custom'), true);
    });

    it('should unregister a backend', () => {
      BackendRegistry.reset();
      BackendRegistry.register('custom', () => new MemoryBackendAdapter());
      const result = BackendRegistry.unregister('custom');
      assert.strictEqual(result, true);
      assert.strictEqual(BackendRegistry.has('custom'), false);
    });

    it('should return false when unregistering non-existent backend', () => {
      BackendRegistry.reset();
      const result = BackendRegistry.unregister('non-existent');
      assert.strictEqual(result, false);
    });
  });

  describe('creation', () => {
    it('should create memory backend by default', () => {
      BackendRegistry.reset();
      const backend = BackendRegistry.create({ type: 'memory' });
      assert.ok(backend instanceof MemoryBackendAdapter);
    });

    it('should create backend with options', () => {
      BackendRegistry.reset();
      const backend = BackendRegistry.create({
        type: 'memory',
        options: { initialCapacity: 100 },
      });
      assert.ok(backend instanceof MemoryBackendAdapter);
    });

    it('should throw for unknown backend type', () => {
      BackendRegistry.reset();
      assert.throws(() => {
        BackendRegistry.create({ type: 'unknown' });
      }, /unknown/i);
    });

    it('should create custom backend', () => {
      BackendRegistry.reset();
      let factoryCalled = false;
      BackendRegistry.register('custom', (config) => {
        factoryCalled = true;
        return new MemoryBackendAdapter(config.options);
      });

      const backend = BackendRegistry.create({
        type: 'custom',
        options: { initialCapacity: 50 },
      });

      assert.strictEqual(factoryCalled, true);
      assert.ok(backend instanceof MemoryBackendAdapter);
    });
  });

  describe('reset', () => {
    it('should restore default state', () => {
      BackendRegistry.reset();
      BackendRegistry.register('custom', () => new MemoryBackendAdapter());
      BackendRegistry.reset();

      assert.strictEqual(BackendRegistry.has('custom'), false);
      assert.strictEqual(BackendRegistry.has('memory'), true);
    });
  });
});
