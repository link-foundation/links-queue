/**
 * Unit tests for TCP server components.
 *
 * Tests the server, connection handling, and request routing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LinksQueueServer,
  ServerState,
  ConnectionState,
  RequestRouter,
} from '../src/server/index.js';
import {
  MemoryQueueManager,
  RequestType,
  ResponseStatus,
  ErrorCode,
  Message,
  createEnqueueRequest,
  createDequeueRequest,
  createAckRequest,
  createRejectRequest,
  createPeekRequest,
  createGetStatsRequest,
  createListQueuesRequest,
  createCreateQueueRequest,
  createDeleteQueueRequest,
} from '../src/index.js';

/**
 * Creates a fresh router setup for testing.
 * Using a helper instead of beforeEach for Deno compatibility.
 * @returns {Promise<{queueManager: MemoryQueueManager, router: RequestRouter}>}
 */
async function createRouterSetup() {
  const queueManager = new MemoryQueueManager();
  const router = new RequestRouter(queueManager);
  await queueManager.createQueue('tasks');
  return { queueManager, router };
}

// =============================================================================
// ServerState Tests
// =============================================================================

describe('ServerState', () => {
  it('should have correct values', () => {
    assert.equal(ServerState.STOPPED, 'stopped');
    assert.equal(ServerState.STARTING, 'starting');
    assert.equal(ServerState.RUNNING, 'running');
    assert.equal(ServerState.DRAINING, 'draining');
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(ServerState));
  });
});

// =============================================================================
// ConnectionState Tests
// =============================================================================

describe('ConnectionState', () => {
  it('should have correct values', () => {
    assert.equal(ConnectionState.CONNECTING, 'connecting');
    assert.equal(ConnectionState.CONNECTED, 'connected');
    assert.equal(ConnectionState.DRAINING, 'draining');
    assert.equal(ConnectionState.CLOSED, 'closed');
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(ConnectionState));
  });
});

// =============================================================================
// RequestRouter Tests
// =============================================================================

describe('RequestRouter', () => {
  describe('route()', () => {
    it('should reject messages without type', async () => {
      const { router } = await createRouterSetup();
      const message = new Message({});
      const response = await router.route(message);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.INVALID_REQUEST);
    });

    it('should reject unknown request types', async () => {
      const { router } = await createRouterSetup();
      const message = new Message({ type: 'unknown_type' });
      const response = await router.route(message);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.INVALID_REQUEST);
    });

    it('should track request count', async () => {
      const { router } = await createRouterSetup();
      const stats = router.getStats();
      const initialCount = stats.requestCount;

      await router.route(createListQueuesRequest());
      await router.route(createListQueuesRequest());

      const newStats = router.getStats();
      assert.equal(newStats.requestCount, initialCount + 2);
    });
  });

  describe('ENQUEUE handling', () => {
    it('should enqueue to existing queue', async () => {
      const { router } = await createRouterSetup();
      const request = createEnqueueRequest('tasks', { action: 'process' });
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.ok(response.result.id);
      assert.equal(response.result.position, 0);
    });

    it('should reject enqueue to non-existent queue', async () => {
      const { router } = await createRouterSetup();
      const request = createEnqueueRequest('nonexistent', {
        action: 'process',
      });
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.QUEUE_NOT_FOUND);
    });

    it('should reject enqueue without queue name', async () => {
      const { router } = await createRouterSetup();
      const request = new Message({
        type: RequestType.ENQUEUE,
        payload: { action: 'process' },
      });
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.INVALID_REQUEST);
    });

    it('should reject enqueue without payload', async () => {
      const { router } = await createRouterSetup();
      const request = new Message({
        type: RequestType.ENQUEUE,
        queue: 'tasks',
      });
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.INVALID_REQUEST);
    });
  });

  describe('DEQUEUE handling', () => {
    it('should dequeue from queue with items', async () => {
      const { router } = await createRouterSetup();
      // First enqueue
      await router.route(createEnqueueRequest('tasks', { action: 'process' }));

      // Then dequeue
      const request = createDequeueRequest('tasks');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.ok(response.result.id);
    });

    it('should return error for empty queue', async () => {
      const { router } = await createRouterSetup();
      const request = createDequeueRequest('tasks');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.QUEUE_EMPTY);
    });

    it('should reject dequeue from non-existent queue', async () => {
      const { router } = await createRouterSetup();
      const request = createDequeueRequest('nonexistent');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.QUEUE_NOT_FOUND);
    });
  });

  describe('PEEK handling', () => {
    it('should peek at queue with items', async () => {
      const { router } = await createRouterSetup();
      await router.route(createEnqueueRequest('tasks', { action: 'process' }));

      const request = createPeekRequest('tasks');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.ok(response.result.id);

      // Peek should not remove the item
      const peekAgain = await router.route(createPeekRequest('tasks'));
      assert.equal(peekAgain.status, ResponseStatus.OK);
    });

    it('should return error for empty queue', async () => {
      const { router } = await createRouterSetup();
      const request = createPeekRequest('tasks');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.QUEUE_EMPTY);
    });
  });

  describe('ACK handling', () => {
    it('should acknowledge in-flight item', async () => {
      const { router } = await createRouterSetup();
      await router.route(createEnqueueRequest('tasks', { action: 'process' }));
      const dequeueResponse = await router.route(createDequeueRequest('tasks'));
      const messageId = dequeueResponse.result.id;

      const request = createAckRequest('tasks', messageId);
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result.acknowledged, true);
    });

    it('should reject ack for non-existent message', async () => {
      const { router } = await createRouterSetup();
      const request = createAckRequest('tasks', 'nonexistent');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.MESSAGE_NOT_FOUND);
    });
  });

  describe('REJECT handling', () => {
    it('should reject in-flight item', async () => {
      const { router } = await createRouterSetup();
      await router.route(createEnqueueRequest('tasks', { action: 'process' }));
      const dequeueResponse = await router.route(createDequeueRequest('tasks'));
      const messageId = dequeueResponse.result.id;

      const request = createRejectRequest('tasks', messageId, false);
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result.rejected, true);
      assert.equal(response.result.requeued, false);
    });

    it('should reject and requeue item', async () => {
      const { router } = await createRouterSetup();
      await router.route(createEnqueueRequest('tasks', { action: 'process' }));
      const dequeueResponse = await router.route(createDequeueRequest('tasks'));
      const messageId = dequeueResponse.result.id;

      const request = createRejectRequest('tasks', messageId, true);
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result.requeued, true);

      // Item should be back in queue
      const peekResponse = await router.route(createPeekRequest('tasks'));
      assert.equal(peekResponse.status, ResponseStatus.OK);
    });
  });

  describe('GET_STATS handling', () => {
    it('should return queue stats', async () => {
      const { router } = await createRouterSetup();
      await router.route(createEnqueueRequest('tasks', { action: 'process' }));
      await router.route(createEnqueueRequest('tasks', { action: 'process2' }));

      const request = createGetStatsRequest('tasks');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result.depth, 2);
      assert.ok(typeof response.result.enqueued === 'number');
    });
  });

  describe('LIST_QUEUES handling', () => {
    it('should list all queues', async () => {
      const { queueManager, router } = await createRouterSetup();
      await queueManager.createQueue('queue2');

      const request = createListQueuesRequest();
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.ok(Array.isArray(response.result.queues));
      assert.equal(response.result.queues.length, 2);

      const names = response.result.queues.map((q) => q.name);
      assert.ok(names.includes('tasks'));
      assert.ok(names.includes('queue2'));
    });
  });

  describe('CREATE_QUEUE handling', () => {
    it('should create new queue', async () => {
      const { queueManager, router } = await createRouterSetup();
      const request = createCreateQueueRequest('newqueue');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result.created, true);
      assert.equal(response.result.name, 'newqueue');

      // Verify queue exists
      const queue = await queueManager.getQueue('newqueue');
      assert.ok(queue);
    });

    it('should reject creating existing queue', async () => {
      const { router } = await createRouterSetup();
      const request = createCreateQueueRequest('tasks');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.QUEUE_EXISTS);
    });
  });

  describe('DELETE_QUEUE handling', () => {
    it('should delete existing queue', async () => {
      const { queueManager, router } = await createRouterSetup();
      const request = createDeleteQueueRequest('tasks');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result.deleted, true);

      // Verify queue is gone
      const queue = await queueManager.getQueue('tasks');
      assert.equal(queue, null);
    });

    it('should reject deleting non-existent queue', async () => {
      const { router } = await createRouterSetup();
      const request = createDeleteQueueRequest('nonexistent');
      const response = await router.route(request);

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.equal(response.error.code, ErrorCode.QUEUE_NOT_FOUND);
    });
  });

  describe('registerHandler()', () => {
    it('should allow registering custom handlers', async () => {
      const { router } = await createRouterSetup();
      let customHandlerCalled = false;

      router.registerHandler('custom', async () => {
        customHandlerCalled = true;
        return new Message({
          status: ResponseStatus.OK,
          result: { custom: true },
        });
      });

      const response = await router.route(new Message({ type: 'custom' }));

      assert.ok(customHandlerCalled);
      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result.custom, true);
    });
  });

  describe('getStats()', () => {
    it('should return router statistics', async () => {
      const { router } = await createRouterSetup();
      const stats = router.getStats();

      assert.ok(typeof stats.requestCount === 'number');
      assert.ok(typeof stats.errorCount === 'number');
      assert.ok(typeof stats.errorRate === 'number');
    });
  });
});

// =============================================================================
// LinksQueueServer Tests
// =============================================================================

describe('LinksQueueServer', () => {
  describe('constructor()', () => {
    it('should create server with default options', () => {
      const server = new LinksQueueServer();

      assert.equal(server.state, ServerState.STOPPED);
      assert.equal(server.connectionCount, 0);
    });

    it('should create server with custom options', () => {
      const server = new LinksQueueServer({
        host: '127.0.0.1',
        port: 9999,
        maxConnections: 500,
        idleTimeout: 30000,
      });

      assert.equal(server.state, ServerState.STOPPED);
    });

    it('should accept custom queue manager', () => {
      const queueManager = new MemoryQueueManager();
      const server = new LinksQueueServer({ queueManager });

      assert.equal(server.queueManager, queueManager);
    });
  });

  describe('start()', () => {
    it('should start server and emit listening event', async () => {
      const server = new LinksQueueServer({ port: 0 }); // Port 0 = random available port

      let listeningEmitted = false;
      server.on('listening', () => {
        listeningEmitted = true;
      });

      try {
        await server.start();

        assert.equal(server.state, ServerState.RUNNING);
        assert.ok(listeningEmitted);
        assert.ok(server.address);
        assert.ok(server.address.port > 0);
      } finally {
        await server.stop();
      }
    });

    it('should reject starting already running server', async () => {
      const server = new LinksQueueServer({ port: 0 });
      try {
        await server.start();

        await assert.rejects(async () => {
          await server.start();
        }, /Cannot start server/);
      } finally {
        await server.stop();
      }
    });

    it('should create queue manager if not provided', async () => {
      const server = new LinksQueueServer({ port: 0 });
      try {
        await server.start();

        assert.ok(server.queueManager);
      } finally {
        await server.stop();
      }
    });
  });

  describe('stop()', () => {
    it('should stop running server', async () => {
      const server = new LinksQueueServer({ port: 0 });
      await server.start();

      let closeEmitted = false;
      server.on('close', () => {
        closeEmitted = true;
      });

      await server.stop();

      assert.equal(server.state, ServerState.STOPPED);
      assert.ok(closeEmitted);
    });

    it('should handle stopping already stopped server', async () => {
      const server = new LinksQueueServer({ port: 0 });

      // Should not throw
      await server.stop();
      assert.equal(server.state, ServerState.STOPPED);
    });
  });

  describe('shutdown()', () => {
    it('should gracefully shutdown server', async () => {
      const server = new LinksQueueServer({ port: 0 });
      await server.start();

      await server.shutdown({ drainTimeout: 1000 });

      assert.equal(server.state, ServerState.STOPPED);
    });
  });

  describe('getStats()', () => {
    it('should return server statistics', async () => {
      const server = new LinksQueueServer({ port: 0 });
      try {
        await server.start();

        const stats = server.getStats();

        assert.equal(stats.state, ServerState.RUNNING);
        assert.ok(stats.address);
        assert.ok(stats.startedAt);
        assert.ok(stats.uptime >= 0);
        assert.ok(stats.connections);
        assert.equal(stats.connections.current, 0);
      } finally {
        await server.stop();
      }
    });
  });

  describe('healthCheck()', () => {
    it('should return health status', async () => {
      const server = new LinksQueueServer({ port: 0 });
      try {
        await server.start();

        const health = server.healthCheck();

        assert.equal(health.status, ResponseStatus.OK);
        assert.equal(health.result.healthy, true);
        assert.equal(health.result.state, ServerState.RUNNING);
      } finally {
        await server.stop();
      }
    });
  });

  describe('getConnections()', () => {
    it('should return empty array when no connections', async () => {
      const server = new LinksQueueServer({ port: 0 });
      try {
        await server.start();

        const connections = server.getConnections();
        assert.deepEqual(connections, []);
      } finally {
        await server.stop();
      }
    });
  });
});
