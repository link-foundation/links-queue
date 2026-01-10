# Links Queue Requirements

This document specifies the functional and non-functional requirements for Links Queue, organized by priority and implementation phase.

## Table of Contents

- [Core Principles](#core-principles)
- [Data Model Requirements](#data-model-requirements)
- [Operating Modes](#operating-modes)
- [API Requirements](#api-requirements)
- [Protocol Requirements](#protocol-requirements)
- [Storage Backend Requirements](#storage-backend-requirements)
- [Reliability Requirements](#reliability-requirements)
- [Performance Requirements](#performance-requirements)
- [Scalability Requirements](#scalability-requirements)
- [Observability Requirements](#observability-requirements)
- [Compatibility Requirements](#compatibility-requirements)

## Core Principles

### P1: Links as First-Class Citizens
- **REQ-CORE-001**: Each queue item MUST be represented as a link
- **REQ-CORE-002**: A link is an ordered sequence of (source, target) pairs
- **REQ-CORE-003**: Links MAY reference other links, enabling nested structures
- **REQ-CORE-004**: Links MUST support self-referencing for named/typed links

### P2: Configuration Over Code Change
- **REQ-CORE-010**: Switching between operating modes MUST NOT require code changes
- **REQ-CORE-011**: All mode-specific behavior MUST be controlled via configuration
- **REQ-CORE-012**: Default configuration MUST enable immediate use with sensible defaults

### P3: Deployment Flexibility
- **REQ-CORE-020**: The system MUST support embedded library deployment
- **REQ-CORE-021**: The system MUST support standalone server deployment
- **REQ-CORE-022**: API MUST be consistent across deployment modes

## Data Model Requirements

### Link Structure
- **REQ-DATA-001**: A link MUST have a unique identifier (index)
- **REQ-DATA-002**: A link MUST have a source reference
- **REQ-DATA-003**: A link MUST have a target reference
- **REQ-DATA-004**: Source and target MAY be link indices or literal values

### Link Operations
- **REQ-DATA-010**: System MUST support creating new links
- **REQ-DATA-011**: System MUST support reading links by pattern matching
- **REQ-DATA-012**: System MUST support updating existing links
- **REQ-DATA-013**: System MUST support deleting links
- **REQ-DATA-014**: Identical link structures SHOULD be deduplicated automatically

### Queue Item Representation
- **REQ-DATA-020**: Each queue item MUST be a single link (potentially referencing others)
- **REQ-DATA-021**: Queue item metadata (priority, timestamp, etc.) MUST be expressible as links
- **REQ-DATA-022**: System MUST support arbitrary payload data via link sequences

## Operating Modes

### Single Node - In-Memory Only
- **REQ-MODE-001**: System MUST support fully in-memory operation
- **REQ-MODE-002**: In-memory mode MUST provide lowest latency
- **REQ-MODE-003**: Data loss on restart is acceptable in this mode
- **REQ-MODE-004**: Mode activation: `mode: "single-memory"`

### Single Node - Stored (link-cli)
- **REQ-MODE-010**: System MUST support persistence via link-cli storage
- **REQ-MODE-011**: All queue operations MUST be durable when persistence enabled
- **REQ-MODE-012**: System MUST support configurable storage location
- **REQ-MODE-013**: Mode activation: `mode: "single-stored"`

### Multiple Nodes - Memory Only
- **REQ-MODE-020**: System MUST support distributed in-memory operation
- **REQ-MODE-021**: Nodes MUST communicate using Links Notation protocol
- **REQ-MODE-022**: System MUST handle node join/leave gracefully
- **REQ-MODE-023**: Mode activation: `mode: "multi-memory"`

### Multiple Nodes - Stored
- **REQ-MODE-030**: System MUST support distributed operation with persistence
- **REQ-MODE-031**: Each node MUST maintain local storage
- **REQ-MODE-032**: System MUST ensure data consistency across nodes
- **REQ-MODE-033**: Mode activation: `mode: "multi-stored"`

## API Requirements

### Queue Operations
- **REQ-API-001**: `enqueue(link)` - Add a link to the queue
- **REQ-API-002**: `dequeue()` - Remove and return the next link
- **REQ-API-003**: `peek()` - Return the next link without removing
- **REQ-API-004**: `acknowledge(linkId)` - Confirm processing complete
- **REQ-API-005**: `reject(linkId, requeue?)` - Mark processing failed

### Queue Management
- **REQ-API-010**: `createQueue(name, options)` - Create a named queue
- **REQ-API-011**: `deleteQueue(name)` - Remove a queue
- **REQ-API-012**: `listQueues()` - Enumerate all queues
- **REQ-API-013**: `getQueueStats(name)` - Return queue metrics

### Consumer Operations
- **REQ-API-020**: `subscribe(queue, handler)` - Register message handler
- **REQ-API-021**: `unsubscribe(subscriptionId)` - Remove handler
- **REQ-API-022**: Support for async/await patterns in handlers

### Link Operations
- **REQ-API-030**: `createLink(source, target)` - Create a new link
- **REQ-API-031**: `getLink(id)` - Retrieve link by ID
- **REQ-API-032**: `findLinks(pattern)` - Query links by pattern
- **REQ-API-033**: `deleteLink(id)` - Remove a link

## Protocol Requirements

### Links Notation (Text Protocol)
- **REQ-PROTO-001**: All inter-node communication MUST use Links Notation
- **REQ-PROTO-002**: Format: `((source target) (source target) ...)`
- **REQ-PROTO-003**: MUST support named links: `((name: value))`
- **REQ-PROTO-004**: MUST support nested structures
- **REQ-PROTO-005**: MUST be human-readable for debugging

### Binary Links Notation (Future)
- **REQ-PROTO-010**: Binary protocol MUST be backward compatible with text
- **REQ-PROTO-011**: MUST support zero-copy parsing where possible
- **REQ-PROTO-012**: MUST include version header for evolution
- **REQ-PROTO-013**: Compact representation for wire efficiency

### Transport
- **REQ-PROTO-020**: MUST support TCP transport
- **REQ-PROTO-021**: SHOULD support WebSocket transport
- **REQ-PROTO-022**: MAY support Unix domain sockets for local communication

## Storage Backend Requirements

### Backend Interface
- **REQ-STORE-001**: Storage backends MUST implement a common interface
- **REQ-STORE-002**: Interface MUST include: `save`, `load`, `delete`, `query`
- **REQ-STORE-003**: Backends MUST be pluggable at runtime via configuration
- **REQ-STORE-004**: Custom backends MUST be registrable by users

### Built-in Backends
- **REQ-STORE-010**: Memory backend (default for development)
- **REQ-STORE-011**: link-cli backend (file-based persistence)
- **REQ-STORE-012**: Future: Redis backend
- **REQ-STORE-013**: Future: PostgreSQL backend

### Backend Contract
- **REQ-STORE-020**: Backends MUST support atomic operations
- **REQ-STORE-021**: Backends MUST report capabilities (transactions, durability level)
- **REQ-STORE-022**: System MUST validate backend capabilities against mode requirements

## Reliability Requirements

### Delivery Guarantees
- **REQ-REL-001**: MUST support at-least-once delivery
- **REQ-REL-002**: SHOULD support exactly-once delivery (with compatible backends)
- **REQ-REL-003**: MUST support message acknowledgment
- **REQ-REL-004**: Unacknowledged messages MUST be requeued after timeout

### Failure Handling
- **REQ-REL-010**: MUST support dead letter queues
- **REQ-REL-011**: MUST support configurable retry policies
- **REQ-REL-012**: MUST support exponential backoff
- **REQ-REL-013**: MUST track retry count per message

### Data Integrity
- **REQ-REL-020**: MUST detect message corruption
- **REQ-REL-021**: MUST support checksums for stored messages
- **REQ-REL-022**: MUST log all data integrity violations

## Performance Requirements

### Latency Targets
- **REQ-PERF-001**: In-memory enqueue/dequeue: < 1ms p99
- **REQ-PERF-002**: Stored enqueue/dequeue: < 10ms p99
- **REQ-PERF-003**: Network round-trip (multi-node): < 50ms p99

### Throughput Targets
- **REQ-PERF-010**: Single node: > 100,000 messages/second
- **REQ-PERF-011**: Multi-node cluster: > 500,000 messages/second
- **REQ-PERF-012**: Performance MUST scale linearly with added nodes

### Resource Efficiency
- **REQ-PERF-020**: Memory overhead per message: < 1KB
- **REQ-PERF-021**: Idle memory usage: < 50MB (JS), < 10MB (Rust)
- **REQ-PERF-022**: CPU usage when idle: < 1%

## Scalability Requirements

### Horizontal Scaling
- **REQ-SCALE-001**: MUST support adding nodes without downtime
- **REQ-SCALE-002**: MUST support removing nodes without data loss
- **REQ-SCALE-003**: MUST support automatic rebalancing

### Queue Partitioning
- **REQ-SCALE-010**: SHOULD support queue partitioning across nodes
- **REQ-SCALE-011**: Partitioning strategy MUST be configurable
- **REQ-SCALE-012**: MUST maintain message ordering within partitions

### Consumer Scaling
- **REQ-SCALE-020**: MUST support multiple consumers per queue
- **REQ-SCALE-021**: MUST support consumer groups
- **REQ-SCALE-022**: MUST distribute messages fairly among consumers

## Observability Requirements

### Metrics
- **REQ-OBS-001**: MUST expose queue depth metrics
- **REQ-OBS-002**: MUST expose throughput metrics (enqueue/dequeue rates)
- **REQ-OBS-003**: MUST expose latency histograms
- **REQ-OBS-004**: MUST expose consumer lag metrics

### Logging
- **REQ-OBS-010**: MUST support configurable log levels
- **REQ-OBS-011**: MUST include correlation IDs for tracing
- **REQ-OBS-012**: Logs MUST be structured (JSON format option)

### Health Checks
- **REQ-OBS-020**: MUST expose liveness endpoint
- **REQ-OBS-021**: MUST expose readiness endpoint
- **REQ-OBS-022**: Health checks MUST include backend connectivity

### Management UI (Future)
- **REQ-OBS-030**: SHOULD provide web-based management interface
- **REQ-OBS-031**: UI MUST show queue status and metrics
- **REQ-OBS-032**: UI MUST support basic queue operations

## Compatibility Requirements

### Language Support
- **REQ-COMPAT-001**: MUST provide JavaScript/TypeScript implementation
- **REQ-COMPAT-002**: MUST provide Rust implementation
- **REQ-COMPAT-003**: Both implementations MUST have API parity

### Runtime Support
- **REQ-COMPAT-010**: JavaScript: Node.js 20+, Bun, Deno
- **REQ-COMPAT-011**: Rust: MSRV 1.70+
- **REQ-COMPAT-012**: MUST support Linux, macOS, Windows

### Integration
- **REQ-COMPAT-020**: MUST integrate with link-cli for storage
- **REQ-COMPAT-021**: SHOULD provide adapters for common frameworks
- **REQ-COMPAT-022**: MUST support standard message queue patterns

## Feature Parity with Competitors

To be competitive, Links Queue MUST eventually support:

| Feature | RabbitMQ | Celery | BullMQ | Kafka | Links Queue |
|---------|----------|--------|--------|-------|-------------|
| Point-to-Point | Yes | Yes | Yes | Yes | Required |
| Pub/Sub | Yes | No | Limited | Yes | Required |
| Message Persistence | Yes | Yes | Yes | Yes | Required |
| Dead Letter Queue | Yes | Yes | Yes | Yes | Required |
| Retry with Backoff | Yes | Yes | Yes | Yes | Required |
| Priority Queues | Yes | Yes | Yes | No | Required |
| Delayed Messages | Yes | Yes | Yes | No | Required |
| Rate Limiting | Plugin | Yes | Yes | No | Required |
| Scheduled Jobs | No | Yes | Yes | No | Required |
| Message Replay | No | No | No | Yes | Desired |
| Exactly-Once | Yes | No | No | Yes | Desired |

---

*This requirements document is a living specification. Requirements may be added, modified, or deprecated as the project evolves.*
