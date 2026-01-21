# links-queue-hono

Hono middleware for [Links Queue](https://github.com/link-foundation/links-queue).

Works great for edge environments like Cloudflare Workers, Deno Deploy, Bun, and more.

## Installation

```bash
npm install links-queue-hono
```

## Quick Start

```javascript
import { Hono } from 'hono';
import { linksQueue } from 'links-queue-hono';

const app = new Hono();
app.use('*', linksQueue({ mode: 'single-memory' }));

// Enqueue a task
app.post('/tasks', async (c) => {
  const body = await c.req.json();
  const result = await c.get('linksQueue').enqueue('tasks', body);
  return c.json(result);
});

// Dequeue a task
app.get('/tasks', async (c) => {
  const task = await c.get('linksQueue').dequeue('tasks');
  if (!task) {
    return c.body(null, 204);
  }
  return c.json(task);
});

export default app;
```

## Middleware Options

```javascript
linksQueue({
  // Queue mode: 'single-memory' (default) or 'single-stored'
  mode: 'single-memory',

  // Key on context object
  contextKey: 'linksQueue',

  // Or provide a custom queue manager
  queueManager: myCustomManager,
});
```

## RESTful Queue App

For a full RESTful API, use the queue app:

```javascript
import { Hono } from 'hono';
import { linksQueue, createQueueApp } from 'links-queue-hono';

const app = new Hono();
app.use('*', linksQueue());
app.route('/api/queues', createQueueApp());

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

export default app;
```

## Facade API

The `c.get('linksQueue')` facade provides these methods:

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

## Cloudflare Workers Example

```javascript
import { Hono } from 'hono';
import { linksQueue } from 'links-queue-hono';

const app = new Hono();
app.use('*', linksQueue());

app.post('/tasks', async (c) => {
  const task = await c.req.json();
  const result = await c.get('linksQueue').enqueue('tasks', task);
  return c.json(result, 201);
});

app.get('/tasks', async (c) => {
  const task = await c.get('linksQueue').dequeue('tasks');
  if (!task) {
    return c.json({ message: 'No tasks available' }, 204);
  }
  return c.json(task);
});

export default app;
```

## License

Unlicense
