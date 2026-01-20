# Operating Modes

Links Queue supports four operating modes that scale from simple to complex by configuration alone. The same code works across all modes—only the configuration changes.

## Mode Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Scaling Through Configuration                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Single Node                                                         │
│  ├── single-memory     Fastest, no persistence                      │
│  └── single-stored     Persisted to local storage                   │
│                                                                      │
│  Multiple Nodes                                                      │
│  ├── multi-memory      Distributed, no persistence                  │
│  └── multi-stored      Distributed with persistence                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Single Node - In-Memory (single-memory)

The simplest and fastest mode. Data is stored only in memory and lost on restart.

### Characteristics

- **Latency**: Sub-millisecond (< 1ms)
- **Persistence**: None (data lost on restart)
- **Scaling**: Single process only
- **Best for**: Development, testing, ephemeral workloads

### JavaScript

```javascript
import { MemoryLinkStore, MemoryQueueManager } from "links-queue-js";

const store = new MemoryLinkStore();
const manager = new MemoryQueueManager({ store });

const queue = await manager.createQueue("tasks");
```

### Rust

```rust
use links_queue::{MemoryQueueManager, QueueManager};

let manager = MemoryQueueManager::new();
let queue = manager.create_queue("tasks", Default::default()).await?;
```

### When to Use

- Local development and testing
- Caching and temporary data
- High-throughput scenarios where data loss is acceptable
- Prototyping and experimentation

## Single Node - Stored (single-stored)

Persistent storage using the link-cli backend. Data survives restarts.

### Characteristics

- **Latency**: Low (1-10ms depending on storage)
- **Persistence**: Full durability via SQLite
- **Scaling**: Single process
- **Best for**: Production single-node deployments

### JavaScript

```javascript
import { LinkCliBackend, LinksQueueManager } from "links-queue-js";

const backend = new LinkCliBackend({
  path: "./data/queue.links",
});
await backend.connect();

const manager = new LinksQueueManager({ backend });
const queue = await manager.createQueue("tasks");
```

### Rust

```rust
use links_queue::{LinkCliBackend, QueueManager, BackendConfig};

let config = BackendConfig::link_cli("./data/queue.links");
let backend = LinkCliBackend::new(config).await?;

let manager = QueueManager::with_backend(backend);
let queue = manager.create_queue("tasks", Default::default()).await?;
```

### When to Use

- Production workloads requiring durability
- Applications that must survive restarts
- When data loss is unacceptable
- Single-server deployments

## Multiple Nodes - Memory Only (multi-memory)

Distributed queue across multiple nodes, but without persistence.

### Characteristics

- **Latency**: Low (network overhead added)
- **Persistence**: None (cluster-wide data loss on full restart)
- **Scaling**: Horizontal across nodes
- **Best for**: High-throughput ephemeral workloads

### Architecture

```
┌───────────────────┐  Links   ┌───────────────────┐
│      Node 1       │ Notation │      Node 2       │
│  ┌─────────────┐  │◄────────►│  ┌─────────────┐  │
│  │links-queue  │  │          │  │links-queue  │  │
│  │  ┌───────┐  │  │          │  │  ┌───────┐  │  │
│  │  │Memory │  │  │          │  │  │Memory │  │  │
│  │  └───────┘  │  │          │  │  └───────┘  │  │
│  └─────────────┘  │          │  └─────────────┘  │
└───────────────────┘          └───────────────────┘
```

### JavaScript

```javascript
import { LinksQueueManager, MemoryLinkStore } from "links-queue-js";
import { createClusterCoordinator } from "links-queue-js";

const store = new MemoryLinkStore();
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  advertiseAddress: "192.168.1.10",
  advertisePort: 5000,
  nodes: ["192.168.1.11:5000", "192.168.1.12:5000"],
  discovery: "static",
});

await coordinator.join(["192.168.1.11:5000"]);

const manager = new LinksQueueManager({
  store,
  cluster: coordinator,
});
```

### When to Use

- Distributed computing with temporary data
- Cache layers across multiple servers
- Stateless microservices needing shared queues
- Development and testing of distributed systems

## Multiple Nodes - Stored (multi-stored)

Full distributed queue with persistence on each node.

### Characteristics

- **Latency**: Medium (storage + network)
- **Persistence**: Full durability with replication
- **Scaling**: Horizontal with fault tolerance
- **Best for**: Production distributed systems

### Architecture

```
┌───────────────────┐  Links   ┌───────────────────┐
│      Node 1       │ Notation │      Node 2       │
│  ┌─────────────┐  │◄────────►│  ┌─────────────┐  │
│  │links-queue  │  │          │  │links-queue  │  │
│  │  ┌───────┐  │  │          │  │  ┌───────┐  │  │
│  │  │link-  │  │  │          │  │  │link-  │  │  │
│  │  │cli    │  │  │          │  │  │cli    │  │  │
│  │  └───┬───┘  │  │          │  │  └───┬───┘  │  │
│  └──────│──────┘  │          │  └──────│──────┘  │
└─────────│─────────┘          └─────────│─────────┘
          ▼                              ▼
    ┌──────────┐                   ┌──────────┐
    │db1.links │                   │db2.links │
    └──────────┘                   └──────────┘
```

### JavaScript

```javascript
import { LinksQueueManager, LinkCliBackend } from "links-queue-js";
import { createClusterCoordinator } from "links-queue-js";

const backend = new LinkCliBackend({
  path: "./data/queue.links",
});
await backend.connect();

const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  advertiseAddress: "192.168.1.10",
  advertisePort: 5000,
  nodes: ["192.168.1.11:5000", "192.168.1.12:5000"],
  discovery: "static",
  replication: {
    factor: 2,
    sync: true,
  },
});

await coordinator.join(["192.168.1.11:5000"]);

const manager = new LinksQueueManager({
  backend,
  cluster: coordinator,
});
```

### Replication Configuration

| Setting  | Description                                             |
| -------- | ------------------------------------------------------- |
| `factor` | Number of copies to maintain (default: 1)               |
| `sync`   | Wait for replicas before acknowledging (default: false) |

### When to Use

- Production distributed systems
- High availability requirements
- Data that must survive node failures
- Mission-critical workloads

## Choosing the Right Mode

### Decision Tree

```
Do you need data to survive restarts?
├── No → Do you need multiple nodes?
│        ├── No → single-memory
│        └── Yes → multi-memory
└── Yes → Do you need multiple nodes?
         ├── No → single-stored
         └── Yes → multi-stored
```

### Mode Comparison

| Mode          | Latency | Durability | Scaling    | Complexity |
| ------------- | ------- | ---------- | ---------- | ---------- |
| single-memory | Lowest  | None       | Single     | Lowest     |
| single-stored | Low     | Full       | Single     | Low        |
| multi-memory  | Medium  | None       | Horizontal | Medium     |
| multi-stored  | Higher  | Full       | Horizontal | Highest    |

## Configuration Examples

### Single-Memory Configuration

```json
{
  "mode": "single-memory",
  "backend": {
    "type": "memory"
  }
}
```

### Single-Stored Configuration

```json
{
  "mode": "single-stored",
  "backend": {
    "type": "link-cli",
    "path": "./data/db.links"
  }
}
```

### Multi-Memory Configuration

```json
{
  "mode": "multi-memory",
  "backend": {
    "type": "memory"
  },
  "cluster": {
    "nodes": ["node1:5000", "node2:5000", "node3:5000"],
    "discovery": "static"
  }
}
```

### Multi-Stored Configuration

```json
{
  "mode": "multi-stored",
  "backend": {
    "type": "link-cli",
    "path": "./data/db.links"
  },
  "cluster": {
    "nodes": ["node1:5000", "node2:5000"],
    "discovery": "static",
    "replication": {
      "factor": 2,
      "sync": true
    }
  }
}
```

## Migrating Between Modes

### From single-memory to single-stored

1. Stop the application
2. Change backend configuration
3. Restart—existing data will be lost

### From single-stored to multi-stored

1. Set up additional nodes with link-cli backends
2. Configure cluster settings
3. Join nodes to the cluster
4. Data will be redistributed automatically

## Next Steps

- [Storage Backends](storage-backends.md) - Deep dive into backend options
- [Clustering](clustering.md) - Detailed cluster configuration
- [Best Practices](best-practices.md) - Production deployment tips
