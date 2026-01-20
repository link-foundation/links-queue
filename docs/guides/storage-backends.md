# Storage Backends

Links Queue supports pluggable storage backends. This guide covers the built-in backends and how to create custom ones.

## Backend Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Storage Backend Layer                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐                                                │
│  │  Memory Backend │  In-memory HashMap                             │
│  │                 │  • O(1) access                                 │
│  │                 │  • No durability                               │
│  │                 │  • Bounded by RAM                              │
│  └─────────────────┘                                                │
│                                                                      │
│  ┌─────────────────┐                                                │
│  │ link-cli Backend│  SQLite-based storage via link-cli             │
│  │                 │  • Durable                                     │
│  │                 │  • ACID transactions                           │
│  │                 │  • Pattern matching via SQL                    │
│  └─────────────────┘                                                │
│                                                                      │
│  ┌─────────────────┐                                                │
│  │ Custom Backend  │  User-implemented storage                      │
│  │                 │  • Implement StorageBackend interface          │
│  │                 │  • Register at startup                         │
│  └─────────────────┘                                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Memory Backend

The default backend. Stores all data in memory for maximum performance.

### Features

- Sub-millisecond operations
- No external dependencies
- Perfect for development and testing
- Data lost on process exit

### JavaScript

```javascript
import { MemoryLinkStore } from "links-queue-js";

const store = new MemoryLinkStore();

// Create links
const link1 = await store.create(10, 20);
const link2 = await store.create(10, 30);

// Query by pattern
const links = await store.find({ source: 10 });
console.log(`Found ${links.length} links`); // 2

// Count links
const count = await store.count();
console.log(`Total links: ${count}`);

// Iterate over links
for await (const link of store.iterate()) {
  console.log(link);
}
```

### Rust

```rust
use links_queue::{MemoryBackend, StorageBackend};

let backend = MemoryBackend::new();

// Create links
let link1 = backend.save(Link::new(0, 10, 20)).await?;
let link2 = backend.save(Link::new(0, 10, 30)).await?;

// Query by pattern
let links = backend.query(LinkPattern::source(10)).await?;
println!("Found {} links", links.len()); // 2
```

### Configuration

```javascript
import { BackendRegistry } from "links-queue-js";

const registry = new BackendRegistry();
const backend = registry.create({
  type: "memory",
  options: {
    maxSize: 1000000, // Maximum number of links
  },
});
```

## link-cli Backend

Persistent storage using [link-cli](https://github.com/link-foundation/link-cli) (also known as `clink`), which stores data in SQLite.

### Features

- Full durability (survives restarts)
- ACID transactions
- SQL-based pattern matching
- Configurable database location

### Prerequisites

Install link-cli:

```bash
# Using cargo
cargo install link-cli

# Verify installation
clink --version
```

### JavaScript

```javascript
import { LinkCliBackend, LinkCliProcess } from "links-queue-js";

// Create and connect the backend
const backend = new LinkCliBackend({
  path: "./data/queue.links",
  autoStart: true,
});

await backend.connect();

// Use like any other backend
const link = await backend.save({ id: 0, source: 10, target: 20 });

// Query links
const links = await backend.query({ source: 10 });

// Clean up
await backend.disconnect();
```

### Rust

```rust
use links_queue::{LinkCliBackend, LinkCliConfig, StorageBackend};

// Create configuration
let config = LinkCliConfig::new("./data/queue.links")
    .with_timeout(Duration::from_secs(30))
    .with_auto_restart(true);

// Create and connect the backend
let backend = LinkCliBackend::new(config).await?;

// Use the backend
let link = backend.save(Link::new(0, 10, 20)).await?;

// Clean up
backend.disconnect().await?;
```

### Process Management

The link-cli backend manages a child process:

```javascript
import { LinkCliProcess, ProcessState } from "links-queue-js";

const process = new LinkCliProcess({
  path: "./data/queue.links",
  binary: "clink", // Optional: custom binary path
});

// Start the process
await process.start();

// Execute commands
const result = await process.execute("? * * *");
console.log("Links:", result);

// Check state
console.log("State:", process.state); // 'running'

// Stop the process
await process.stop();
```

### Configuration Options

| Option        | Description                 | Default   |
| ------------- | --------------------------- | --------- |
| `path`        | Database file location      | Required  |
| `binary`      | Path to clink binary        | `'clink'` |
| `timeout`     | Command timeout (ms)        | `30000`   |
| `autoStart`   | Start process automatically | `true`    |
| `autoRestart` | Restart on crash            | `true`    |

```javascript
const backend = new LinkCliBackend({
  path: "./data/queue.links",
  binary: "/usr/local/bin/clink",
  timeout: 60000,
  autoStart: true,
  autoRestart: true,
});
```

## Backend Registry

Use the registry to create backends dynamically:

### JavaScript

```javascript
import { BackendRegistry } from "links-queue-js";

const registry = new BackendRegistry();

// Create memory backend
const memoryBackend = registry.create({
  type: "memory",
});

// Create link-cli backend
const persistentBackend = registry.create({
  type: "link-cli",
  options: {
    path: "./data/queue.links",
  },
});

// Get capabilities
const caps = persistentBackend.getCapabilities();
console.log("Supports transactions:", caps.supportsTransactions);
console.log("Durability level:", caps.durabilityLevel);
```

### Rust

```rust
use links_queue::{BackendRegistry, BackendConfig};

let registry = BackendRegistry::new();

// Create memory backend
let memory = registry.create(&BackendConfig::memory())?;

// Create link-cli backend
let persistent = registry.create(&BackendConfig::link_cli("./data/queue.links"))?;

// Get capabilities
let caps = persistent.get_capabilities();
println!("Durability: {:?}", caps.durability_level);
```

## Creating Custom Backends

Implement the `StorageBackend` interface to create custom storage:

### JavaScript

```javascript
/**
 * Custom backend implementation
 */
class RedisBackend {
  constructor(options) {
    this.client = null;
    this.options = options;
  }

  async connect() {
    // Connect to Redis
    this.client = await redis.connect(this.options.url);
  }

  async disconnect() {
    await this.client.quit();
  }

  async save(link) {
    const id = await this.client.incr("link:counter");
    const savedLink = { ...link, id };
    await this.client.set(`link:${id}`, JSON.stringify(savedLink));
    return savedLink;
  }

  async load(id) {
    const data = await this.client.get(`link:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async delete(id) {
    const result = await this.client.del(`link:${id}`);
    return result > 0;
  }

  async query(pattern) {
    // Implement pattern matching
    const links = [];
    // ... scan and filter links
    return links;
  }

  getCapabilities() {
    return {
      supportsTransactions: true,
      supportsBatchOperations: true,
      durabilityLevel: "replicated",
      maxLinkSize: 512 * 1024 * 1024, // 512MB
    };
  }

  getStats() {
    return {
      totalLinks: 0,
      operations: { reads: 0, writes: 0, deletes: 0 },
    };
  }
}

// Register the custom backend
import { BackendRegistry } from "links-queue-js";

const registry = new BackendRegistry();
registry.register("redis", RedisBackend);

// Use it
const backend = registry.create({
  type: "redis",
  options: { url: "redis://localhost:6379" },
});
```

### Rust

```rust
use links_queue::{StorageBackend, BackendCapabilities, Link, LinkPattern};
use async_trait::async_trait;

pub struct RedisBackend {
    client: redis::Client,
}

#[async_trait]
impl StorageBackend for RedisBackend {
    async fn save(&self, link: Link) -> Result<Link, BackendError> {
        // Save to Redis
        todo!()
    }

    async fn load(&self, id: LinkId) -> Result<Option<Link>, BackendError> {
        // Load from Redis
        todo!()
    }

    async fn delete(&self, id: LinkId) -> Result<bool, BackendError> {
        // Delete from Redis
        todo!()
    }

    async fn query(&self, pattern: LinkPattern) -> Result<Vec<Link>, BackendError> {
        // Query Redis
        todo!()
    }

    fn get_capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            supports_transactions: true,
            supports_batch_operations: true,
            durability_level: DurabilityLevel::Replicated,
            max_link_size: 512 * 1024 * 1024,
        }
    }
}
```

## Backend Interface Reference

### Core Operations

| Method           | Description           | Returns                 |
| ---------------- | --------------------- | ----------------------- |
| `save(link)`     | Store a link          | `Link` with assigned ID |
| `load(id)`       | Retrieve a link by ID | `Link` or `null`        |
| `delete(id)`     | Remove a link         | `boolean` success       |
| `query(pattern)` | Find matching links   | `Link[]`                |

### Batch Operations

| Method             | Description           | Returns     |
| ------------------ | --------------------- | ----------- |
| `saveBatch(links)` | Store multiple links  | `Link[]`    |
| `deleteBatch(ids)` | Remove multiple links | `boolean[]` |

### Metadata

| Method              | Description             | Returns               |
| ------------------- | ----------------------- | --------------------- |
| `getCapabilities()` | Backend feature support | `BackendCapabilities` |
| `getStats()`        | Usage statistics        | `BackendStats`        |

## Backend Comparison

| Backend             | Latency | Durability | Transactions | Best For        |
| ------------------- | ------- | ---------- | ------------ | --------------- |
| Memory              | < 1ms   | None       | No           | Dev/Test        |
| link-cli            | 1-10ms  | Full       | Yes          | Production      |
| Custom (Redis)      | 1-5ms   | Optional   | Yes          | Caching         |
| Custom (PostgreSQL) | 5-20ms  | Full       | Yes          | Complex queries |

## Next Steps

- [Operating Modes](operating-modes.md) - Configure single vs multi-node
- [Server Mode](server-mode.md) - Network access to storage
- [Best Practices](best-practices.md) - Production tips
