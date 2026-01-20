# Clustering

This guide covers setting up and managing a multi-node Links Queue cluster for distributed queue operations.

## Overview

Links Queue supports multi-node clustering for:

- **Horizontal scaling**: Distribute load across multiple nodes
- **High availability**: Survive node failures
- **Data locality**: Process data close to where it's stored

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Multi-Node Cluster                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────┐      ┌───────────────────┐                   │
│  │      Node 1       │      │      Node 2       │                   │
│  │  ┌─────────────┐  │      │  ┌─────────────┐  │                   │
│  │  │   Queues    │  │◄────►│  │   Queues    │  │                   │
│  │  │ Partitions  │  │Gossip│  │ Partitions  │  │                   │
│  │  │   1, 4, 7   │  │      │  │   2, 5, 8   │  │                   │
│  │  └─────────────┘  │      │  └─────────────┘  │                   │
│  └───────────────────┘      └───────────────────┘                   │
│           ▲                          ▲                               │
│           │                          │                               │
│           └──────────┬───────────────┘                               │
│                      ▼                                               │
│             ┌───────────────────┐                                    │
│             │      Node 3       │                                    │
│             │  ┌─────────────┐  │                                    │
│             │  │   Queues    │  │                                    │
│             │  │ Partitions  │  │                                    │
│             │  │   3, 6, 9   │  │                                    │
│             │  └─────────────┘  │                                    │
│             └───────────────────┘                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Setting Up a Cluster

### JavaScript

```javascript
import { createClusterCoordinator, LinksQueueManager } from "links-queue-js";

// Create a cluster coordinator for this node
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  advertiseAddress: "192.168.1.10",
  advertisePort: 5000,
  nodes: ["192.168.1.11:5000", "192.168.1.12:5000"],
  discovery: "static",
  healthCheckInterval: 5000,
  healthCheckTimeout: 1000,
});

// Join the cluster
await coordinator.join(["192.168.1.11:5000"]);

// Create queue manager with cluster support
const manager = new LinksQueueManager({
  cluster: coordinator,
});

// Operations are now distributed
const queue = await manager.createQueue("tasks");
```

### Rust

```rust
use links_queue::cluster::{ClusterBuilder, ClusterCoordinator};

// Build cluster coordinator
let coordinator = ClusterBuilder::new()
    .node_id("node-1")
    .address("192.168.1.10")
    .port(5000)
    .seed("192.168.1.11:5000")
    .seed("192.168.1.12:5000")
    .health_check_interval(Duration::from_secs(5))
    .build()?;

// Start and join the cluster
coordinator.start().await?;
coordinator.join(&["192.168.1.11:5000"]).await?;

// Create queue manager with cluster
let manager = QueueManager::with_cluster(coordinator);
```

## Node Discovery

### Static Discovery

Manually specify all node addresses:

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  advertiseAddress: "192.168.1.10",
  advertisePort: 5000,
  discovery: "static",
  nodes: ["192.168.1.11:5000", "192.168.1.12:5000", "192.168.1.13:5000"],
});
```

### DNS-Based Discovery (Planned)

Use DNS records for node discovery:

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  advertiseAddress: "192.168.1.10",
  advertisePort: 5000,
  discovery: "dns",
  dnsHostname: "links-queue.internal",
});
```

## Cluster Configuration

| Option                | Description                                | Default  |
| --------------------- | ------------------------------------------ | -------- |
| `nodeId`              | Unique identifier for this node            | Required |
| `advertiseAddress`    | Address other nodes use to reach this node | Required |
| `advertisePort`       | Port for cluster communication             | `5000`   |
| `nodes`               | Initial list of peer addresses             | `[]`     |
| `discovery`           | Discovery method (`static`, `dns`)         | `static` |
| `healthCheckInterval` | Time between health checks (ms)            | `5000`   |
| `healthCheckTimeout`  | Health check timeout (ms)                  | `1000`   |
| `suspectThreshold`    | Failed checks before marking suspect       | `3`      |
| `deadThreshold`       | Failed checks before marking dead          | `5`      |

## Node States

Nodes can be in the following states:

| State     | Description                       |
| --------- | --------------------------------- |
| `joining` | Node is connecting to the cluster |
| `healthy` | Node is operating normally        |
| `suspect` | Node has missed health checks     |
| `dead`    | Node is considered failed         |
| `leaving` | Node is gracefully departing      |

```javascript
coordinator.on("node-joined", (node) => {
  console.log(`Node joined: ${node.id} (${node.address}:${node.port})`);
});

coordinator.on("node-suspect", (node) => {
  console.log(`Node suspected: ${node.id}`);
});

coordinator.on("node-left", (node) => {
  console.log(`Node left: ${node.id}`);
});
```

## Partitioning

Queue data is partitioned across nodes using consistent hashing.

### How Partitioning Works

1. Each queue item gets a partition key (based on queue name + item ID)
2. The partition key is hashed to determine the owning partition
3. Partitions are assigned to nodes using a hash ring
4. Virtual nodes (vnodes) ensure even distribution

```javascript
// Find which node owns a partition
const owner = coordinator.getPartitionOwner("queue:tasks:item:123");
console.log(`Partition owner: ${owner.id}`);

// Get all partitions owned by this node
const localPartitions = coordinator.getLocalPartitions();
console.log(`This node owns ${localPartitions.length} partitions`);
```

### Partition Configuration

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  // ...
  partitions: {
    count: 256, // Total number of partitions
    virtualNodes: 128, // Virtual nodes per physical node
  },
});
```

## Replication

For durability, data can be replicated across multiple nodes.

### Replication Configuration

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  // ...
  replication: {
    factor: 2, // Number of copies to maintain
    sync: true, // Wait for replicas before acknowledging
  },
});
```

### Replication Modes

| Mode    | Description                                      | Use Case            |
| ------- | ------------------------------------------------ | ------------------- |
| `async` | Acknowledge immediately, replicate in background | Higher throughput   |
| `sync`  | Wait for replication before acknowledging        | Stronger durability |

```javascript
// Async replication (default)
const coordinator = createClusterCoordinator({
  replication: { factor: 2, sync: false },
});

// Sync replication
const coordinator = createClusterCoordinator({
  replication: { factor: 2, sync: true },
});
```

## Leader Election

The cluster elects a leader for coordination tasks:

```javascript
coordinator.on("leader-changed", (leader) => {
  console.log(`New leader: ${leader.id}`);

  if (coordinator.isLeader()) {
    console.log("This node is now the leader");
  }
});
```

The leader is responsible for:

- Partition assignment
- Triggering rebalance operations
- Coordinating cluster-wide tasks

## Rebalancing

When nodes join or leave, partitions are redistributed:

```javascript
coordinator.on("rebalance-started", () => {
  console.log("Partition rebalance starting...");
});

coordinator.on("rebalance-completed", () => {
  console.log("Partition rebalance completed");
});
```

### Manual Rebalance

```javascript
// Trigger a manual rebalance
await coordinator.rebalance();
```

## Gossip Protocol

Nodes communicate using a gossip protocol for:

- Membership dissemination
- Health status propagation
- Partition map synchronization

### Gossip Configuration

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  // ...
  gossip: {
    interval: 1000, // Gossip every 1 second
    fanout: 3, // Push to 3 random peers per round
  },
});
```

## Cluster Events

| Event                 | Description                       | Payload       |
| --------------------- | --------------------------------- | ------------- |
| `node-joined`         | A node joined the cluster         | `ClusterNode` |
| `node-left`           | A node left the cluster           | `ClusterNode` |
| `node-suspect`        | A node is suspected to be failing | `ClusterNode` |
| `leader-changed`      | Leadership has changed            | `ClusterNode` |
| `rebalance-started`   | Partition rebalance started       | None          |
| `rebalance-completed` | Partition rebalance completed     | None          |

```javascript
// Listen for all events
coordinator.on("node-joined", handleNodeJoined);
coordinator.on("node-left", handleNodeLeft);
coordinator.on("node-suspect", handleNodeSuspect);
coordinator.on("leader-changed", handleLeaderChange);
coordinator.on("rebalance-started", handleRebalanceStart);
coordinator.on("rebalance-completed", handleRebalanceComplete);
```

## Cluster Statistics

```javascript
const stats = coordinator.getStats();

console.log(`Total nodes: ${stats.totalNodes}`);
console.log(`Healthy nodes: ${stats.healthyNodes}`);
console.log(`Leader: ${stats.leader?.id || "none"}`);
console.log(`Local partitions: ${stats.localPartitions}`);
console.log(`Replication lag: ${stats.replicationLag}ms`);
```

## Graceful Shutdown

When shutting down a node:

```javascript
// Leave the cluster gracefully
await coordinator.leave();

// This will:
// 1. Stop accepting new requests
// 2. Transfer partitions to other nodes
// 3. Wait for in-flight operations
// 4. Disconnect from peers
```

## Failure Handling

### Node Failure

When a node fails:

1. Health checks detect the failure
2. Node is marked as suspect, then dead
3. Partitions are reassigned to healthy nodes
4. Replication ensures data availability

### Split Brain Prevention

The cluster uses quorum-based decisions:

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  // ...
  quorum: {
    minNodes: 2, // Minimum nodes for operation
  },
});
```

## Example: Three-Node Cluster

### Node 1 (Leader)

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-1",
  advertiseAddress: "192.168.1.10",
  advertisePort: 5000,
  nodes: ["192.168.1.11:5000", "192.168.1.12:5000"],
  replication: { factor: 2, sync: true },
});

await coordinator.start();
```

### Node 2

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-2",
  advertiseAddress: "192.168.1.11",
  advertisePort: 5000,
  nodes: ["192.168.1.10:5000", "192.168.1.12:5000"],
  replication: { factor: 2, sync: true },
});

await coordinator.start();
await coordinator.join(["192.168.1.10:5000"]);
```

### Node 3

```javascript
const coordinator = createClusterCoordinator({
  nodeId: "node-3",
  advertiseAddress: "192.168.1.12",
  advertisePort: 5000,
  nodes: ["192.168.1.10:5000", "192.168.1.11:5000"],
  replication: { factor: 2, sync: true },
});

await coordinator.start();
await coordinator.join(["192.168.1.10:5000"]);
```

## Monitoring

### Health Endpoint

Each node exposes health status:

```javascript
// Check local node health
const health = coordinator.getHealth();
console.log(`Status: ${health.status}`); // healthy, degraded, unhealthy
console.log(`Peers: ${health.connectedPeers}`);
```

### Metrics

| Metric                          | Description                     |
| ------------------------------- | ------------------------------- |
| `cluster_nodes_total`           | Total nodes in cluster          |
| `cluster_nodes_healthy`         | Healthy nodes count             |
| `cluster_partitions_local`      | Partitions owned by this node   |
| `cluster_replication_lag_ms`    | Replication lag in milliseconds |
| `cluster_gossip_messages_total` | Total gossip messages sent      |

## Next Steps

- [Best Practices](best-practices.md) - Production deployment tips
- [Operating Modes](operating-modes.md) - Understand single vs multi-node
- [Server Mode](server-mode.md) - TCP server configuration
