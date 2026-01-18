/**
 * Integration tests for TCP server and client.
 *
 * Tests end-to-end communication between server and client.
 * Note: Uses inline setup/teardown instead of beforeEach/afterEach for Deno compatibility.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LinksQueueServer, ServerState } from '../src/server/index.js';
import {
  LinksQueueClient,
  ClientConnectionState,
} from '../src/client/index.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a server and client for testing.
 * @returns {Promise<{server: LinksQueueServer, client: LinksQueueClient, cleanup: Function}>}
 */
async function createTestSetup() {
  const server = new LinksQueueServer({ port: 0 });
  await server.start();
  const serverPort = server.address.port;

  const client = new LinksQueueClient({
    host: 'localhost',
    port: serverPort,
    reconnect: false,
  });

  const cleanup = async () => {
    if (client && client.isConnected) {
      await client.disconnect();
    }
    if (server && server.state !== ServerState.STOPPED) {
      await server.stop();
    }
  };

  return { server, client, serverPort, cleanup };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Client-Server Integration', () => {
  describe('Connection', () => {
    it('should connect to server', async () => {
      const { server, client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        // Give server time to process connection (needed on macOS)
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(client.isConnected, true);
        assert.equal(server.connectionCount, 1);
      } finally {
        await cleanup();
      }
    });

    it('should disconnect from server', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.disconnect();

        // Give server time to process disconnect
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.equal(client.isConnected, false);
      } finally {
        await cleanup();
      }
    });

    it('should emit connection events', async () => {
      const { server, client, cleanup } = await createTestSetup();
      try {
        let connectEmitted = false;
        let serverConnectionEmitted = false;

        client.on('connect', () => {
          connectEmitted = true;
        });

        server.on('connection', () => {
          serverConnectionEmitted = true;
        });

        await client.connect();

        // Give server time to process connection event (needed on macOS)
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.ok(connectEmitted);
        assert.ok(serverConnectionEmitted);
      } finally {
        await cleanup();
      }
    });
  });

  describe('Queue Operations', () => {
    it('should create and list queues', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');
        await client.createQueue('queue2');

        const queues = await client.listQueues();

        assert.ok(Array.isArray(queues));
        const names = queues.map((q) => q.name);
        assert.ok(names.includes('tasks'));
        assert.ok(names.includes('queue2'));
      } finally {
        await cleanup();
      }
    });

    it('should enqueue and dequeue items', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        const payload = { source: 'test', target: 'data' };
        const enqueueResult = await client.enqueue('tasks', payload);

        assert.ok(enqueueResult.id);
        assert.equal(enqueueResult.position, 0);

        const item = await client.dequeue('tasks');

        assert.ok(item);
        assert.ok(item.id);
      } finally {
        await cleanup();
      }
    });

    it('should return null for empty queue dequeue', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        const item = await client.dequeue('tasks');
        assert.equal(item, null);
      } finally {
        await cleanup();
      }
    });

    it('should peek without removing item', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        await client.enqueue('tasks', { action: 'test' });

        const peeked = await client.peek('tasks');
        assert.ok(peeked);

        // Item should still be there
        const peekedAgain = await client.peek('tasks');
        assert.ok(peekedAgain);
      } finally {
        await cleanup();
      }
    });

    it('should acknowledge processed item', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        await client.enqueue('tasks', { action: 'test' });
        const item = await client.dequeue('tasks');

        // Should not throw
        await client.acknowledge('tasks', item.id);
      } finally {
        await cleanup();
      }
    });

    it('should reject item with requeue', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        await client.enqueue('tasks', { action: 'test' });
        const item = await client.dequeue('tasks');

        await client.reject('tasks', item.id, true);

        // Item should be back in queue
        const nextItem = await client.peek('tasks');
        assert.ok(nextItem);
      } finally {
        await cleanup();
      }
    });

    it('should get queue stats', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        await client.enqueue('tasks', { action: '1' });
        await client.enqueue('tasks', { action: '2' });

        const stats = await client.getStats('tasks');

        assert.equal(stats.depth, 2);
        assert.equal(stats.enqueued, 2);
      } finally {
        await cleanup();
      }
    });

    it('should delete queue', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        const result = await client.deleteQueue('tasks');

        assert.equal(result.deleted, true);
        assert.equal(result.name, 'tasks');

        // Should fail to dequeue from deleted queue
        await assert.rejects(async () => {
          await client.dequeue('tasks');
        });
      } finally {
        await cleanup();
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw on operations with non-existent queue', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();

        await assert.rejects(async () => {
          await client.enqueue('nonexistent', { data: 'test' });
        }, /not found/i);
      } finally {
        await cleanup();
      }
    });

    it('should throw on creating duplicate queue', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('testqueue');

        await assert.rejects(async () => {
          await client.createQueue('testqueue');
        }, /exists/i);
      } finally {
        await cleanup();
      }
    });

    it('should throw on deleting non-existent queue', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();

        await assert.rejects(async () => {
          await client.deleteQueue('nonexistent');
        }, /not found/i);
      } finally {
        await cleanup();
      }
    });

    it('should throw on acknowledging non-existent message', async () => {
      const { client, cleanup } = await createTestSetup();
      try {
        await client.connect();
        await client.createQueue('tasks');

        await assert.rejects(async () => {
          await client.acknowledge('tasks', 'nonexistent-id');
        }, /not found/i);
      } finally {
        await cleanup();
      }
    });
  });

  describe('Multiple Clients', () => {
    it('should handle multiple concurrent clients', async () => {
      const { server, client, serverPort, cleanup } = await createTestSetup();
      const client2 = new LinksQueueClient({
        host: 'localhost',
        port: serverPort,
        reconnect: false,
      });

      try {
        await client.connect();
        await client2.connect();
        // Give server time to process connections (needed on macOS)
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.equal(server.connectionCount, 2);

        // Create queue from client 1
        await client.createQueue('shared');

        // Both clients should be able to use it
        await client.enqueue('shared', { from: 'client1' });
        await client2.enqueue('shared', { from: 'client2' });

        const stats = await client.getStats('shared');
        assert.equal(stats.depth, 2);
      } finally {
        await client2.disconnect();
        await cleanup();
      }
    });
  });

  describe('Connection Handling', () => {
    it('should handle server shutdown gracefully', async () => {
      const { server, client } = await createTestSetup();
      try {
        await client.connect();

        let disconnected = false;
        client.on('disconnect', () => {
          disconnected = true;
        });

        // Handle expected connection reset error during server shutdown
        client.on('error', () => {
          // ECONNRESET is expected when server shuts down
        });

        await server.shutdown({ drainTimeout: 1000 });

        // Wait for disconnect event
        await new Promise((resolve) => setTimeout(resolve, 200));

        assert.ok(disconnected);
      } finally {
        // Server already stopped from shutdown, just clean client
        if (client && client.isConnected) {
          await client.disconnect();
        }
      }
    });
  });
});

// =============================================================================
// ClientConnectionState Tests
// =============================================================================

describe('ClientConnectionState', () => {
  it('should have correct values', () => {
    assert.equal(ClientConnectionState.DISCONNECTED, 'disconnected');
    assert.equal(ClientConnectionState.CONNECTING, 'connecting');
    assert.equal(ClientConnectionState.CONNECTED, 'connected');
    assert.equal(ClientConnectionState.RECONNECTING, 'reconnecting');
    assert.equal(ClientConnectionState.CLOSED, 'closed');
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(ClientConnectionState));
  });
});

// =============================================================================
// LinksQueueClient Tests
// =============================================================================

describe('LinksQueueClient', () => {
  describe('constructor()', () => {
    it('should parse tcp:// URL', () => {
      const client = new LinksQueueClient('tcp://localhost:5000');
      assert.equal(client.state, ClientConnectionState.DISCONNECTED);
    });

    it('should parse host:port string', () => {
      const client = new LinksQueueClient('localhost:5000');
      assert.equal(client.state, ClientConnectionState.DISCONNECTED);
    });

    it('should accept options object', () => {
      const client = new LinksQueueClient({
        host: 'localhost',
        port: 5000,
        reconnect: false,
      });
      assert.equal(client.state, ClientConnectionState.DISCONNECTED);
    });
  });

  describe('getClientStats()', () => {
    it('should return client statistics', () => {
      const client = new LinksQueueClient('localhost:5000');
      const stats = client.getClientStats();

      assert.ok(typeof stats.state === 'string');
      assert.ok(typeof stats.address === 'string');
      assert.ok(typeof stats.subscriptions === 'number');
    });
  });
});
