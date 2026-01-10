# Message Broker Comparison: Links Queue vs Existing Solutions

This document provides a comprehensive comparison between Links Queue (JavaScript and Rust implementations) and established message brokers: RabbitMQ, Celery, Redis + BullMQ, and Apache Kafka.

> **Note**: For detailed planning documents, see:
> - [VISION.md](VISION.md) - Project vision and goals
> - [REQUIREMENTS.md](REQUIREMENTS.md) - Detailed requirements specification
> - [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture design
> - [ROADMAP.md](ROADMAP.md) - Development phases and milestones

## Table of Contents

- [Overview](#overview)
- [Quick Comparison Matrix](#quick-comparison-matrix)
- [Detailed Feature Comparison](#detailed-feature-comparison)
- [Architecture Comparison](#architecture-comparison)
- [Performance Characteristics](#performance-characteristics)
- [Use Case Recommendations](#use-case-recommendations)
- [Links Queue Roadmap](#links-queue-roadmap)
- [References](#references)

## Overview

### Links Queue (JavaScript & Rust)

Links Queue is a universal queue system that works with **links** instead of traditional messages, events, or tasks. Each queue item is a link—the fundamental unit of information represented as ordered pairs. It provides both JavaScript/TypeScript (supporting Node.js, Bun, and Deno) and Rust implementations with a focus on:

- **Link-Based Data Model**: Universal representation using links instead of arbitrary messages
- **Configuration Over Code**: Scale from single in-memory to distributed storage by changing config, not code
- **Deployment Flexibility**: Use as embedded library or standalone server
- **Multi-runtime**: JavaScript version works across Node.js, Bun, and Deno
- **Cross-platform**: Rust version supports Linux, macOS, and Windows
- **Extensible Storage**: Pluggable storage backends (memory, link-cli, custom)
- **Links Notation Protocol**: Native data exchange format with future binary protocol support

### Existing Solutions

| Broker | Type | Primary Language | First Release |
|--------|------|------------------|---------------|
| [RabbitMQ](https://www.rabbitmq.com/) | Message Broker | Erlang | 2007 |
| [Celery](https://docs.celeryq.dev/) | Task Queue | Python | 2009 |
| [BullMQ](https://bullmq.io/) | Job Queue | Node.js (Redis-backed) | 2019 |
| [Apache Kafka](https://kafka.apache.org/) | Event Streaming Platform | Java/Scala | 2011 |

## Quick Comparison Matrix

| Feature | Links Queue JS | Links Queue Rust | RabbitMQ | Celery | BullMQ | Kafka |
|---------|-------------|---------------|----------|--------|--------|-------|
| **Core Messaging** |
| Point-to-Point | Planned | Planned | Yes | Yes | Yes | Yes |
| Pub/Sub | Planned | Planned | Yes | No | Limited | Yes |
| Message Persistence | Planned | Planned | Yes | Yes* | Yes | Yes |
| Message Ordering | Planned | Planned | Per-queue | Limited | Yes | Per-partition |
| **Reliability** |
| At-least-once delivery | Planned | Planned | Yes | Yes | Yes | Yes |
| Exactly-once delivery | Planned | Planned | Yes | No | No | Yes |
| Dead Letter Queue | Planned | Planned | Yes | Yes | Yes | Yes |
| Message Retry | Planned | Planned | Yes | Yes | Yes | Yes |
| **Scalability** |
| Horizontal Scaling | Planned | Planned | Yes | Yes | Yes | Yes |
| Clustering | Planned | Planned | Yes | Yes* | Yes* | Yes |
| Partitioning | Planned | Planned | No | No | No | Yes |
| **Performance** |
| Throughput | TBD | TBD | ~50K msg/s | Varies | ~100K msg/s | ~1M msg/s |
| Latency | TBD | TBD | Low | Medium | Very Low | Low-Medium |
| **Developer Experience** |
| Zero Config Start | Yes | Yes | No | No | Partial | No |
| Multi-runtime Support | Yes | N/A | N/A | N/A | N/A | N/A |
| TypeScript Support | Yes | N/A | Community | Community | Yes | Community |
| Async/Await Native | Yes | Yes | Varies | Yes | Yes | Varies |
| **Operations** |
| External Dependencies | None | None | Erlang | Broker+Backend | Redis | ZooKeeper/KRaft |
| Memory Footprint | Low | Low | Medium | Low | Low | High |
| Management UI | Planned | Planned | Yes | Yes (Flower) | Yes (bull-board) | Yes |

*Depends on broker/backend configuration

## Detailed Feature Comparison

### RabbitMQ

**Strengths:**
- Mature and battle-tested (17+ years)
- Multiple protocol support (AMQP 1.0, MQTT 5, STOMP)
- Flexible routing with exchanges (direct, topic, fanout, headers)
- Built-in clustering and high availability
- Rich plugin ecosystem (Federation, Shovel, Management)
- Strong delivery guarantees

**Limitations:**
- Requires Erlang runtime
- Complex initial setup for production
- Memory usage can grow significantly with many queues
- Not designed for event streaming/replay

**Best For:**
- Complex routing requirements
- Enterprise messaging
- Microservices communication
- When you need multiple protocol support

### Celery

**Strengths:**
- Python-native with familiar decorators
- Flexible broker support (RabbitMQ, Redis, SQS)
- Canvas for complex workflows (chains, groups, chords)
- Celery Beat for scheduled tasks
- Multiple concurrency models (prefork, eventlet, gevent)
- Mature ecosystem with extensive documentation

**Limitations:**
- Python-only (not suitable for polyglot environments)
- Requires separate broker and result backend
- Can be complex to configure properly
- Limited real-time streaming capabilities

**Best For:**
- Python applications
- Background job processing
- Scheduled tasks
- Complex task workflows

### Redis + BullMQ

**Strengths:**
- Ultra-low latency (in-memory)
- Simple setup with Redis
- Excellent Node.js integration
- Job priorities, delays, and rate limiting
- Sandboxed workers for isolation
- Active development and modern API

**Limitations:**
- Redis dependency (single point of failure without clustering)
- Memory-bound (expensive for large datasets)
- Limited message persistence guarantees
- Node.js focused (Python/PHP ports available)

**Best For:**
- Node.js applications
- Real-time job processing
- When low latency is critical
- Small to medium scale operations

### Apache Kafka

**Strengths:**
- Extremely high throughput (~1M+ messages/second)
- Distributed by design with built-in partitioning
- Message replay and time-travel capabilities
- Strong durability with disk persistence
- Event sourcing and stream processing (Kafka Streams)
- KRaft mode (no ZooKeeper dependency in 4.0+)

**Limitations:**
- Complex to operate and tune
- Higher latency than in-memory solutions
- Overkill for simple use cases
- Steep learning curve
- Resource intensive (memory, disk, CPU)

**Best For:**
- High-throughput event streaming
- Log aggregation
- Real-time analytics pipelines
- Event sourcing architectures
- Large-scale distributed systems

### Links Queue

**Design Goals:**
- Work with **links** as the universal data unit (not arbitrary messages)
- Scale from embedded to distributed by configuration alone
- Support multiple operating modes: single-memory, single-stored, multi-memory, multi-stored
- Use Links Notation as the native data exchange protocol
- Provide pluggable, extensible storage backends
- Zero external dependencies for basic in-memory usage

**Planned Strengths:**
- Universal link-based data model for semantic relationships
- Same code runs across all deployment modes
- Minimal setup for development, robust options for production
- Consistent API across JavaScript and Rust
- Native integration with link-cli for persistent storage
- Built-in TypeScript support
- Cross-runtime JavaScript (Node.js, Bun, Deno)
- Lightweight footprint with extensibility when needed

## Architecture Comparison

### Message Flow Patterns

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Message Flow Patterns                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Point-to-Point (Work Queue):                                       │
│  ┌──────────┐    ┌─────────┐    ┌──────────┐                       │
│  │ Producer │───▶│  Queue  │───▶│ Consumer │                       │
│  └──────────┘    └─────────┘    └──────────┘                       │
│  Supported by: All brokers                                          │
│                                                                      │
│  Publish-Subscribe:                                                  │
│  ┌──────────┐    ┌─────────┐    ┌──────────┐                       │
│  │Publisher │───▶│  Topic  │───▶│Subscriber│                       │
│  └──────────┘    └─────────┘    ├──────────┤                       │
│                        │        │Subscriber│                       │
│                        └───────▶└──────────┘                       │
│  Supported by: RabbitMQ, Kafka, Redis Pub/Sub                       │
│                                                                      │
│  Competing Consumers:                                                │
│  ┌──────────┐    ┌─────────┐    ┌──────────┐                       │
│  │ Producer │───▶│  Queue  │───▶│ Worker 1 │                       │
│  └──────────┘    └─────────┘    ├──────────┤                       │
│                        │        │ Worker 2 │                       │
│                        └───────▶└──────────┘                       │
│  Supported by: All brokers                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Dependency Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Dependency Requirements                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Links Queue:     [Application] ─── links-queue (embedded)          │
│                                                                      │
│  RabbitMQ:        [Application] ─── [AMQP Client] ─── [RabbitMQ]    │
│                                                          │          │
│                                                    [Erlang Runtime]  │
│                                                                      │
│  Celery:          [Application] ─── [Celery] ─── [Broker]           │
│                                         │            │              │
│                                         │      [RabbitMQ/Redis]     │
│                                         │                           │
│                                    [Result Backend]                  │
│                                         │                           │
│                                   [Redis/DB/etc]                    │
│                                                                      │
│  BullMQ:          [Application] ─── [BullMQ] ─── [Redis]            │
│                                                                      │
│  Kafka:           [Application] ─── [Kafka Client] ─── [Kafka]      │
│                                                            │        │
│                                                    [KRaft/ZooKeeper] │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Performance Characteristics

### Throughput Comparison

| Broker | Messages/Second | Notes |
|--------|-----------------|-------|
| Apache Kafka | ~1,000,000+ | Optimized for high throughput |
| Redis/BullMQ | ~100,000-500,000 | In-memory, single-threaded Redis |
| RabbitMQ | ~20,000-50,000 | Depends on persistence settings |
| Celery | ~10,000-50,000 | Depends on broker and workers |
| Links Queue | TBD | Target: competitive with BullMQ |

### Latency Comparison

| Broker | P50 Latency | P99 Latency | Notes |
|--------|-------------|-------------|-------|
| Redis/BullMQ | <1ms | <5ms | In-memory advantage |
| RabbitMQ | 1-5ms | 10-50ms | Network + persistence |
| Apache Kafka | 2-10ms | 20-100ms | Batching trade-offs |
| Celery | 5-50ms | 100-500ms | Python overhead + broker |
| Links Queue | TBD | TBD | Target: sub-millisecond |

### Resource Usage

| Broker | Memory (Idle) | Memory (Active) | Disk Usage |
|--------|---------------|-----------------|------------|
| Links Queue JS | ~20MB | ~50-100MB | Optional |
| Links Queue Rust | ~5MB | ~20-50MB | Optional |
| RabbitMQ | ~100MB | ~500MB-2GB | Per-queue |
| Celery Worker | ~50MB | ~200MB-1GB | Via backend |
| BullMQ | ~30MB | ~100-500MB | Redis-dependent |
| Kafka Broker | ~1GB | ~4-16GB | High (logs) |

## Use Case Recommendations

### When to Choose Each Solution

| Use Case | Recommended | Alternatives |
|----------|-------------|--------------|
| **Simple task queue** | Links Queue, BullMQ | Celery, RabbitMQ |
| **Python application** | Celery | RabbitMQ |
| **Node.js application** | Links Queue JS, BullMQ | RabbitMQ |
| **Rust application** | Links Queue Rust | RabbitMQ (via lapin) |
| **High throughput streaming** | Kafka | RabbitMQ Streams |
| **Complex routing** | RabbitMQ | Kafka |
| **Event sourcing** | Kafka | RabbitMQ |
| **Scheduled jobs** | Celery, BullMQ | Links Queue (planned) |
| **Multi-language** | RabbitMQ, Kafka | Links Queue (JS/Rust) |
| **Minimal setup** | Links Queue, BullMQ | - |
| **Enterprise/Compliance** | RabbitMQ, Kafka | - |

### Decision Tree

```
Start
  │
  ├─► Need event streaming/replay? ────────────────────► Kafka
  │
  ├─► Python-only application? ────────────────────────► Celery
  │
  ├─► Complex routing patterns? ───────────────────────► RabbitMQ
  │
  ├─► Node.js with Redis already? ─────────────────────► BullMQ
  │
  ├─► Multi-runtime JS (Node/Bun/Deno)? ───────────────► Links Queue JS
  │
  ├─► Rust application, minimal deps? ─────────────────► Links Queue Rust
  │
  └─► Simple job queue, quick start? ──────────────────► Links Queue
```

## Links Queue Roadmap

For the complete development roadmap, see [ROADMAP.md](ROADMAP.md).

### Current Status

- [x] Project structure (JS and Rust)
- [x] Multi-runtime support (Node.js, Bun, Deno)
- [x] Cross-platform Rust (Linux, macOS, Windows)
- [x] Async/await patterns
- [x] TypeScript definitions
- [x] Vision and planning documentation
- [ ] Core link-based queue implementation

### Operating Modes (Planned)

Links Queue will support four operating modes, selectable by configuration:

| Mode | Persistence | Distribution | Use Case |
|------|-------------|--------------|----------|
| `single-memory` | None | Single node | Development, testing |
| `single-stored` | link-cli | Single node | Production single-node |
| `multi-memory` | None | Distributed | Ephemeral high-throughput |
| `multi-stored` | link-cli | Distributed | Production distributed |

### Development Phases

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 0 | Foundation & Planning | In Progress |
| Phase 1 | Core Link Operations | Planned |
| Phase 2 | Single-Node Queue | Planned |
| Phase 3 | Persistence (link-cli) | Planned |
| Phase 4 | Links Notation Protocol | Planned |
| Phase 5 | Server Mode | Planned |
| Phase 6 | Multi-Node Clustering | Planned |
| Phase 7 | Advanced Features | Planned |
| Phase 8 | Observability | Planned |
| Phase 9 | Binary Protocol | Planned |
| Phase 10 | Ecosystem & Integrations | Planned |

## References

### Official Documentation
- [RabbitMQ Documentation](https://www.rabbitmq.com/docs)
- [Celery Documentation](https://docs.celeryq.dev/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)

### Comparison Resources
- [RabbitMQ vs Kafka vs Redis](https://logit.io/blog/post/rabbitmq-vs-kafka-vs-redis/)
- [Messaging Patterns Explained](https://blog.bytebytego.com/p/messaging-patterns-explained-pub)
- [Choosing the Right Messaging System](https://medium.com/@sheikh.hamza.arshad/choosing-the-right-messaging-system-kafka-redis-rabbitmq-activemq-and-nats-compared-fa2dd385976f)

### Research Papers
- [Comparing Big Data Messaging Platforms: Apache Kafka, RabbitMQ, and Redis](https://www.researchgate.net/publication/398353443_Comparing_Big_Data_Messaging_Platforms_An_Evaluation_of_Apache_Kafka_Rabbitmq_and_Redis)

---

*This comparison document is maintained as part of the Links Queue project. For updates and corrections, please open an issue or pull request.*
