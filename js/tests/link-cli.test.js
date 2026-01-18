/**
 * Tests for LinkCliBackend and LinkCliProcess.
 *
 * These tests use mocks to simulate link-cli behavior, allowing tests
 * to run without the actual link-cli binary installed.
 *
 * Note: Each test creates its own instance for Deno compatibility.
 * Note: Tests that spawn processes are skipped on Deno due to permission
 * requirements (--allow-run, --allow-env) not granted in CI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BackendRegistry,
  LinkCliBackend,
  LinkCliProcess,
  ProcessState,
  createLink,
} from '../src/index.js';

// Detect if running in Deno (process spawn tests need additional permissions)

const isDeno = typeof Deno !== 'undefined';

// =============================================================================
// LinkCliProcess Tests
// =============================================================================

describe('LinkCliProcess', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const process = new LinkCliProcess();
      assert.strictEqual(process.dbPath, 'db.links');
      assert.strictEqual(process.binaryPath, 'clink');
      assert.strictEqual(process.state, ProcessState.STOPPED);
    });

    it('should create with custom options', () => {
      const process = new LinkCliProcess({
        dbPath: '/tmp/test.links',
        binaryPath: '/usr/local/bin/clink',
      });
      assert.strictEqual(process.dbPath, '/tmp/test.links');
      assert.strictEqual(process.binaryPath, '/usr/local/bin/clink');
    });
  });

  describe('checkBinaryAvailable', () => {
    it(
      'should return false when binary is not found',
      { skip: isDeno },
      async () => {
        // Skip on Deno: requires --allow-run, --allow-env permissions not granted in CI
        const process = new LinkCliProcess({
          binaryPath: 'nonexistent-binary-that-does-not-exist',
        });
        const available = await process.checkBinaryAvailable();
        assert.strictEqual(available, false);
      }
    );

    // Note: Testing when binary IS available requires actual clink installation
    // Those tests are marked as integration tests
  });

  describe('_parseChanges', () => {
    it('should parse link notation with ID format', () => {
      const process = new LinkCliProcess();

      // Simulate the output format from link-cli
      const output = '((1: 1 2) (2: 3 4))';
      const links = process._parseChanges(output);

      assert.strictEqual(links.length, 2);
      assert.deepStrictEqual(links[0], { id: 1, source: 1, target: 2 });
      assert.deepStrictEqual(links[1], { id: 2, source: 3, target: 4 });
    });

    it('should parse single link', () => {
      const process = new LinkCliProcess();
      const output = '(5: 10 20)';
      const links = process._parseChanges(output);

      assert.strictEqual(links.length, 1);
      assert.deepStrictEqual(links[0], { id: 5, source: 10, target: 20 });
    });

    it('should return empty array for empty output', () => {
      const process = new LinkCliProcess();
      const links = process._parseChanges('');
      assert.strictEqual(links.length, 0);
    });

    it('should handle whitespace in output', () => {
      const process = new LinkCliProcess();
      const output = '  (1:  1  2)  ';
      const links = process._parseChanges(output);

      assert.strictEqual(links.length, 1);
      assert.deepStrictEqual(links[0], { id: 1, source: 1, target: 2 });
    });
  });
});

// =============================================================================
// LinkCliBackend Tests
// =============================================================================

describe('LinkCliBackend', () => {
  describe('constructor', () => {
    it('should require path option', () => {
      assert.throws(() => {
        new LinkCliBackend();
      }, /requires a path/i);

      assert.throws(() => {
        new LinkCliBackend({});
      }, /requires a path/i);
    });

    it('should accept path option', () => {
      const backend = new LinkCliBackend({ path: './test.links' });
      assert.ok(backend);
    });

    it('should accept custom binaryPath', () => {
      const backend = new LinkCliBackend({
        path: './test.links',
        binaryPath: '/custom/path/clink',
      });
      assert.ok(backend);
    });
  });

  describe('lifecycle', () => {
    it('should start disconnected', () => {
      const backend = new LinkCliBackend({ path: './test.links' });
      assert.strictEqual(backend.isConnected(), false);
    });

    it(
      'should throw when binary not available during connect',
      { skip: isDeno },
      async () => {
        // Skip on Deno: requires --allow-run, --allow-env permissions not granted in CI
        const backend = new LinkCliBackend({
          path: './test.links',
          binaryPath: 'nonexistent-binary',
        });

        await assert.rejects(async () => {
          await backend.connect();
        }, /not found/i);
      }
    );

    it('should disconnect properly', async () => {
      const backend = new LinkCliBackend({ path: './test.links' });
      // Even without connecting, disconnect should work
      await backend.disconnect();
      assert.strictEqual(backend.isConnected(), false);
    });
  });

  describe('capabilities', () => {
    it('should return correct capabilities', () => {
      const backend = new LinkCliBackend({ path: './test.links' });
      const caps = backend.getCapabilities();

      assert.strictEqual(caps.supportsTransactions, false);
      assert.strictEqual(caps.supportsBatchOperations, false);
      assert.strictEqual(caps.durabilityLevel, 'fsync');
      assert.strictEqual(caps.maxLinkSize, 0);
      assert.strictEqual(caps.supportsPatternQueries, true);
    });
  });

  describe('stats', () => {
    it('should return initial stats', () => {
      const backend = new LinkCliBackend({ path: './test.links' });
      const stats = backend.getStats();

      assert.strictEqual(stats.totalLinks, 0);
      assert.strictEqual(stats.operations.reads, 0);
      assert.strictEqual(stats.operations.writes, 0);
      assert.strictEqual(stats.operations.deletes, 0);
      assert.strictEqual(stats.operations.queries, 0);
      assert.strictEqual(stats.connectedAt, null);
    });
  });

  describe('error handling', () => {
    it('should throw when saving without connection', async () => {
      const backend = new LinkCliBackend({ path: './test.links' });

      await assert.rejects(async () => {
        await backend.save(createLink(0, 1, 2));
      }, /not connected/i);
    });

    it('should throw when loading without connection', async () => {
      const backend = new LinkCliBackend({ path: './test.links' });

      await assert.rejects(async () => {
        await backend.load(1);
      }, /not connected/i);
    });

    it('should throw when deleting without connection', async () => {
      const backend = new LinkCliBackend({ path: './test.links' });

      await assert.rejects(async () => {
        await backend.delete(1);
      }, /not connected/i);
    });

    it('should throw when querying without connection', async () => {
      const backend = new LinkCliBackend({ path: './test.links' });

      await assert.rejects(async () => {
        await backend.query({});
      }, /not connected/i);
    });
  });
});

// =============================================================================
// BackendRegistry Integration Tests
// =============================================================================

describe('BackendRegistry link-cli integration', () => {
  it('should have link-cli backend registered by default', () => {
    BackendRegistry.reset();
    assert.strictEqual(BackendRegistry.has('link-cli'), true);
  });

  it('should include link-cli in list of types', () => {
    BackendRegistry.reset();
    const types = BackendRegistry.listTypes();
    assert.ok(types.includes('link-cli'));
    assert.ok(types.includes('memory'));
  });

  it('should create link-cli backend via registry', () => {
    BackendRegistry.reset();
    const backend = BackendRegistry.create({
      type: 'link-cli',
      options: { path: './test.links' },
    });
    assert.ok(backend instanceof LinkCliBackend);
  });

  it('should throw when creating link-cli backend without path', () => {
    BackendRegistry.reset();
    assert.throws(() => {
      BackendRegistry.create({
        type: 'link-cli',
        options: {},
      });
    }, /requires a path/i);
  });

  it('should preserve link-cli registration after reset', () => {
    BackendRegistry.reset();
    BackendRegistry.register('custom', () => null);
    BackendRegistry.reset();

    assert.strictEqual(BackendRegistry.has('link-cli'), true);
    assert.strictEqual(BackendRegistry.has('custom'), false);
  });
});

// =============================================================================
// Process State Tests
// =============================================================================

describe('ProcessState', () => {
  it('should export all state values', () => {
    assert.strictEqual(ProcessState.STOPPED, 'stopped');
    assert.strictEqual(ProcessState.STARTING, 'starting');
    assert.strictEqual(ProcessState.RUNNING, 'running');
    assert.strictEqual(ProcessState.STOPPING, 'stopping');
    assert.strictEqual(ProcessState.CRASHED, 'crashed');
  });
});
