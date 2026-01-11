# Links Queue Architecture

This document describes the architectural design of Links Queue, covering all operating modes, deployment patterns, and extensibility mechanisms.

## Table of Contents

- [System Overview](#system-overview)
- [Core Components](#core-components)
- [Data Model](#data-model)
- [Operating Modes](#operating-modes)
- [Storage Architecture](#storage-architecture)
- [Communication Protocol](#communication-protocol)
- [Deployment Patterns](#deployment-patterns)
- [Extensibility](#extensibility)
- [Security Considerations](#security-considerations)

## System Overview

Links Queue is a universal queue system built around the concept of **links**—the fundamental unit of information representation. The architecture supports seamless scaling from embedded single-process usage to distributed multi-node clusters.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Links Queue System                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    │
│   │   Application   │    │   Application   │    │   Application   │    │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘    │
│            │                      │                      │              │
│            ▼                      ▼                      ▼              │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                        Links Queue API                           │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │  │
│   │  │  Queue   │  │  Link    │  │ Consumer │  │  Management  │   │  │
│   │  │   Ops    │  │   Ops    │  │   Ops    │  │     Ops      │   │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                                    ▼                                    │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                        Core Engine                               │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │  │
│   │  │  Queue   │  │  Link    │  │ Delivery │  │   Cluster    │   │  │
│   │  │ Manager  │  │  Store   │  │  Engine  │  │  Coordinator │   │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                                    ▼                                    │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                     Storage Backend Layer                        │  │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │  │
│   │  │  Memory  │  │ link-cli │  │  Redis   │  │    Custom    │   │  │
│   │  │ Backend  │  │ Backend  │  │ Backend  │  │   Backend    │   │  │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Queue Manager

Manages queue lifecycle and operations.

```
┌─────────────────────────────────────────────────┐
│                 Queue Manager                    │
├─────────────────────────────────────────────────┤
│                                                  │
│  Responsibilities:                               │
│  • Create/delete queues                         │
│  • Route messages to correct queues             │
│  • Manage queue metadata                        │
│  • Enforce queue policies (TTL, max size)       │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │           Queue Registry                 │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐  │   │
│  │  │ Queue A │ │ Queue B │ │ Queue C │  │   │
│  │  └─────────┘ └─────────┘ └─────────┘  │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Key Interfaces:**
```typescript
interface QueueManager {
  createQueue(name: string, options: QueueOptions): Queue;
  deleteQueue(name: string): void;
  getQueue(name: string): Queue | null;
  listQueues(): QueueInfo[];
}

interface Queue {
  enqueue(link: Link): EnqueueResult;
  dequeue(): Link | null;
  peek(): Link | null;
  acknowledge(id: LinkId): void;
  reject(id: LinkId, requeue: boolean): void;
  getStats(): QueueStats;
}
```

### 2. Link Store

Manages the storage and retrieval of links.

```
┌─────────────────────────────────────────────────┐
│                   Link Store                     │
├─────────────────────────────────────────────────┤
│                                                  │
│  Responsibilities:                               │
│  • Store links with unique identifiers          │
│  • Resolve link references                      │
│  • Deduplicate identical link structures        │
│  • Pattern-based link queries                   │
│                                                  │
│  Link Structure:                                 │
│  ┌───────────────────────────────────────┐     │
│  │  Link {                                │     │
│  │    id: LinkId,                         │     │
│  │    source: LinkId | Value,             │     │
│  │    target: LinkId | Value              │     │
│  │  }                                     │     │
│  └───────────────────────────────────────┘     │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Key Interfaces:**
```typescript
interface LinkStore {
  create(source: LinkRef, target: LinkRef): Link;
  get(id: LinkId): Link | null;
  find(pattern: LinkPattern): Link[];
  delete(id: LinkId): boolean;
  exists(id: LinkId): boolean;
}
```

### 3. Delivery Engine

Handles message delivery to consumers with reliability guarantees.

```
┌─────────────────────────────────────────────────┐
│                Delivery Engine                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │           Consumer Registry               │  │
│  │  ┌──────────┐  ┌──────────┐              │  │
│  │  │Consumer 1│  │Consumer 2│  ...         │  │
│  │  └──────────┘  └──────────┘              │  │
│  └──────────────────────────────────────────┘  │
│                      │                          │
│                      ▼                          │
│  ┌──────────────────────────────────────────┐  │
│  │           Delivery Tracker                │  │
│  │  • In-flight messages                    │  │
│  │  • Acknowledgment tracking               │  │
│  │  • Timeout management                    │  │
│  │  • Retry scheduling                      │  │
│  └──────────────────────────────────────────┘  │
│                      │                          │
│                      ▼                          │
│  ┌──────────────────────────────────────────┐  │
│  │           Dead Letter Handler             │  │
│  │  • Failed message routing                │  │
│  │  • Retry exhaustion handling             │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 4. Cluster Coordinator

Manages distributed operation in multi-node mode.

```
┌─────────────────────────────────────────────────┐
│             Cluster Coordinator                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │           Node Discovery                  │  │
│  │  • Peer registration                     │  │
│  │  • Health monitoring                     │  │
│  │  • Failure detection                     │  │
│  └──────────────────────────────────────────┘  │
│                      │                          │
│                      ▼                          │
│  ┌──────────────────────────────────────────┐  │
│  │           Partition Manager               │  │
│  │  • Queue partitioning                    │  │
│  │  • Load balancing                        │  │
│  │  • Rebalancing on topology change        │  │
│  └──────────────────────────────────────────┘  │
│                      │                          │
│                      ▼                          │
│  ┌──────────────────────────────────────────┐  │
│  │           Replication Manager             │  │
│  │  • Data synchronization                  │  │
│  │  • Consistency enforcement               │  │
│  │  • Conflict resolution                   │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
└─────────────────────────────────────────────────┘
```

## Data Model

### Link Representation

The fundamental data structure is a **link**—an ordered pair with source and target.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Link Data Model                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Basic Link:                                                         │
│  ┌─────────────────────────────────────┐                            │
│  │  (source, target)                    │                            │
│  │  Example: (1, 2)                     │                            │
│  └─────────────────────────────────────┘                            │
│                                                                      │
│  Named Link (self-referencing):                                      │
│  ┌─────────────────────────────────────┐                            │
│  │  (name: name)                        │                            │
│  │  Index 5: source=5, target=5         │                            │
│  └─────────────────────────────────────┘                            │
│                                                                      │
│  Nested Link:                                                        │
│  ┌─────────────────────────────────────┐                            │
│  │  ((1, 2), (3, 4))                    │                            │
│  │  A link whose source and target      │                            │
│  │  are themselves links                │                            │
│  └─────────────────────────────────────┘                            │
│                                                                      │
│  Queue Item as Link:                                                 │
│  ┌─────────────────────────────────────┐                            │
│  │  ((queue: "tasks"),                  │                            │
│  │   ((payload: ...),                   │                            │
│  │    (metadata: ((priority: 1),        │                            │
│  │                (timestamp: ...)))))  │                            │
│  └─────────────────────────────────────┘                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Queue Item Structure

Every queue item is represented as a link with standardized metadata:

```
Queue Item Link Structure:
┌─────────────────────────────────────────────────────────────────────┐
│  ((queue: "<queue-name>"),                                          │
│   ((id: "<unique-id>"),                                             │
│    ((payload: <user-data>),                                         │
│     ((metadata:                                                      │
│       ((created_at: <timestamp>),                                   │
│        ((priority: <0-9>),                                          │
│         ((attempts: <count>),                                       │
│          ((visibility_timeout: <timestamp>),                        │
│           (dead_letter_after: <count>)))))))))                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Operating Modes

### Mode 1: Single Node - In-Memory

```
┌─────────────────────────────────────────────────┐
│          Single Node In-Memory Mode              │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │              Application                  │  │
│  │                   │                       │  │
│  │                   ▼                       │  │
│  │  ┌────────────────────────────────────┐  │  │
│  │  │          links-queue               │  │  │
│  │  │  ┌──────────────────────────────┐  │  │  │
│  │  │  │      Memory Backend          │  │  │  │
│  │  │  │  ┌────────────────────────┐  │  │  │  │
│  │  │  │  │   HashMap<LinkId,Link> │  │  │  │  │
│  │  │  │  └────────────────────────┘  │  │  │  │
│  │  │  └──────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  Characteristics:                                │
│  • Lowest latency (< 1ms)                       │
│  • No persistence (data lost on restart)        │
│  • Single process only                          │
│  • Ideal for testing and development            │
│                                                  │
└─────────────────────────────────────────────────┘
```

Configuration:
```json
{
  "mode": "single-memory",
  "backend": {
    "type": "memory"
  }
}
```

### Mode 2: Single Node - Stored (link-cli)

```
┌─────────────────────────────────────────────────┐
│        Single Node Stored Mode (link-cli)        │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │              Application                  │  │
│  │                   │                       │  │
│  │                   ▼                       │  │
│  │  ┌────────────────────────────────────┐  │  │
│  │  │          links-queue               │  │  │
│  │  │  ┌──────────────────────────────┐  │  │  │
│  │  │  │      link-cli Backend        │  │  │  │
│  │  │  └──────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────┘  │
│                       │                          │
│                       ▼                          │
│  ┌──────────────────────────────────────────┐  │
│  │              link-cli                     │  │
│  │  ┌────────────────────────────────────┐  │  │
│  │  │           db.links                  │  │  │
│  │  │        (SQLite file)                │  │  │
│  │  └────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  Characteristics:                                │
│  • Durable storage                              │
│  • Survives restarts                            │
│  • Higher latency than in-memory                │
│  • Ideal for production single-node             │
│                                                  │
└─────────────────────────────────────────────────┘
```

Configuration:
```json
{
  "mode": "single-stored",
  "backend": {
    "type": "link-cli",
    "path": "./data/db.links"
  }
}
```

### Mode 3: Multiple Nodes - Memory Only

```
┌─────────────────────────────────────────────────────────────────────┐
│                Multi-Node Memory Only Mode                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────┐  Links   ┌───────────────────┐              │
│  │      Node 1       │ Notation │      Node 2       │              │
│  │  ┌─────────────┐  │◄────────►│  ┌─────────────┐  │              │
│  │  │links-queue  │  │          │  │links-queue  │  │              │
│  │  │  ┌───────┐  │  │          │  │  ┌───────┐  │  │              │
│  │  │  │Memory │  │  │          │  │  │Memory │  │  │              │
│  │  │  └───────┘  │  │          │  │  └───────┘  │  │              │
│  │  └─────────────┘  │          │  └─────────────┘  │              │
│  └───────────────────┘          └───────────────────┘              │
│           ▲                              ▲                          │
│           │          Links               │                          │
│           │         Notation             │                          │
│           └──────────────┬───────────────┘                          │
│                          ▼                                          │
│                 ┌───────────────────┐                               │
│                 │      Node 3       │                               │
│                 │  ┌─────────────┐  │                               │
│                 │  │links-queue  │  │                               │
│                 │  │  ┌───────┐  │  │                               │
│                 │  │  │Memory │  │  │                               │
│                 │  │  └───────┘  │  │                               │
│                 │  └─────────────┘  │                               │
│                 └───────────────────┘                               │
│                                                                      │
│  Characteristics:                                                    │
│  • Distributed processing                                           │
│  • No persistence (cluster-wide data loss on full restart)          │
│  • Horizontal scaling                                               │
│  • Ideal for ephemeral workloads                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

Configuration:
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

### Mode 4: Multiple Nodes - Stored

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Multi-Node Stored Mode                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────┐  Links   ┌───────────────────┐              │
│  │      Node 1       │ Notation │      Node 2       │              │
│  │  ┌─────────────┐  │◄────────►│  ┌─────────────┐  │              │
│  │  │links-queue  │  │          │  │links-queue  │  │              │
│  │  │  ┌───────┐  │  │          │  │  ┌───────┐  │  │              │
│  │  │  │link-  │  │  │          │  │  │link-  │  │  │              │
│  │  │  │cli    │  │  │          │  │  │cli    │  │  │              │
│  │  │  └───┬───┘  │  │          │  │  └───┬───┘  │  │              │
│  │  └──────│──────┘  │          │  └──────│──────┘  │              │
│  └─────────│─────────┘          └─────────│─────────┘              │
│            ▼                              ▼                          │
│      ┌──────────┐                   ┌──────────┐                    │
│      │db1.links │                   │db2.links │                    │
│      └──────────┘                   └──────────┘                    │
│                                                                      │
│  Characteristics:                                                    │
│  • Full durability                                                  │
│  • Survives node failures                                           │
│  • Horizontal scaling with persistence                              │
│  • Ideal for production distributed systems                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

Configuration:
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

## Storage Architecture

### Backend Interface

All storage backends implement a common interface:

```typescript
interface StorageBackend {
  // Core operations
  save(link: Link): Promise<LinkId>;
  load(id: LinkId): Promise<Link | null>;
  delete(id: LinkId): Promise<boolean>;
  query(pattern: LinkPattern): Promise<Link[]>;

  // Batch operations
  saveBatch(links: Link[]): Promise<LinkId[]>;
  deleteBatch(ids: LinkId[]): Promise<boolean[]>;

  // Metadata
  getCapabilities(): BackendCapabilities;
  getStats(): BackendStats;
}

interface BackendCapabilities {
  supportsTransactions: boolean;
  supportsBatchOperations: boolean;
  durabilityLevel: 'none' | 'fsync' | 'replicated';
  maxLinkSize: number;
}
```

### Backend Implementations

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
│  │  Redis Backend  │  (Future) Redis-backed storage                 │
│  │                 │  • Sub-millisecond access                      │
│  │                 │  • Optional persistence                        │
│  │                 │  • Cluster support                             │
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

## Communication Protocol

### Links Notation (Text)

The text-based protocol for inter-node communication:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Links Notation Protocol                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Message Format:                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ((type: "enqueue"),                                         │   │
│  │   ((queue: "tasks"),                                         │   │
│  │    ((payload: ((action: "process"), (data: "...")))))       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Request Types:                                                      │
│  • enqueue    - Add item to queue                                   │
│  • dequeue    - Remove item from queue                              │
│  • ack        - Acknowledge processing                              │
│  • reject     - Reject and optionally requeue                       │
│  • query      - Query queue status                                  │
│  • sync       - Synchronization between nodes                       │
│                                                                      │
│  Response Format:                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ((status: "ok"),                                            │   │
│  │   ((result: ((id: "abc123"), (position: 42)))))             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Binary Links Notation (Future)

Requirements for the binary protocol:

```
┌─────────────────────────────────────────────────────────────────────┐
│                   Binary Links Notation (Future)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Wire Format:                                                        │
│  ┌────────┬────────┬────────┬─────────────────────────────────┐   │
│  │ Magic  │Version │ Length │           Payload                │   │
│  │ 4 bytes│ 2 bytes│ 4 bytes│         Variable                 │   │
│  └────────┴────────┴────────┴─────────────────────────────────┘   │
│                                                                      │
│  Link Encoding:                                                      │
│  ┌────────┬────────────┬────────────┐                              │
│  │  Type  │   Source   │   Target   │                              │
│  │ 1 byte │  Variable  │  Variable  │                              │
│  └────────┴────────────┴────────────┘                              │
│                                                                      │
│  Type Flags:                                                         │
│  • 0x01 - Source is link ID (vs literal)                            │
│  • 0x02 - Target is link ID (vs literal)                            │
│  • 0x04 - Self-referencing (named link)                             │
│  • 0x08 - Has additional metadata                                   │
│                                                                      │
│  Goals:                                                              │
│  • 5-10x smaller than text notation                                 │
│  • Zero-copy parsing where possible                                 │
│  • Backward compatible with text notation                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Deployment Patterns

### Embedded Library

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Embedded Deployment                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  // JavaScript                                                       │
│  import { LinksQueue } from 'links-queue';                          │
│                                                                      │
│  const queue = new LinksQueue({ mode: 'single-memory' });           │
│  await queue.enqueue({ source: 'task', target: 'process' });        │
│  const item = await queue.dequeue();                                │
│                                                                      │
│  // Rust                                                             │
│  use links_queue::LinksQueue;                                       │
│                                                                      │
│  let queue = LinksQueue::new(Config::single_memory());              │
│  queue.enqueue(Link::new("task", "process")).await?;                │
│  let item = queue.dequeue().await?;                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Standalone Server

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Server Deployment                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  # Start server                                                      │
│  links-queue server --config config.json                            │
│                                                                      │
│  # Client connection                                                 │
│  import { LinksQueueClient } from 'links-queue/client';             │
│                                                                      │
│  const client = new LinksQueueClient('tcp://localhost:5000');       │
│  await client.connect();                                            │
│  await client.enqueue('tasks', { source: 'job', target: 'run' });   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Extensibility

### Custom Storage Backend

```typescript
// Implement the StorageBackend interface
class MyCustomBackend implements StorageBackend {
  async save(link: Link): Promise<LinkId> {
    // Custom storage logic
  }

  async load(id: LinkId): Promise<Link | null> {
    // Custom retrieval logic
  }

  // ... other methods
}

// Register the backend
LinksQueue.registerBackend('my-custom', MyCustomBackend);

// Use in configuration
const queue = new LinksQueue({
  mode: 'single-stored',
  backend: { type: 'my-custom', options: { /* ... */ } }
});
```

### Custom Serialization

```typescript
// Register custom serializer
LinksQueue.registerSerializer('my-format', {
  serialize(link: Link): Buffer { /* ... */ },
  deserialize(data: Buffer): Link { /* ... */ }
});
```

## Security Considerations

### Authentication

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Security Architecture                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Authentication Options:                                             │
│  • None (development/internal only)                                 │
│  • Token-based (API keys)                                           │
│  • TLS client certificates (production)                             │
│                                                                      │
│  Authorization:                                                      │
│  • Queue-level permissions (read/write/admin)                       │
│  • Pattern-based access control                                     │
│                                                                      │
│  Transport Security:                                                 │
│  • TLS encryption for all network communication                     │
│  • Optional mTLS for node-to-node                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

*This architecture document will evolve as the implementation progresses. Changes should maintain backward compatibility with existing deployments.*
