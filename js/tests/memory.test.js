/**
 * Tests for MemoryLinkStore implementation.
 * Works with Node.js, Bun, and Deno via test-anywhere.
 */

/* eslint-disable max-lines-per-function */

import { describe, it, expect, beforeEach } from 'test-anywhere';
import { MemoryLinkStore, Any, createLink } from '../src/index.js';

describe('MemoryLinkStore', () => {
  /** @type {MemoryLinkStore} */
  let store;

  beforeEach(() => {
    store = new MemoryLinkStore();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create an empty store', async () => {
      expect(await store.count()).toBe(0);
    });

    it('should initialize with sequential IDs starting from 1', async () => {
      const link = await store.create(10, 20);
      expect(link.id).toBe(1);
    });
  });

  // ===========================================================================
  // Create Tests
  // ===========================================================================

  describe('create', () => {
    it('should create a link with auto-generated ID', async () => {
      const link = await store.create(1, 2);
      expect(link.id).toBe(1);
      expect(link.source).toBe(1);
      expect(link.target).toBe(2);
    });

    it('should create sequential IDs', async () => {
      const link1 = await store.create(1, 2);
      const link2 = await store.create(3, 4);
      const link3 = await store.create(5, 6);

      expect(link1.id).toBe(1);
      expect(link2.id).toBe(2);
      expect(link3.id).toBe(3);
    });

    it('should support string sources and targets', async () => {
      const link = await store.create('hello', 'world');
      expect(link.source).toBe('hello');
      expect(link.target).toBe('world');
    });

    it('should support bigint sources and targets', async () => {
      const link = await store.create(1n, 2n);
      expect(link.source).toBe(1n);
      expect(link.target).toBe(2n);
    });

    it('should support nested Link as source', async () => {
      const inner = createLink(100, 10, 20);
      const link = await store.create(inner, 5);
      expect(link.source).toEqual(inner);
      expect(link.target).toBe(5);
    });

    it('should support nested Link as target', async () => {
      const inner = createLink(100, 10, 20);
      const link = await store.create(5, inner);
      expect(link.source).toBe(5);
      expect(link.target).toEqual(inner);
    });

    it('should freeze the created link', async () => {
      const link = await store.create(1, 2);
      expect(Object.isFrozen(link)).toBe(true);
    });
  });

  // ===========================================================================
  // Deduplication Tests
  // ===========================================================================

  describe('deduplication', () => {
    it('should return existing link for identical source/target', async () => {
      const link1 = await store.create('hello', 'world');
      const link2 = await store.create('hello', 'world');

      expect(link1.id).toBe(link2.id);
      expect(link1).toBe(link2);
      expect(await store.count()).toBe(1);
    });

    it('should not deduplicate different source/target pairs', async () => {
      const link1 = await store.create('hello', 'world');
      const link2 = await store.create('hello', 'universe');

      expect(link1.id).not.toBe(link2.id);
      expect(await store.count()).toBe(2);
    });

    it('should handle deduplication with number IDs', async () => {
      const link1 = await store.create(1, 2);
      const link2 = await store.create(1, 2);

      expect(link1.id).toBe(link2.id);
      expect(await store.count()).toBe(1);
    });

    it('should handle deduplication with bigint IDs', async () => {
      const link1 = await store.create(1n, 2n);
      const link2 = await store.create(1n, 2n);

      expect(link1.id).toBe(link2.id);
      expect(await store.count()).toBe(1);
    });

    it('should handle deduplication with mixed ID types', async () => {
      // Different types should NOT deduplicate
      const link1 = await store.create(1, 2);
      const link2 = await store.create('1', '2');

      expect(link1.id).not.toBe(link2.id);
      expect(await store.count()).toBe(2);
    });

    it('should handle deduplication with nested Link references', async () => {
      const inner = createLink(100, 10, 20);
      const link1 = await store.create(inner, 5);
      const link2 = await store.create(inner, 5);

      expect(link1.id).toBe(link2.id);
      expect(await store.count()).toBe(1);
    });
  });

  // ===========================================================================
  // CreateWithValues Tests
  // ===========================================================================

  describe('createWithValues', () => {
    it('should create a link with additional values', async () => {
      const link = await store.createWithValues(1, 2, [3, 4, 5]);
      expect(link.id).toBe(1);
      expect(link.source).toBe(1);
      expect(link.target).toBe(2);
      expect(link.values).toEqual([3, 4, 5]);
    });

    it('should NOT deduplicate links with values', async () => {
      const link1 = await store.createWithValues(1, 2, [3]);
      const link2 = await store.createWithValues(1, 2, [3]);

      expect(link1.id).not.toBe(link2.id);
      expect(await store.count()).toBe(2);
    });

    it('should support nested Link values', async () => {
      const inner = createLink(100, 10, 20);
      const link = await store.createWithValues(1, 2, [inner, 5]);
      expect(link.values).toEqual([inner, 5]);
    });

    it('should create link with empty values array', async () => {
      const link = await store.createWithValues(1, 2, []);
      expect(link.values).toBeUndefined();
    });
  });

  // ===========================================================================
  // Get Tests
  // ===========================================================================

  describe('get', () => {
    it('should retrieve an existing link by ID', async () => {
      const created = await store.create(1, 2);
      const retrieved = await store.get(created.id);

      expect(retrieved).toBe(created);
    });

    it('should return null for non-existent ID', async () => {
      const result = await store.get(999);
      expect(result).toBeNull();
    });

    it('should handle string IDs', async () => {
      await store.create('hello', 'world');
      const link = await store.get(1);
      expect(link).not.toBeNull();
    });
  });

  // ===========================================================================
  // Exists Tests
  // ===========================================================================

  describe('exists', () => {
    it('should return true for existing link', async () => {
      const link = await store.create(1, 2);
      expect(await store.exists(link.id)).toBe(true);
    });

    it('should return false for non-existent link', async () => {
      expect(await store.exists(999)).toBe(false);
    });

    it('should return false after deletion', async () => {
      const link = await store.create(1, 2);
      await store.delete(link.id);
      expect(await store.exists(link.id)).toBe(false);
    });
  });

  // ===========================================================================
  // Find Tests
  // ===========================================================================

  describe('find', () => {
    beforeEach(async () => {
      await store.create(1, 10);
      await store.create(1, 20);
      await store.create(2, 10);
      await store.create(2, 20);
    });

    it('should find all links with empty pattern', async () => {
      const results = await store.find({});
      expect(results.length).toBe(4);
    });

    it('should find links by source', async () => {
      const results = await store.find({ source: 1 });
      expect(results.length).toBe(2);
      expect(results.every((l) => l.source === 1)).toBe(true);
    });

    it('should find links by target', async () => {
      const results = await store.find({ target: 10 });
      expect(results.length).toBe(2);
      expect(results.every((l) => l.target === 10)).toBe(true);
    });

    it('should find links by source and target', async () => {
      const results = await store.find({ source: 1, target: 10 });
      expect(results.length).toBe(1);
      expect(results[0].source).toBe(1);
      expect(results[0].target).toBe(10);
    });

    it('should find links by id', async () => {
      const results = await store.find({ id: 1 });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(1);
    });

    it('should find links with Any wildcard for source', async () => {
      const results = await store.find({ source: Any, target: 10 });
      expect(results.length).toBe(2);
      expect(results.every((l) => l.target === 10)).toBe(true);
    });

    it('should find links with Any wildcard for target', async () => {
      const results = await store.find({ source: 1, target: Any });
      expect(results.length).toBe(2);
      expect(results.every((l) => l.source === 1)).toBe(true);
    });

    it('should find all links with Any wildcards', async () => {
      const results = await store.find({ source: Any, target: Any });
      expect(results.length).toBe(4);
    });

    it('should return empty array for no matches', async () => {
      const results = await store.find({ source: 999 });
      expect(results.length).toBe(0);
    });
  });

  // ===========================================================================
  // Count Tests
  // ===========================================================================

  describe('count', () => {
    it('should return 0 for empty store', async () => {
      expect(await store.count()).toBe(0);
    });

    it('should return total count without pattern', async () => {
      await store.create(1, 2);
      await store.create(3, 4);
      await store.create(5, 6);
      expect(await store.count()).toBe(3);
    });

    it('should return count matching pattern', async () => {
      await store.create(1, 10);
      await store.create(1, 20);
      await store.create(2, 10);
      expect(await store.count({ source: 1 })).toBe(2);
    });

    it('should return 0 for no matches', async () => {
      await store.create(1, 2);
      expect(await store.count({ source: 999 })).toBe(0);
    });

    it('should count with Any wildcard', async () => {
      await store.create(1, 10);
      await store.create(1, 20);
      await store.create(2, 10);
      expect(await store.count({ source: Any, target: 10 })).toBe(2);
    });
  });

  // ===========================================================================
  // Update Tests
  // ===========================================================================

  describe('update', () => {
    it('should update source and target', async () => {
      const link = await store.create(1, 2);
      const updated = await store.update(link.id, 10, 20);

      expect(updated.id).toBe(link.id);
      expect(updated.source).toBe(10);
      expect(updated.target).toBe(20);
    });

    it('should update deduplication index', async () => {
      const link = await store.create(1, 2);
      await store.update(link.id, 10, 20);

      // Old key should no longer deduplicate
      const newLink = await store.create(1, 2);
      expect(newLink.id).not.toBe(link.id);

      // New key should deduplicate
      const duplicate = await store.create(10, 20);
      expect(duplicate.id).toBe(link.id);
    });

    it('should preserve values when updating', async () => {
      const link = await store.createWithValues(1, 2, [3, 4]);
      const updated = await store.update(link.id, 10, 20);

      expect(updated.values).toEqual([3, 4]);
    });

    it('should throw for non-existent ID', async () => {
      let thrownError = null;
      try {
        await store.update(999, 1, 2);
      } catch (error) {
        thrownError = error;
      }
      expect(thrownError).not.toBeNull();
      expect(thrownError.message).toBe('Link with id 999 not found');
    });

    it('should freeze the updated link', async () => {
      const link = await store.create(1, 2);
      const updated = await store.update(link.id, 10, 20);
      expect(Object.isFrozen(updated)).toBe(true);
    });
  });

  // ===========================================================================
  // Delete Tests
  // ===========================================================================

  describe('delete', () => {
    it('should delete an existing link', async () => {
      const link = await store.create(1, 2);
      const result = await store.delete(link.id);

      expect(result).toBe(true);
      expect(await store.exists(link.id)).toBe(false);
      expect(await store.count()).toBe(0);
    });

    it('should return false for non-existent ID', async () => {
      const result = await store.delete(999);
      expect(result).toBe(false);
    });

    it('should remove from deduplication index', async () => {
      const link = await store.create(1, 2);
      await store.delete(link.id);

      // Should be able to create a new link with same source/target
      const newLink = await store.create(1, 2);
      expect(newLink.id).not.toBe(link.id);
    });

    it('should handle deletion of link with values', async () => {
      const link = await store.createWithValues(1, 2, [3, 4]);
      const result = await store.delete(link.id);

      expect(result).toBe(true);
      expect(await store.count()).toBe(0);
    });
  });

  // ===========================================================================
  // DeleteMatching Tests
  // ===========================================================================

  describe('deleteMatching', () => {
    beforeEach(async () => {
      await store.create(1, 10);
      await store.create(1, 20);
      await store.create(2, 10);
      await store.create(2, 20);
    });

    it('should delete all matching links', async () => {
      const count = await store.deleteMatching({ source: 1 });
      expect(count).toBe(2);
      expect(await store.count()).toBe(2);
    });

    it('should return 0 for no matches', async () => {
      const count = await store.deleteMatching({ source: 999 });
      expect(count).toBe(0);
      expect(await store.count()).toBe(4);
    });

    it('should delete all with empty pattern', async () => {
      const count = await store.deleteMatching({});
      expect(count).toBe(4);
      expect(await store.count()).toBe(0);
    });

    it('should delete with Any wildcard', async () => {
      const count = await store.deleteMatching({ source: Any, target: 10 });
      expect(count).toBe(2);
      expect(await store.count()).toBe(2);
    });

    it('should update deduplication index after deletion', async () => {
      await store.deleteMatching({ source: 1, target: 10 });

      // Should be able to create a new link with deleted source/target
      const newLink = await store.create(1, 10);
      expect(newLink.id).toBe(5); // Next ID after 4
    });
  });

  // ===========================================================================
  // Iterate Tests
  // ===========================================================================

  describe('iterate', () => {
    beforeEach(async () => {
      await store.create(1, 10);
      await store.create(1, 20);
      await store.create(2, 10);
    });

    it('should iterate over all links without pattern', async () => {
      const links = [];
      for await (const link of store.iterate()) {
        links.push(link);
      }
      expect(links.length).toBe(3);
    });

    it('should iterate over matching links', async () => {
      const links = [];
      for await (const link of store.iterate({ source: 1 })) {
        links.push(link);
      }
      expect(links.length).toBe(2);
      expect(links.every((l) => l.source === 1)).toBe(true);
    });

    it('should iterate over empty store', async () => {
      const emptyStore = new MemoryLinkStore();
      const links = [];
      for await (const link of emptyStore.iterate()) {
        links.push(link);
      }
      expect(links.length).toBe(0);
    });

    it('should iterate with Any wildcard', async () => {
      const links = [];
      for await (const link of store.iterate({ source: Any, target: 10 })) {
        links.push(link);
      }
      expect(links.length).toBe(2);
    });

    it('should return no results for non-matching pattern', async () => {
      const links = [];
      for await (const link of store.iterate({ source: 999 })) {
        links.push(link);
      }
      expect(links.length).toBe(0);
    });
  });

  // ===========================================================================
  // Clear Tests
  // ===========================================================================

  describe('clear', () => {
    it('should remove all links', async () => {
      await store.create(1, 2);
      await store.create(3, 4);
      await store.create(5, 6);

      await store.clear();

      expect(await store.count()).toBe(0);
    });

    it('should reset ID counter', async () => {
      await store.create(1, 2);
      await store.create(3, 4);

      await store.clear();

      const newLink = await store.create(10, 20);
      expect(newLink.id).toBe(1);
    });

    it('should clear deduplication index', async () => {
      const link = await store.create(1, 2);
      const originalId = link.id;

      await store.clear();

      // Should be able to create new link with same source/target
      const newLink = await store.create(1, 2);
      expect(newLink.id).toBe(1);
      expect(newLink.id).toBe(originalId); // Both 1, but different links
    });

    it('should work on empty store', async () => {
      await store.clear();
      expect(await store.count()).toBe(0);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty string IDs', async () => {
      const link = await store.create('', 'target');
      expect(link.source).toBe('');
    });

    it('should handle zero as source/target', async () => {
      const link = await store.create(0, 0);
      expect(link.source).toBe(0);
      expect(link.target).toBe(0);
    });

    it('should handle negative numbers', async () => {
      const link = await store.create(-1, -2);
      expect(link.source).toBe(-1);
      expect(link.target).toBe(-2);
    });

    it('should handle very large bigints', async () => {
      const bigSource = 9007199254740993n;
      const bigTarget = 9007199254740994n;
      const link = await store.create(bigSource, bigTarget);
      expect(link.source).toBe(bigSource);
      expect(link.target).toBe(bigTarget);
    });

    it('should handle self-referential links', async () => {
      const link = await store.create(1, 1);
      expect(link.source).toBe(1);
      expect(link.target).toBe(1);
    });

    it('should handle deeply nested links', async () => {
      const level3 = createLink(3, 30, 31);
      const level2 = createLink(2, level3, 21);
      const level1 = await store.create(level2, 10);

      expect(level1.source.source.source).toBe(30);
    });

    it('should handle concurrent creates', async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(store.create(i, i + 1));
      }

      const links = await Promise.all(promises);
      expect(links.length).toBe(100);
      expect(await store.count()).toBe(100);
    });
  });
});
