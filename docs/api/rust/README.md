# Rust API Reference

Complete API documentation for the Links Queue Rust implementation.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
links-queue = "0.11"
tokio = { version = "1", features = ["full"] }
```

## Quick Reference

| Module                              | Description                |
| ----------------------------------- | -------------------------- |
| [Core Types](#core-types)           | Link, LinkRef, LinkPattern |
| [LinkStore](#linkstore-trait)       | Storage trait for links    |
| [MemoryLinkStore](#memorylinkstore) | In-memory storage          |
| [Queue](#queue-trait)               | Queue operations           |
| [MemoryQueue](#memoryqueue)         | In-memory queue            |
| [QueueManager](#queuemanager-trait) | Queue lifecycle            |
| [Server](#linksqueueserver)         | TCP server                 |
| [Client](#linksqueueclient)         | TCP client                 |

---

## Core Types

### LinkType Trait

Trait for types that can be used as link identifiers.

```rust
pub trait LinkType:
    Copy + Clone + Default + Debug + PartialEq + Eq + Hash + Send + Sync + 'static
{
    fn zero() -> Self;
    fn is_nothing(&self) -> bool;
    fn increment(self) -> Self;
}
```

Implemented for: `u8`, `u16`, `u32`, `u64`, `u128`, `usize`, `i8`, `i16`, `i32`, `i64`, `i128`, `isize`

### LinkRef

A reference to a link, which can be an ID or a nested Link.

```rust
pub enum LinkRef<T: LinkType> {
    Id(T),
    Link(Box<Link<T>>),
}
```

**Methods:**

| Method                | Description                  | Returns            |
| --------------------- | ---------------------------- | ------------------ |
| `id(id: T)`           | Create ID reference          | `LinkRef<T>`       |
| `link(link: Link<T>)` | Create nested link reference | `LinkRef<T>`       |
| `get_id()`            | Get the ID                   | `T`                |
| `is_id()`             | Check if ID reference        | `bool`             |
| `is_link()`           | Check if link reference      | `bool`             |
| `as_id()`             | Get ID if ID reference       | `Option<T>`        |
| `as_link()`           | Get link if link reference   | `Option<&Link<T>>` |

**Example:**

```rust
use links_queue::{Link, LinkRef};

// Direct reference by ID
let ref1: LinkRef<u64> = LinkRef::Id(42);

// Nested link reference
let inner = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
let ref2: LinkRef<u64> = LinkRef::link(inner);
```

### Link

Represents a link connecting source to target.

```rust
pub struct Link<T: LinkType> {
    pub id: T,
    pub source: LinkRef<T>,
    pub target: LinkRef<T>,
    pub values: Option<Vec<LinkRef<T>>>,
}
```

**Constructors:**

| Method                                    | Description                  |
| ----------------------------------------- | ---------------------------- |
| `new(id, source, target)`                 | Create basic link            |
| `with_values(id, source, target, values)` | Create universal link        |
| `point(id)`                               | Create self-referential link |
| `nothing()`                               | Create null link             |

**Methods:**

| Method         | Description               | Returns |
| -------------- | ------------------------- | ------- |
| `source_id()`  | Get source ID             | `T`     |
| `target_id()`  | Get target ID             | `T`     |
| `is_point()`   | Check if self-referential | `bool`  |
| `is_null()`    | Check if null link        | `bool`  |
| `has_values()` | Check if has values       | `bool`  |

**Example:**

```rust
use links_queue::{Link, LinkRef};

// Simple link
let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));

// Nested link
let inner = Link::new(2u64, LinkRef::Id(3), LinkRef::Id(4));
let outer = Link::new(1u64, LinkRef::link(inner), LinkRef::Id(5));

// Universal link with values
let universal = Link::with_values(
    1u64,
    LinkRef::Id(2),
    LinkRef::Id(3),
    vec![LinkRef::Id(4), LinkRef::Id(5)]
);
```

### Any

Wildcard for pattern matching.

```rust
use links_queue::Any;
```

### LinkPattern

Pattern for matching links in queries.

```rust
pub struct LinkPattern<T: LinkType> {
    pub id: PatternField<T>,
    pub source: PatternField<T>,
    pub target: PatternField<T>,
}
```

**Constructors:**

| Method                               | Description                 |
| ------------------------------------ | --------------------------- |
| `new()`                              | Empty pattern (matches all) |
| `all()`                              | Matches all links           |
| `with_source(source)`                | Match by source             |
| `with_target(target)`                | Match by target             |
| `with_source_target(source, target)` | Match by both               |

**Builder Methods:**

| Method           | Description        |
| ---------------- | ------------------ |
| `.id(value)`     | Set ID pattern     |
| `.source(value)` | Set source pattern |
| `.target(value)` | Set target pattern |

**Example:**

```rust
use links_queue::{Link, LinkPattern, LinkRef, Any};

// Match all links with source = 5
let pattern = LinkPattern::<u64>::with_source(LinkRef::Id(5));

// Match all links with any source and target = 10
let pattern2 = LinkPattern::<u64>::new()
    .source(Any)
    .target(10u64);

// Check if link matches
let link = Link::new(1u64, LinkRef::Id(5), LinkRef::Id(10));
assert!(pattern.matches(&link));
assert!(pattern2.matches(&link));
```

---

## LinkStore Trait

Trait for link storage operations.

```rust
pub trait LinkStore<T: LinkType>: Send + Sync {
    fn create(&mut self, source: LinkRef<T>, target: LinkRef<T>) -> LinkResult<T, Link<T>>;
    fn create_with_values(&mut self, source: LinkRef<T>, target: LinkRef<T>, values: Vec<LinkRef<T>>) -> LinkResult<T, Link<T>>;
    fn get(&self, id: T) -> Option<&Link<T>>;
    fn exists(&self, id: T) -> bool;
    fn find(&self, pattern: &LinkPattern<T>) -> Vec<&Link<T>>;
    fn count(&self, pattern: &LinkPattern<T>) -> usize;
    fn total_count(&self) -> usize;
    fn update(&mut self, id: T, source: LinkRef<T>, target: LinkRef<T>) -> LinkResult<T, Link<T>>;
    fn delete(&mut self, id: T) -> bool;
    fn delete_matching(&mut self, pattern: &LinkPattern<T>) -> usize;
    fn iter<'a>(&'a self, pattern: &'a LinkPattern<T>) -> Box<dyn Iterator<Item = &'a Link<T>> + 'a>;
    fn iter_all(&self) -> Box<dyn Iterator<Item = &Link<T>> + '_>;
}
```

### LinkError

```rust
pub enum LinkError<T: LinkType> {
    NotFound(T),
    AlreadyExists(T),
    HasUsages(Vec<Link<T>>),
    LimitReached,
    Other(String),
}
```

---

## MemoryLinkStore

In-memory implementation with automatic deduplication.

```rust
use links_queue::{MemoryLinkStore, LinkStore, LinkRef, LinkPattern};

let mut store = MemoryLinkStore::<u64>::new();

// Create links
let link1 = store.create(LinkRef::Id(2), LinkRef::Id(3)).unwrap();
let link2 = store.create(LinkRef::Id(2), LinkRef::Id(4)).unwrap();

// Deduplication - same structure returns existing link
let duplicate = store.create(LinkRef::Id(2), LinkRef::Id(3)).unwrap();
assert_eq!(duplicate.id, link1.id);

// Find by pattern
let results = store.find(&LinkPattern::with_source(LinkRef::Id(2)));
assert_eq!(results.len(), 2);

// Iterate
for link in store.iter_all() {
    println!("{:?}", link);
}
```

---

## Queue Trait

Interface for queue operations.

```rust
pub trait Queue<T: LinkType>: Send + Sync {
    fn name(&self) -> &str;
    fn enqueue(&self, link: Link<T>) -> QueueResult<EnqueueResult<T>>;
    fn dequeue(&self) -> QueueResult<Option<Link<T>>>;
    fn peek(&self) -> QueueResult<Option<Link<T>>>;
    fn acknowledge(&self, id: T) -> QueueResult<()>;
    fn reject(&self, id: T, requeue: bool) -> QueueResult<()>;
    fn get_stats(&self) -> QueueStats;
    fn get_depth(&self) -> usize;
}
```

### EnqueueResult

```rust
pub struct EnqueueResult<T: LinkType> {
    pub id: T,
    pub position: usize,
}
```

### QueueStats

```rust
pub struct QueueStats {
    pub depth: usize,
    pub enqueued: u64,
    pub dequeued: u64,
    pub acknowledged: u64,
    pub rejected: u64,
    pub in_flight: usize,
}
```

### QueueOptions

```rust
pub struct QueueOptions {
    pub max_size: Option<usize>,
    pub visibility_timeout: Duration,
    pub retry_limit: u32,
    pub dead_letter_queue: Option<String>,
    pub priority: bool,
}

impl Default for QueueOptions {
    fn default() -> Self {
        Self {
            max_size: None,
            visibility_timeout: Duration::from_secs(30),
            retry_limit: 3,
            dead_letter_queue: None,
            priority: false,
        }
    }
}
```

### QueueError

```rust
pub enum QueueErrorCode {
    QueueFull,
    QueueNotFound,
    QueueAlreadyExists,
    ItemNotFound,
    ItemNotInFlight,
    InvalidOperation,
}
```

---

## MemoryQueue

Lightweight in-memory queue.

```rust
use links_queue::{MemoryQueue, Queue, Link, LinkRef};

let queue = MemoryQueue::<u64>::new("tasks");

// Enqueue
let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
let result = queue.enqueue(link).unwrap();
println!("Position: {}", result.position);

// Dequeue and process
if let Some(item) = queue.dequeue().unwrap() {
    // Process item
    queue.acknowledge(item.id).unwrap();
}

// Statistics
let stats = queue.get_stats();
println!("Depth: {}", stats.depth);
```

---

## QueueManager Trait

Interface for managing multiple queues.

```rust
pub trait QueueManager<T: LinkType>: Send + Sync {
    fn create_queue(&self, name: &str, options: QueueOptions) -> QueueResult<Arc<dyn Queue<T>>>;
    fn delete_queue(&self, name: &str) -> QueueResult<bool>;
    fn get_queue(&self, name: &str) -> QueueResult<Option<Arc<dyn Queue<T>>>>;
    fn list_queues(&self) -> QueueResult<Vec<QueueInfo>>;
}
```

### QueueInfo

```rust
pub struct QueueInfo {
    pub name: String,
    pub depth: usize,
    pub created_at: SystemTime,
    pub options: QueueOptions,
}
```

---

## MemoryQueueManager

```rust
use links_queue::{MemoryQueueManager, QueueManager, QueueOptions};

let manager = MemoryQueueManager::<u64>::new();

// Create queues
let tasks = manager.create_queue("tasks", QueueOptions::default()).await?;
let events = manager.create_queue("events", QueueOptions {
    max_size: Some(10000),
    ..Default::default()
}).await?;

// List queues
for info in manager.list_queues().await? {
    println!("{}: {} items", info.name, info.depth);
}

// Get existing queue
if let Some(queue) = manager.get_queue("tasks").await? {
    queue.enqueue(link)?;
}

// Delete queue
manager.delete_queue("events").await?;
```

---

## LinksQueueServer

TCP server for remote queue access.

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

### ServerConfig

| Method                | Description     | Default     |
| --------------------- | --------------- | ----------- |
| `.host(addr)`         | Bind address    | `"0.0.0.0"` |
| `.port(port)`         | Listen port     | `5000`      |
| `.max_connections(n)` | Max clients     | `1000`      |
| `.timeout(duration)`  | Request timeout | 30 seconds  |

### CLI Usage

```bash
# Start server with defaults
links-queue server

# Custom port
links-queue server --port 8080

# Custom host and max connections
links-queue server --host 127.0.0.1 --port 5000 --max-conn 500
```

---

## LinksQueueClient

TCP client for connecting to servers.

```rust
use links_queue::client::{LinksQueueClient, ClientConfig};

let config = ClientConfig::new("localhost:5000");
let client = LinksQueueClient::connect(config).await?;

// Create queue
client.create_queue("tasks", Default::default()).await?;

// Enqueue
let result = client.enqueue("tasks", link).await?;

// Dequeue
if let Some(item) = client.dequeue("tasks").await? {
    client.acknowledge("tasks", item.id).await?;
}

// Statistics
let stats = client.get_stats("tasks").await?;

// Disconnect
client.disconnect().await?;
```

### ClientConfig

| Method               | Description            | Default   |
| -------------------- | ---------------------- | --------- |
| `.reconnect(bool)`   | Auto-reconnect         | `true`    |
| `.max_retries(n)`    | Max reconnect attempts | `3`       |
| `.timeout(duration)` | Connection timeout     | 5 seconds |

---

## Storage Backends

### StorageBackend Trait

```rust
#[async_trait]
pub trait StorageBackend<T: LinkType>: Send + Sync {
    async fn save(&self, link: Link<T>) -> BackendResult<Link<T>>;
    async fn load(&self, id: T) -> BackendResult<Option<Link<T>>>;
    async fn delete(&self, id: T) -> BackendResult<bool>;
    async fn query(&self, pattern: &LinkPattern<T>) -> BackendResult<Vec<Link<T>>>;
    fn get_capabilities(&self) -> BackendCapabilities;
    fn get_stats(&self) -> BackendStats;
}
```

### MemoryBackend

```rust
use links_queue::MemoryBackend;

let backend = MemoryBackend::<u64>::new();
```

### LinkCliBackend

```rust
use links_queue::{LinkCliBackend, LinkCliConfig};

let config = LinkCliConfig::new("./data/queue.links")
    .with_timeout(Duration::from_secs(30))
    .with_auto_restart(true);

let backend = LinkCliBackend::new(config).await?;
```

### BackendRegistry

```rust
use links_queue::{BackendRegistry, BackendConfig};

let registry = BackendRegistry::new();

// Create memory backend
let memory = registry.create(&BackendConfig::memory())?;

// Create link-cli backend
let persistent = registry.create(&BackendConfig::link_cli("./data/queue.links"))?;
```

---

## Cluster Module

### ClusterBuilder

```rust
use links_queue::cluster::{ClusterBuilder, ClusterCoordinator};

let coordinator = ClusterBuilder::new()
    .node_id("node-1")
    .address("192.168.1.10")
    .port(5000)
    .seed("192.168.1.11:5000")
    .seed("192.168.1.12:5000")
    .replication_factor(2)
    .sync_replication(true)
    .build()?;

coordinator.start().await?;
coordinator.join(&["192.168.1.11:5000"]).await?;
```

### ClusterConfig

| Field         | Description                |
| ------------- | -------------------------- |
| `node_id`     | Unique node identifier     |
| `address`     | Advertise address          |
| `port`        | Cluster communication port |
| `seeds`       | Initial peer addresses     |
| `discovery`   | Discovery method           |
| `replication` | Replication configuration  |

---

## Error Types Summary

| Error Type     | Use Case                   |
| -------------- | -------------------------- |
| `LinkError<T>` | Link store operations      |
| `QueueError`   | Queue operations           |
| `BackendError` | Storage backend operations |
| `ServerError`  | Server operations          |
| `ClientError`  | Client operations          |
| `ClusterError` | Cluster operations         |

---

## Module Exports

```rust
// Core types
pub use links_queue::{
    Any, Link, LinkError, LinkPattern, LinkRef, LinkResult, LinkStore, LinkType, PatternField,
};

// Backends
pub use links_queue::{
    BackendCapabilities, BackendConfig, BackendError, BackendRegistry, BackendResult, BackendStats,
    DurabilityLevel, MemoryBackend, MemoryLinkStore, OperationStats, StorageBackend,
};

// link-cli backend
pub use links_queue::{
    LinkCliBackend, LinkCliConfig, LinkCliProcess, LinksNotation, ParsedLink, ProcessConfig,
};

// Queue
pub use links_queue::{
    EnqueueResult, MemoryQueue, MemoryQueueManager, MemoryQueueWithStorage, Queue, QueueError,
    QueueErrorCode, QueueInfo, QueueManager, QueueOptions, QueueResult, QueueStats,
};

// Server
pub use links_queue::{
    Connection, ConnectionId, LinksQueueServer, Request, Response, Router, ServerConfig,
    ServerError, ServerStats,
};

// Client
pub use links_queue::{
    ClientConfig, ClientConnection, ClientError, LinksQueueClient, Subscription,
};

// Cluster
pub use links_queue::{
    ClusterBuilder, ClusterConfig, ClusterCoordinator, ClusterError, ClusterNode, ClusterStats,
    DefaultClusterCoordinator, DiscoveryService, GossipProtocol, HashRing, LocalNode, Node,
    PartitionManager, ReplicationManager,
};
```

---

## See Also

- [Getting Started Guide](../../guides/getting-started.md)
- [Core Concepts](../../guides/core-concepts.md)
- [docs.rs Documentation](https://docs.rs/links-queue) (when published)
