# Best Practices

This guide covers best practices for using Links Queue in production, including error handling, performance tuning, and monitoring.

## Error Handling

### Idempotent Consumers

Links Queue guarantees at-least-once delivery, meaning messages may be delivered more than once. Design consumers to be idempotent:

```javascript
// Good: Idempotent operation
async function processOrder(link) {
  const orderId = link.target;

  // Check if already processed
  if (await db.orderExists(orderId)) {
    console.log(`Order ${orderId} already processed, skipping`);
    return;
  }

  // Process the order
  await db.createOrder(orderId);
}

// Bad: Non-idempotent operation
async function processOrderBad(link) {
  // This will create duplicate orders on redelivery!
  await db.createOrder(link.target);
}
```

### Dead Letter Queues

Configure dead letter queues for messages that fail repeatedly:

```javascript
const queue = await manager.createQueue("tasks", {
  deadLetterQueue: "tasks-dlq",
  maxRetries: 3,
});

// Monitor the DLQ
const dlq = manager.getQueue("tasks-dlq");
const stats = await dlq.getStats();
if (stats.depth > 100) {
  alert("DLQ is backing up!");
}
```

### Retry Strategies

Implement exponential backoff for transient failures:

```javascript
import { MemoryQueue } from "links-queue-js";

const queue = new MemoryQueue("tasks", {
  retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 60000),
  maxRetries: 5,
});
```

### Error Logging

Log errors with context for debugging:

```javascript
async function processLink(link) {
  try {
    await doWork(link);
    await queue.acknowledge(link.id);
  } catch (error) {
    console.error("Processing failed", {
      linkId: link.id,
      source: link.source,
      target: link.target,
      error: error.message,
      stack: error.stack,
      attempt: link.metadata?.attempts || 1,
    });

    await queue.reject(link.id, { requeue: true });
  }
}
```

## Performance Tuning

### Batch Operations

Process multiple items in batches for better throughput:

```javascript
// Good: Batch processing
async function processBatch(queue, batchSize = 10) {
  const items = [];

  for (let i = 0; i < batchSize; i++) {
    const item = await queue.dequeue();
    if (!item) break;
    items.push(item);
  }

  // Process all items
  await Promise.all(items.map(processItem));

  // Acknowledge all
  await Promise.all(items.map((item) => queue.acknowledge(item.id)));
}
```

### Connection Pooling

Use connection pools for client connections:

```javascript
import { ConnectionPool } from "links-queue-js/client";

const pool = new ConnectionPool({
  address: "localhost:5000",
  minConnections: 5,
  maxConnections: 20,
  idleTimeout: 30000,
});

// Use pooled connections
async function enqueueWithPool(link) {
  const conn = await pool.acquire();
  try {
    await conn.enqueue("tasks", link);
  } finally {
    pool.release(conn);
  }
}
```

### Visibility Timeout

Set appropriate visibility timeouts based on processing time:

```javascript
// Short-running tasks: 30 seconds
const fastQueue = new MemoryQueue("fast-tasks", {
  visibilityTimeout: 30000,
});

// Long-running tasks: 5 minutes
const slowQueue = new MemoryQueue("slow-tasks", {
  visibilityTimeout: 300000,
});
```

### Prefetching

Prefetch items to reduce latency:

```javascript
const consumer = await queue.subscribe(processItem, {
  prefetch: 10, // Buffer up to 10 items
});
```

## Memory Management

### Link Store Limits

Set limits on in-memory stores:

```javascript
const store = new MemoryLinkStore({
  maxSize: 1000000, // Maximum 1M links
});

store.on("eviction", (evictedLink) => {
  console.warn(`Link evicted due to memory pressure: ${evictedLink.id}`);
});
```

### Queue Depth Monitoring

Monitor queue depth to prevent memory exhaustion:

```javascript
async function monitorQueueDepth(queue, maxDepth = 100000) {
  const stats = await queue.getStats();

  if (stats.depth > maxDepth) {
    console.warn(`Queue depth ${stats.depth} exceeds threshold ${maxDepth}`);
    // Take action: pause producers, scale consumers, etc.
  }
}
```

### Cleanup Strategies

Implement cleanup for completed items:

```javascript
// Periodic cleanup
setInterval(
  async () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    await store.deleteMatching({
      metadata: { completedBefore: cutoff },
    });
  },
  60 * 60 * 1000,
); // Every hour
```

## Monitoring

### Metrics to Track

| Metric          | Description     | Alert Threshold |
| --------------- | --------------- | --------------- |
| Queue depth     | Items waiting   | > 10,000        |
| Processing rate | Items/second    | < 100           |
| Error rate      | Failures/minute | > 10            |
| Consumer lag    | Time behind     | > 60 seconds    |
| DLQ depth       | Failed items    | > 100           |

### Health Checks

Implement health check endpoints:

```javascript
app.get("/health", async (req, res) => {
  const health = {
    status: "healthy",
    checks: {},
  };

  // Check queue connection
  try {
    await client.ping();
    health.checks.queue = { status: "up" };
  } catch (error) {
    health.status = "unhealthy";
    health.checks.queue = { status: "down", error: error.message };
  }

  // Check queue depth
  const stats = await client.getStats("tasks");
  health.checks.queueDepth = {
    status: stats.depth < 10000 ? "ok" : "warning",
    value: stats.depth,
  };

  res.status(health.status === "healthy" ? 200 : 503).json(health);
});
```

### Logging

Use structured logging for observability:

```javascript
const logger = {
  info: (msg, data) =>
    console.log(
      JSON.stringify({
        level: "info",
        msg,
        ...data,
        timestamp: new Date().toISOString(),
      }),
    ),
  warn: (msg, data) =>
    console.warn(
      JSON.stringify({
        level: "warn",
        msg,
        ...data,
        timestamp: new Date().toISOString(),
      }),
    ),
  error: (msg, data) =>
    console.error(
      JSON.stringify({
        level: "error",
        msg,
        ...data,
        timestamp: new Date().toISOString(),
      }),
    ),
};

// Usage
logger.info("Item processed", {
  queueName: "tasks",
  linkId: link.id,
  duration: 150,
});
logger.error("Processing failed", {
  queueName: "tasks",
  linkId: link.id,
  error: error.message,
});
```

### Alerting

Set up alerts for critical conditions:

```javascript
async function checkQueueHealth(queueName) {
  const stats = await queue.getStats();

  if (stats.depth > 50000) {
    await sendAlert("critical", `Queue ${queueName} depth is ${stats.depth}`);
  } else if (stats.depth > 10000) {
    await sendAlert("warning", `Queue ${queueName} depth is ${stats.depth}`);
  }

  if (stats.errorRate > 0.1) {
    await sendAlert(
      "critical",
      `Queue ${queueName} error rate is ${stats.errorRate * 100}%`,
    );
  }
}
```

## Production Deployment

### Configuration Management

Use environment variables for configuration:

```javascript
const config = {
  mode: process.env.LINKS_QUEUE_MODE || "single-memory",
  backend: {
    type: process.env.LINKS_QUEUE_BACKEND || "memory",
    path: process.env.LINKS_QUEUE_DB_PATH || "./data/queue.links",
  },
  server: {
    host: process.env.LINKS_QUEUE_HOST || "0.0.0.0",
    port: parseInt(process.env.LINKS_QUEUE_PORT || "5000", 10),
  },
};
```

### Graceful Shutdown

Handle shutdown signals properly:

```javascript
const server = new LinksQueueServer(config);

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);

  // Stop accepting new connections
  server.stop();

  // Wait for in-flight requests
  await server.drain(30000);

  // Close backend connections
  await backend.disconnect();

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

### Container Deployment

Dockerfile example:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["node", "src/server.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: links-queue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: links-queue
  template:
    metadata:
      labels:
        app: links-queue
    spec:
      containers:
        - name: links-queue
          image: links-queue:latest
          ports:
            - containerPort: 5000
          env:
            - name: LINKS_QUEUE_MODE
              value: "multi-stored"
            - name: LINKS_QUEUE_BACKEND
              value: "link-cli"
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          livenessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 5000
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

## Security

### Network Security

- Use TLS for all network communication (when available)
- Run behind a firewall
- Use VPCs/private networks in cloud environments

### Input Validation

Validate all input before processing:

```javascript
function validateLink(link) {
  if (!link || typeof link !== "object") {
    throw new Error("Invalid link: must be an object");
  }

  if (link.source === undefined || link.target === undefined) {
    throw new Error("Invalid link: source and target required");
  }

  // Validate payload size
  const size = JSON.stringify(link).length;
  if (size > 1024 * 1024) {
    throw new Error("Link too large: maximum 1MB");
  }

  return true;
}
```

### Resource Limits

Set limits to prevent resource exhaustion:

```javascript
const server = new LinksQueueServer({
  maxConnections: 1000,
  maxRequestSize: 1024 * 1024, // 1MB
  rateLimitPerClient: 1000, // requests/second
});
```

## Testing

### Unit Tests

Test individual components:

```javascript
import { MemoryQueue, createLink } from "links-queue-js";
import { test } from "node:test";
import assert from "node:assert";

test("enqueue and dequeue", async () => {
  const queue = new MemoryQueue("test");
  const link = createLink(1, "source", "target");

  await queue.enqueue(link);
  const item = await queue.dequeue();

  assert.strictEqual(item.id, link.id);
  assert.strictEqual(item.source, link.source);
});
```

### Integration Tests

Test end-to-end flows:

```javascript
test("client-server integration", async () => {
  const server = new LinksQueueServer({ port: 0 });
  await server.start();

  const client = new LinksQueueClient(`localhost:${server.port}`);
  await client.connect();

  await client.createQueue("test");
  await client.enqueue("test", createLink(1, "a", "b"));
  const item = await client.dequeue("test");

  assert.ok(item);

  await client.disconnect();
  await server.stop();
});
```

### Load Testing

Test under production-like load:

```javascript
async function loadTest(concurrency, duration) {
  const client = new LinksQueueClient("localhost:5000");
  await client.connect();

  const start = Date.now();
  let operations = 0;
  let errors = 0;

  while (Date.now() - start < duration) {
    const promises = [];
    for (let i = 0; i < concurrency; i++) {
      promises.push(
        client
          .enqueue("test", createLink(0, "load", "test"))
          .catch(() => errors++),
      );
    }
    await Promise.all(promises);
    operations += concurrency;
  }

  const elapsed = (Date.now() - start) / 1000;
  console.log(`Operations: ${operations}, Errors: ${errors}`);
  console.log(`Throughput: ${(operations / elapsed).toFixed(0)} ops/sec`);
}
```

## Troubleshooting

### Common Issues

| Issue                | Cause           | Solution                             |
| -------------------- | --------------- | ------------------------------------ |
| High queue depth     | Slow consumers  | Scale consumers, optimize processing |
| Connection timeouts  | Network issues  | Check firewall, increase timeout     |
| Memory exhaustion    | Unbounded queue | Set limits, enable persistence       |
| Duplicate processing | No idempotency  | Implement deduplication              |

### Debug Mode

Enable debug logging:

```bash
DEBUG=links-queue:* node app.js
```

```javascript
// Programmatic debug
import { setLogLevel } from "links-queue-js";
setLogLevel("debug");
```

## Next Steps

- [Getting Started](getting-started.md) - Quick start guide
- [API Reference](../api/js/README.md) - Complete API documentation
- [Clustering](clustering.md) - Multi-node deployment
