# Getting Started with Links Queue

This guide will help you get up and running with Links Queue in under 5 minutes.

## Installation

### JavaScript/TypeScript

Links Queue supports Node.js, Bun, and Deno.

```bash
# Using npm
npm install links-queue-js

# Using yarn
yarn add links-queue-js

# Using bun
bun add links-queue-js

# Using pnpm
pnpm add links-queue-js
```

For Deno, import directly from npm:

```typescript
import { LinksQueue } from "npm:links-queue-js";
```

### Rust

Add to your `Cargo.toml`:

```toml
[dependencies]
links-queue = "0.11"
tokio = { version = "1", features = ["full"] }
```

## Quick Start

### JavaScript

```javascript
import { MemoryLinkStore, MemoryQueue, createLink } from "links-queue-js";

// Create a link store and queue
const store = new MemoryLinkStore();
const queue = new MemoryQueue("tasks");

// Enqueue a link
const link = createLink(1, "job", "process-data");
const result = await queue.enqueue(link);
console.log(`Enqueued at position ${result.position}`);

// Dequeue and process
const item = await queue.dequeue();
if (item) {
  console.log(`Processing: ${item.source} -> ${item.target}`);
  await queue.acknowledge(item.id);
}
```

### Rust

```rust
use links_queue::{MemoryQueue, Link, Queue};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create a queue
    let queue = MemoryQueue::new("tasks");

    // Enqueue a link
    let link = Link::new(1, "job", "process-data");
    let result = queue.enqueue(link).await?;
    println!("Enqueued at position {}", result.position);

    // Dequeue and process
    if let Some(item) = queue.dequeue().await? {
        println!("Processing: {} -> {}", item.source, item.target);
        queue.acknowledge(item.id).await?;
    }

    Ok(())
}
```

## Using the Queue Manager

For applications with multiple queues, use the queue manager:

### JavaScript

```javascript
import { LinksQueueManager, MemoryLinkStore } from "links-queue-js";

const store = new MemoryLinkStore();
const manager = new LinksQueueManager({ store });

// Create queues
const tasksQueue = await manager.createQueue("tasks");
const eventsQueue = await manager.createQueue("events");

// List all queues
const queues = await manager.listQueues();
console.log(
  "Available queues:",
  queues.map((q) => q.name),
);

// Get queue by name
const queue = manager.getQueue("tasks");
```

### Rust

```rust
use links_queue::{QueueManager, MemoryQueueManager};

let manager = MemoryQueueManager::new();

// Create queues
manager.create_queue("tasks", Default::default()).await?;
manager.create_queue("events", Default::default()).await?;

// List all queues
for info in manager.list_queues().await? {
    println!("Queue: {}", info.name);
}

// Get queue by name
let queue = manager.get_queue("tasks").await?;
```

## Configuration Basics

Links Queue supports multiple operating modes through configuration:

### In-Memory Mode (Default)

Best for development and testing:

```javascript
import { MemoryQueueManager, MemoryLinkStore } from "links-queue-js";

const store = new MemoryLinkStore();
const manager = new MemoryQueueManager({ store });
```

### Persistent Mode (link-cli)

For production use with data persistence:

```javascript
import { LinksQueueManager, LinkCliBackend } from "links-queue-js";

const backend = new LinkCliBackend({
  path: "./data/queue.links",
});
await backend.connect();

const manager = new LinksQueueManager({ backend });
```

### Server Mode

Run as a standalone TCP server:

```javascript
import { LinksQueueServer } from "links-queue-js/server";

const server = new LinksQueueServer({
  port: 5000,
  host: "0.0.0.0",
});

await server.start();
console.log("Server listening on port 5000");
```

Connect from a client:

```javascript
import { LinksQueueClient } from "links-queue-js/client";

const client = new LinksQueueClient("localhost:5000");
await client.connect();

await client.createQueue("tasks");
await client.enqueue("tasks", { source: "job", target: "process" });
```

## Consumer Pattern

Process queue items with automatic acknowledgment:

### JavaScript

```javascript
import { MemoryQueue, createLink } from "links-queue-js";

const queue = new MemoryQueue("tasks");

// Subscribe to the queue
const subscription = await queue.subscribe(async (link) => {
  console.log(`Processing: ${link.id}`);
  // Process the link...
  // Acknowledgment is automatic on success
  // Throw an error to reject and requeue
});

// Enqueue items
await queue.enqueue(createLink(1, "task", "data"));

// Later: unsubscribe
subscription.unsubscribe();
```

## CLI Usage

Links Queue includes a command-line interface:

```bash
# Start a server
npx links-queue-js server --port 5000

# With custom host
npx links-queue-js server --host 127.0.0.1 --port 8080
```

## Next Steps

- [Core Concepts](core-concepts.md) - Learn about links and queue semantics
- [Operating Modes](operating-modes.md) - Choose the right mode for your use case
- [Storage Backends](storage-backends.md) - Configure persistent storage
- [Server Mode](server-mode.md) - Deploy as a network service
- [Best Practices](best-practices.md) - Production deployment tips

## Example Projects

See the `examples/` directory in each implementation:

- [JavaScript Examples](../../js/examples/)
- [Rust Examples](../../rust/examples/)
