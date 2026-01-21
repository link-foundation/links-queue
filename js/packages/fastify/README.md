# links-queue-fastify

Fastify plugin for [Links Queue](https://github.com/link-foundation/links-queue).

## Installation

```bash
npm install links-queue-fastify
```

## Quick Start

```javascript
import Fastify from 'fastify';
import linksQueuePlugin from 'links-queue-fastify';

const fastify = Fastify();
await fastify.register(linksQueuePlugin, { mode: 'single-memory' });

// Enqueue a task
fastify.post('/tasks', async (request, reply) => {
  const result = await fastify.linksQueue.enqueue('tasks', request.body);
  return result;
});

// Dequeue a task
fastify.get('/tasks', async (request, reply) => {
  const task = await fastify.linksQueue.dequeue('tasks');
  if (!task) {
    reply.code(204);
    return;
  }
  return task;
});

await fastify.listen({ port: 3000 });
```

## Plugin Options

```javascript
await fastify.register(linksQueuePlugin, {
  // Queue mode: 'single-memory' (default) or 'single-stored'
  mode: 'single-memory',

  // Decorator name on fastify instance
  decoratorName: 'linksQueue',

  // Or provide a custom queue manager
  queueManager: myCustomManager,
});
```

## RESTful Routes

For a full RESTful API, use the queue routes plugin:

```javascript
import Fastify from 'fastify';
import linksQueuePlugin, { createQueueRoutes } from 'links-queue-fastify';

const fastify = Fastify();
await fastify.register(linksQueuePlugin);
await fastify.register(createQueueRoutes(), { prefix: '/api' });

// Available endpoints:
// GET    /api/queues                    - List queues
// POST   /api/queues                    - Create queue
// GET    /api/queues/:name              - Get queue info
// DELETE /api/queues/:name              - Delete queue
// POST   /api/queues/:name/messages     - Enqueue message
// GET    /api/queues/:name/messages     - Dequeue message
// GET    /api/queues/:name/messages/peek - Peek at next message
// POST   /api/queues/:name/messages/:id/ack    - Acknowledge
// POST   /api/queues/:name/messages/:id/reject - Reject

await fastify.listen({ port: 3000 });
```

## Facade API

The `fastify.linksQueue` facade provides these methods:

- `createQueue(name, options?)` - Create a new queue
- `getQueue(name)` - Get an existing queue
- `getOrCreateQueue(name, options?)` - Get or create a queue
- `deleteQueue(name)` - Delete a queue
- `listQueues()` - List all queues
- `enqueue(queueName, payload, options?)` - Add item to queue
- `dequeue(queueName)` - Remove and return next item
- `peek(queueName)` - View next item without removing
- `acknowledge(queueName, messageId)` - Confirm processing
- `reject(queueName, messageId, requeue?)` - Reject item
- `getStats(queueName)` - Get queue statistics

## License

Unlicense
