# links-queue-express

Express.js middleware for [Links Queue](https://github.com/link-foundation/links-queue).

## Installation

```bash
npm install links-queue-express
```

## Quick Start

```javascript
import express from 'express';
import { linksQueueMiddleware } from 'links-queue-express';

const app = express();
app.use(express.json());
app.use(linksQueueMiddleware({ mode: 'single-memory' }));

// Enqueue a task
app.post('/tasks', async (req, res) => {
  const result = await req.linksQueue.enqueue('tasks', req.body);
  res.json(result);
});

// Dequeue a task
app.get('/tasks', async (req, res) => {
  const task = await req.linksQueue.dequeue('tasks');
  if (!task) {
    return res.status(204).send();
  }
  res.json(task);
});

app.listen(3000);
```

## Middleware Options

```javascript
linksQueueMiddleware({
  // Queue mode: 'single-memory' (default) or 'single-stored'
  mode: 'single-memory',

  // Property name on request object
  requestProperty: 'linksQueue',

  // Or provide a custom queue manager
  queueManager: myCustomManager,
});
```

## RESTful Router

For a full RESTful API, use the queue router:

```javascript
import express from 'express';
import { linksQueueMiddleware, createQueueRouter } from 'links-queue-express';

const app = express();
app.use(express.json());
app.use(linksQueueMiddleware());
app.use('/api', await createQueueRouter());

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

app.listen(3000);
```

## Facade API

The `req.linksQueue` facade provides these methods:

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

## Error Handling

Use the error handler middleware for queue-specific errors:

```javascript
import { linksQueueErrorHandler } from 'links-queue-express';

app.use(linksQueueErrorHandler);
```

## License

Unlicense
