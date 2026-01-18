# Server Mode

Links Queue can run as a standalone TCP server, allowing clients to connect over the network. This guide covers server setup, client connection, and the protocol.

## Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Server Deployment                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────┐    Links Notation    ┌───────────────┐                │
│  │  Client  │◄───────────────────► │ links-queue   │                │
│  └──────────┘                      │    server     │                │
│                                    └───────────────┘                │
│  ┌──────────┐    Links Notation    ┌───────────────┐                │
│  │  Client  │◄───────────────────► │ links-queue   │                │
│  └──────────┘                      │    server     │                │
│                                    └───────────────┘                │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Starting the Server

### JavaScript

```javascript
import { LinksQueueServer } from "links-queue-js/server";

const server = new LinksQueueServer({
  port: 5000,
  host: "0.0.0.0",
});

await server.start();
console.log("Server listening on port 5000");

// Graceful shutdown
process.on("SIGTERM", async () => {
  await server.stop();
});
```

### Rust

```rust
use links_queue::server::{LinksQueueServer, ServerConfig};

let config = ServerConfig::new()
    .host("0.0.0.0")
    .port(5000)
    .max_connections(1000);

let server = LinksQueueServer::new(config);
server.start().await?;

println!("Server listening on port 5000");
```

### CLI

```bash
# JavaScript
npx links-queue-js server --port 5000

# With custom host
npx links-queue-js server --host 127.0.0.1 --port 8080

# Rust
links-queue server --port 5000 --host 0.0.0.0 --max-conn 500
```

## Server Configuration

| Option           | Description                | Default   |
| ---------------- | -------------------------- | --------- |
| `host`           | Bind address               | `0.0.0.0` |
| `port`           | Listen port                | `5000`    |
| `maxConnections` | Maximum concurrent clients | `1000`    |
| `timeout`        | Request timeout (ms)       | `30000`   |
| `backlog`        | TCP connection backlog     | `128`     |

### JavaScript Configuration

```javascript
const server = new LinksQueueServer({
  host: "0.0.0.0",
  port: 5000,
  maxConnections: 1000,
  timeout: 30000,
});
```

### Rust Configuration

```rust
let config = ServerConfig::new()
    .host("0.0.0.0")
    .port(5000)
    .max_connections(1000)
    .timeout(Duration::from_secs(30));
```

## Client Connection

### JavaScript

```javascript
import { LinksQueueClient } from "links-queue-js/client";

const client = new LinksQueueClient("localhost:5000");
await client.connect();

// Use the client
await client.createQueue("tasks");
await client.enqueue("tasks", { source: "job", target: "process" });

// Disconnect when done
await client.disconnect();
```

### Rust

```rust
use links_queue::client::{LinksQueueClient, ClientConfig};

let config = ClientConfig::new("localhost:5000");
let client = LinksQueueClient::connect(config).await?;

// Use the client
client.create_queue("tasks", Default::default()).await?;
client.enqueue("tasks", Link::new(0, "job", "process")).await?;

// Disconnect
client.disconnect().await?;
```

### Connection Options

| Option       | Description                  | Default  |
| ------------ | ---------------------------- | -------- |
| `address`    | Server address (host:port)   | Required |
| `reconnect`  | Auto-reconnect on disconnect | `true`   |
| `maxRetries` | Max reconnection attempts    | `3`      |
| `timeout`    | Connection timeout (ms)      | `5000`   |

```javascript
const client = new LinksQueueClient("localhost:5000", {
  reconnect: true,
  maxRetries: 5,
  timeout: 10000,
});
```

## Protocol Reference

Links Queue uses a length-prefixed message format over TCP.

### Message Framing

```
┌────────────────────────────────────────────────────────────────────┐
│                       Message Frame                                 │
├────────┬───────────────────────────────────────────────────────────┤
│ Length │                    Payload                                 │
│ 4 bytes│                   Variable                                 │
│(big-end)│                                                           │
└────────┴───────────────────────────────────────────────────────────┘
```

### Request Format

Requests use Links Notation:

```
((type: "enqueue"),
 ((queue: "tasks"),
  ((payload: ((action: "process"), (data: "..."))))))
```

JSON equivalent:

```json
{
  "op": "enqueue",
  "queue": "tasks",
  "link": { "id": 0, "source": "action", "target": "process" }
}
```

### Response Format

Success response:

```
((status: "ok"),
 ((result: ((id: "abc123"), (position: 42)))))
```

```json
{ "ok": true, "result": { "id": "abc123", "position": 42 } }
```

Error response:

```
((status: "error"),
 ((code: "QueueNotFound"),
  (message: "Queue 'tasks' does not exist")))
```

```json
{ "ok": false, "error": "Queue not found", "code": "QueueNotFound" }
```

## Supported Operations

| Operation      | Description          | Example                                                    |
| -------------- | -------------------- | ---------------------------------------------------------- |
| `ping`         | Health check         | Returns `pong`                                             |
| `create_queue` | Create a new queue   | `{op: "create_queue", queue: "tasks"}`                     |
| `delete_queue` | Delete a queue       | `{op: "delete_queue", queue: "tasks"}`                     |
| `list_queues`  | List all queues      | `{op: "list_queues"}`                                      |
| `get_queue`    | Get queue info       | `{op: "get_queue", queue: "tasks"}`                        |
| `enqueue`      | Add item to queue    | `{op: "enqueue", queue: "tasks", link: {...}}`             |
| `dequeue`      | Get next item        | `{op: "dequeue", queue: "tasks"}`                          |
| `peek`         | View next item       | `{op: "peek", queue: "tasks"}`                             |
| `acknowledge`  | Confirm processing   | `{op: "ack", queue: "tasks", id: "..."}`                   |
| `reject`       | Reject item          | `{op: "reject", queue: "tasks", id: "...", requeue: true}` |
| `stats`        | Get queue statistics | `{op: "stats", queue: "tasks"}`                            |

## Client API Reference

### Queue Management

```javascript
// Create a queue
await client.createQueue("tasks");
await client.createQueue("priority-tasks", { priority: true });

// Delete a queue
await client.deleteQueue("tasks");

// List queues
const queues = await client.listQueues();

// Get queue info
const info = await client.getQueue("tasks");
```

### Queue Operations

```javascript
// Enqueue
const result = await client.enqueue("tasks", {
  source: "job",
  target: "process-data",
});
console.log(`Enqueued at position ${result.position}`);

// Dequeue
const item = await client.dequeue("tasks");
if (item) {
  console.log(`Got item: ${item.id}`);
}

// Peek (view without removing)
const next = await client.peek("tasks");

// Acknowledge
await client.acknowledge("tasks", item.id);

// Reject (optionally requeue)
await client.reject("tasks", item.id, { requeue: true });
```

### Statistics

```javascript
const stats = await client.getStats("tasks");
console.log(`Queue depth: ${stats.depth}`);
console.log(`Messages processed: ${stats.processed}`);
console.log(`Messages failed: ${stats.failed}`);
```

## Connection Management

### Auto-Reconnection

```javascript
const client = new LinksQueueClient("localhost:5000", {
  reconnect: true,
  maxRetries: 5,
  retryDelay: 1000,
});

client.on("disconnected", () => {
  console.log("Lost connection, reconnecting...");
});

client.on("reconnected", () => {
  console.log("Reconnected to server");
});
```

### Connection Pooling

For high-throughput applications:

```javascript
import { ConnectionPool } from "links-queue-js/client";

const pool = new ConnectionPool({
  address: "localhost:5000",
  minConnections: 5,
  maxConnections: 20,
});

// Get a connection from the pool
const conn = await pool.acquire();
try {
  await conn.enqueue("tasks", link);
} finally {
  pool.release(conn);
}
```

## Error Handling

### Error Codes

| Code               | Description              |
| ------------------ | ------------------------ |
| `QueueNotFound`    | Queue does not exist     |
| `QueueExists`      | Queue already exists     |
| `InvalidRequest`   | Malformed request        |
| `Timeout`          | Operation timed out      |
| `ConnectionFailed` | Cannot connect to server |

### JavaScript Error Handling

```javascript
import { LinksQueueClient } from "links-queue-js/client";

try {
  await client.enqueue("nonexistent", link);
} catch (error) {
  if (error.code === "QueueNotFound") {
    // Create the queue first
    await client.createQueue("nonexistent");
    await client.enqueue("nonexistent", link);
  } else {
    throw error;
  }
}
```

## Server Events

Monitor server activity:

```javascript
const server = new LinksQueueServer({ port: 5000 });

server.on("connection", (conn) => {
  console.log(`Client connected: ${conn.remoteAddress}`);
});

server.on("disconnection", (conn) => {
  console.log(`Client disconnected: ${conn.remoteAddress}`);
});

server.on("request", (req, conn) => {
  console.log(`Request: ${req.op} from ${conn.remoteAddress}`);
});

server.on("error", (error) => {
  console.error(`Server error: ${error.message}`);
});
```

## Security Considerations

### Binding to Localhost

For development, bind to localhost only:

```javascript
const server = new LinksQueueServer({
  host: "127.0.0.1",
  port: 5000,
});
```

### TLS Support (Future)

TLS encryption for production deployments is planned for a future release.

### Network Security

For production:

1. Run behind a firewall
2. Use a reverse proxy (nginx, HAProxy) for TLS termination
3. Implement authentication at the application layer
4. Monitor connections and rate-limit clients

## Next Steps

- [Clustering](clustering.md) - Multi-node server deployment
- [Best Practices](best-practices.md) - Production deployment tips
- [API Reference](../api/js/README.md) - Complete API documentation
