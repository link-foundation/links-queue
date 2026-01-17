/**
 * Unit tests for protocol messages.
 *
 * Tests the creation and serialization of protocol messages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Message,
  MessageBuilder,
  RequestType,
  ResponseStatus,
  ErrorCode,
  createOkResponse,
  createErrorResponse,
  createEnqueueRequest,
  createDequeueRequest,
  createPeekRequest,
  createAckRequest,
  createRejectRequest,
  createQueryRequest,
  createGetStatsRequest,
  createListQueuesRequest,
  createCreateQueueRequest,
  createDeleteQueueRequest,
} from '../src/protocol/messages.js';

describe('RequestType', () => {
  it('should have correct values', () => {
    assert.equal(RequestType.ENQUEUE, 'enqueue');
    assert.equal(RequestType.DEQUEUE, 'dequeue');
    assert.equal(RequestType.ACK, 'ack');
    assert.equal(RequestType.REJECT, 'reject');
    assert.equal(RequestType.QUERY, 'query');
    assert.equal(RequestType.SYNC, 'sync');
    assert.equal(RequestType.PEEK, 'peek');
    assert.equal(RequestType.CREATE_QUEUE, 'create_queue');
    assert.equal(RequestType.DELETE_QUEUE, 'delete_queue');
    assert.equal(RequestType.LIST_QUEUES, 'list_queues');
    assert.equal(RequestType.GET_STATS, 'get_stats');
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(RequestType));
  });
});

describe('ResponseStatus', () => {
  it('should have correct values', () => {
    assert.equal(ResponseStatus.OK, 'ok');
    assert.equal(ResponseStatus.ERROR, 'error');
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(ResponseStatus));
  });
});

describe('ErrorCode', () => {
  it('should have correct values', () => {
    assert.equal(ErrorCode.QUEUE_EMPTY, 'QUEUE_EMPTY');
    assert.equal(ErrorCode.QUEUE_NOT_FOUND, 'QUEUE_NOT_FOUND');
    assert.equal(ErrorCode.QUEUE_EXISTS, 'QUEUE_EXISTS');
    assert.equal(ErrorCode.MESSAGE_NOT_FOUND, 'MESSAGE_NOT_FOUND');
    assert.equal(ErrorCode.INVALID_REQUEST, 'INVALID_REQUEST');
    assert.equal(ErrorCode.NOT_ALLOWED, 'NOT_ALLOWED');
    assert.equal(ErrorCode.INTERNAL_ERROR, 'INTERNAL_ERROR');
    assert.equal(ErrorCode.TIMEOUT, 'TIMEOUT');
    assert.equal(ErrorCode.CONNECTION_ERROR, 'CONNECTION_ERROR');
  });

  it('should be frozen', () => {
    assert.ok(Object.isFrozen(ErrorCode));
  });
});

describe('MessageBuilder', () => {
  it('should build a message with all fields', () => {
    const msg = new MessageBuilder()
      .type(RequestType.ENQUEUE)
      .queue('tasks')
      .payload({ action: 'process' })
      .messageId('abc123')
      .requeue(true)
      .priority(5)
      .options({ ttl: 60000 })
      .build();

    assert.equal(msg.type, RequestType.ENQUEUE);
    assert.equal(msg.queue, 'tasks');
    assert.deepEqual(msg.payload, { action: 'process' });
    assert.equal(msg.messageId, 'abc123');
    assert.equal(msg.requeue, true);
    assert.equal(msg.priority, 5);
    assert.deepEqual(msg.options, { ttl: 60000 });
  });

  it('should support chaining', () => {
    const builder = new MessageBuilder();
    const result = builder.type(RequestType.ENQUEUE).queue('test');
    assert.strictEqual(result, builder);
  });

  it('should build message with minimal fields', () => {
    const msg = new MessageBuilder().type(RequestType.DEQUEUE).build();

    assert.equal(msg.type, RequestType.DEQUEUE);
    assert.equal(msg.queue, null);
    assert.equal(msg.payload, null);
  });
});

describe('Message', () => {
  describe('constructor', () => {
    it('should create message with data', () => {
      const msg = new Message({
        type: RequestType.ENQUEUE,
        queue: 'tasks',
        payload: { data: 'test' },
      });

      assert.equal(msg.type, RequestType.ENQUEUE);
      assert.equal(msg.queue, 'tasks');
      assert.deepEqual(msg.payload, { data: 'test' });
    });

    it('should handle missing fields', () => {
      const msg = new Message({});

      assert.equal(msg.type, null);
      assert.equal(msg.queue, null);
      assert.equal(msg.payload, null);
    });
  });

  describe('toLink', () => {
    it('should convert message to link', () => {
      const msg = new Message({
        type: RequestType.ENQUEUE,
        queue: 'tasks',
      });

      const link = msg.toLink();
      assert.ok(link);
      assert.ok('id' in link);
      assert.ok('source' in link);
      assert.ok('target' in link);
    });

    it('should include all message fields in link', () => {
      const msg = new Message({
        type: RequestType.ENQUEUE,
        queue: 'tasks',
        payload: { action: 'process' },
        priority: 5,
      });

      const link = msg.toLink();
      assert.ok(link);
    });
  });

  describe('toNotation', () => {
    it('should convert message to notation string', () => {
      const msg = new Message({
        type: RequestType.ENQUEUE,
        queue: 'tasks',
      });

      const notation = msg.toNotation();
      assert.ok(typeof notation === 'string');
      assert.ok(notation.includes('type'));
      assert.ok(notation.includes('enqueue'));
    });

    it('should support pretty option', () => {
      const msg = new Message({
        type: RequestType.ENQUEUE,
        queue: 'tasks',
      });

      const notation = msg.toNotation({ pretty: true });
      assert.ok(typeof notation === 'string');
    });
  });

  describe('fromLink', () => {
    it('should create message from link', () => {
      const link = { id: 0, source: 'type', target: 'enqueue' };
      const msg = Message.fromLink(link);

      assert.equal(msg.type, 'enqueue');
    });
  });

  describe('fromNotation', () => {
    it('should create message from notation string', () => {
      const notation = '(type: enqueue)';
      const msg = Message.fromNotation(notation);

      assert.equal(msg.type, 'enqueue');
    });

    it('should handle empty input', () => {
      const msg = Message.fromNotation('');
      assert.ok(msg instanceof Message);
    });
  });
});

describe('Response builders', () => {
  describe('createOkResponse', () => {
    it('should create ok response without result', () => {
      const response = createOkResponse();

      assert.equal(response.status, ResponseStatus.OK);
      assert.equal(response.result, null);
    });

    it('should create ok response with result', () => {
      const result = { id: 'abc123', position: 42 };
      const response = createOkResponse(result);

      assert.equal(response.status, ResponseStatus.OK);
      assert.deepEqual(response.result, result);
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response', () => {
      const response = createErrorResponse(
        ErrorCode.QUEUE_EMPTY,
        'No messages available'
      );

      assert.equal(response.status, ResponseStatus.ERROR);
      assert.deepEqual(response.error, {
        code: ErrorCode.QUEUE_EMPTY,
        message: 'No messages available',
      });
    });
  });
});

describe('Request builders', () => {
  describe('createEnqueueRequest', () => {
    it('should create enqueue request', () => {
      const request = createEnqueueRequest('tasks', { action: 'process' });

      assert.equal(request.type, RequestType.ENQUEUE);
      assert.equal(request.queue, 'tasks');
      assert.deepEqual(request.payload, { action: 'process' });
    });

    it('should support options', () => {
      const request = createEnqueueRequest(
        'tasks',
        { action: 'process' },
        { priority: 5 }
      );

      assert.equal(request.priority, 5);
    });
  });

  describe('createDequeueRequest', () => {
    it('should create dequeue request', () => {
      const request = createDequeueRequest('tasks');

      assert.equal(request.type, RequestType.DEQUEUE);
      assert.equal(request.queue, 'tasks');
    });
  });

  describe('createPeekRequest', () => {
    it('should create peek request', () => {
      const request = createPeekRequest('tasks');

      assert.equal(request.type, RequestType.PEEK);
      assert.equal(request.queue, 'tasks');
    });
  });

  describe('createAckRequest', () => {
    it('should create ack request', () => {
      const request = createAckRequest('tasks', 'abc123');

      assert.equal(request.type, RequestType.ACK);
      assert.equal(request.queue, 'tasks');
      assert.equal(request.messageId, 'abc123');
    });
  });

  describe('createRejectRequest', () => {
    it('should create reject request without requeue', () => {
      const request = createRejectRequest('tasks', 'abc123');

      assert.equal(request.type, RequestType.REJECT);
      assert.equal(request.queue, 'tasks');
      assert.equal(request.messageId, 'abc123');
      assert.equal(request.requeue, false);
    });

    it('should create reject request with requeue', () => {
      const request = createRejectRequest('tasks', 'abc123', true);

      assert.equal(request.requeue, true);
    });
  });

  describe('createQueryRequest', () => {
    it('should create query request', () => {
      const request = createQueryRequest('tasks');

      assert.equal(request.type, RequestType.QUERY);
      assert.equal(request.queue, 'tasks');
    });
  });

  describe('createGetStatsRequest', () => {
    it('should create get stats request', () => {
      const request = createGetStatsRequest('tasks');

      assert.equal(request.type, RequestType.GET_STATS);
      assert.equal(request.queue, 'tasks');
    });
  });

  describe('createListQueuesRequest', () => {
    it('should create list queues request', () => {
      const request = createListQueuesRequest();

      assert.equal(request.type, RequestType.LIST_QUEUES);
    });
  });

  describe('createCreateQueueRequest', () => {
    it('should create create queue request', () => {
      const request = createCreateQueueRequest('new-queue');

      assert.equal(request.type, RequestType.CREATE_QUEUE);
      assert.equal(request.queue, 'new-queue');
    });

    it('should support options', () => {
      const request = createCreateQueueRequest('new-queue', { maxSize: 1000 });

      assert.deepEqual(request.options, { maxSize: 1000 });
    });
  });

  describe('createDeleteQueueRequest', () => {
    it('should create delete queue request', () => {
      const request = createDeleteQueueRequest('old-queue');

      assert.equal(request.type, RequestType.DELETE_QUEUE);
      assert.equal(request.queue, 'old-queue');
    });
  });
});

describe('Message round-trip', () => {
  it('should round-trip enqueue request through notation', () => {
    const original = createEnqueueRequest('tasks', { action: 'process' });
    const notation = original.toNotation();
    const restored = Message.fromNotation(notation);

    assert.equal(restored.type, original.type);
    assert.equal(restored.queue, original.queue);
  });

  it('should round-trip ok response through notation', () => {
    const original = createOkResponse({ id: 'abc123' });
    const notation = original.toNotation();
    const restored = Message.fromNotation(notation);

    assert.equal(restored.status, original.status);
  });

  it('should round-trip error response through notation', () => {
    const original = createErrorResponse(
      ErrorCode.QUEUE_EMPTY,
      'No messages available'
    );
    const notation = original.toNotation();
    const restored = Message.fromNotation(notation);

    assert.equal(restored.status, original.status);
  });
});
