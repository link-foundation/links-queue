# Links Queue Roadmap

This roadmap outlines the development phases for Links Queue, from the current state to a fully-featured distributed queue system.

## Current Status

- [x] Project structure with JS and Rust implementations
- [x] Multi-runtime support (Node.js, Bun, Deno)
- [x] Cross-platform Rust (Linux, macOS, Windows)
- [x] CI/CD pipelines for both languages
- [x] Comprehensive comparison documentation
- [ ] Core queue functionality (in progress)

## Phase 0: Foundation (Current)

**Goal**: Establish project identity and planning documentation.

### Deliverables
- [x] Rename project from links-mq to links-queue
- [x] Create VISION.md
- [x] Create REQUIREMENTS.md
- [x] Create ARCHITECTURE.md
- [x] Create ROADMAP.md
- [x] Update COMPARISON.md with new vision

### Success Criteria
- Clear documentation of goals and architecture
- Consistent naming throughout codebase

---

## Phase 1: Core Link Operations

**Goal**: Implement the fundamental link data model and operations.

### JavaScript Implementation
- [ ] Define Link type with id, source, target
- [ ] Implement LinkStore with in-memory backend
- [ ] Create link operations: create, read, update, delete
- [ ] Implement link deduplication logic
- [ ] Add pattern matching for link queries
- [ ] Write unit tests for all operations

### Rust Implementation
- [ ] Define Link struct with id, source, target
- [ ] Implement LinkStore trait
- [ ] Create memory backend implementing LinkStore
- [ ] Implement CRUD operations
- [ ] Add pattern matching
- [ ] Write unit tests

### Documentation
- [ ] API documentation for link operations
- [ ] Usage examples in examples/ folder

### Success Criteria
- Can create, read, update, delete links
- Links are automatically deduplicated
- Pattern-based queries work
- 100% test coverage for core operations

---

## Phase 2: Single-Node Queue

**Goal**: Implement basic queue functionality in single-node mode.

### Queue Operations
- [ ] Queue creation and deletion
- [ ] Enqueue: add link to queue
- [ ] Dequeue: remove and return next link
- [ ] Peek: view next link without removing
- [ ] Acknowledge: confirm processing complete
- [ ] Reject: mark processing failed

### Queue Features
- [ ] FIFO ordering (default)
- [ ] Priority queues (configurable)
- [ ] Queue statistics (depth, throughput)
- [ ] Message visibility timeout
- [ ] Dead letter queue routing

### Delivery Guarantees
- [ ] At-least-once delivery
- [ ] Acknowledgment tracking
- [ ] Automatic requeue on timeout
- [ ] Configurable retry policies
- [ ] Exponential backoff

### Consumer API
- [ ] Subscribe to queue with handler
- [ ] Unsubscribe
- [ ] Consumer groups (competing consumers)
- [ ] Prefetch configuration

### Success Criteria
- Can enqueue and dequeue links
- Messages are delivered at least once
- Failed messages are retried
- Exhausted retries go to dead letter queue

---

## Phase 3: Persistence (link-cli Integration)

**Goal**: Add durable storage using link-cli backend.

### Storage Backend Interface
- [ ] Define StorageBackend trait/interface
- [ ] Implement backend capability reporting
- [ ] Add backend registration mechanism
- [ ] Support runtime backend selection

### link-cli Backend
- [ ] Implement link-cli adapter
- [ ] Map queue operations to link-cli commands
- [ ] Handle link-cli process lifecycle
- [ ] Support configurable database location
- [ ] Add write-ahead logging for durability

### Memory Backend Enhancement
- [ ] Add optional periodic snapshots
- [ ] Implement warm-start from snapshot

### Configuration
- [ ] Single-memory mode configuration
- [ ] Single-stored mode configuration
- [ ] Mode switching without code changes

### Success Criteria
- Queue survives process restart (stored mode)
- Same code works with different backends
- Backend can be changed via configuration alone

---

## Phase 4: Links Notation Protocol

**Goal**: Implement the text-based Links Notation for data exchange.

### Parser
- [ ] Links Notation grammar definition
- [ ] Lexer/tokenizer implementation
- [ ] Parser with error reporting
- [ ] Streaming parser for large messages

### Serializer
- [ ] Link to notation conversion
- [ ] Pretty-print option for debugging
- [ ] Compact mode for wire efficiency

### Protocol Messages
- [ ] Define message types (enqueue, dequeue, ack, etc.)
- [ ] Request/response format
- [ ] Error format
- [ ] Heartbeat/ping format

### Validation
- [ ] Schema validation for messages
- [ ] Type checking
- [ ] Size limits enforcement

### Success Criteria
- All link operations expressible in notation
- Parser handles malformed input gracefully
- Round-trip serialization preserves data

---

## Phase 5: Server Mode

**Goal**: Enable Links Queue to run as a standalone server.

### Server Implementation
- [ ] TCP listener with connection handling
- [ ] Request routing to queue operations
- [ ] Connection pooling
- [ ] Graceful shutdown

### Client Library
- [ ] Connection management
- [ ] Request/response handling
- [ ] Automatic reconnection
- [ ] Connection timeout configuration

### Protocol
- [ ] Message framing over TCP
- [ ] Request pipelining
- [ ] Bidirectional streaming for subscriptions

### Configuration
- [ ] Server bind address
- [ ] Max connections
- [ ] Timeout settings
- [ ] Resource limits

### Success Criteria
- Server accepts client connections
- All queue operations work over network
- Client handles disconnection gracefully

---

## Phase 6: Multi-Node Clustering

**Goal**: Enable distributed operation across multiple nodes.

### Node Discovery
- [ ] Static node list configuration
- [ ] Health checking between nodes
- [ ] Failure detection
- [ ] Node join/leave handling

### Cluster Coordination
- [ ] Leader election (for coordination tasks)
- [ ] Distributed queue registry
- [ ] Cross-node routing

### Queue Partitioning
- [ ] Partition assignment to nodes
- [ ] Consistent hashing for distribution
- [ ] Rebalancing on topology change
- [ ] Partition-aware consumers

### Multi-Node Modes
- [ ] multi-memory mode implementation
- [ ] multi-stored mode implementation
- [ ] Replication factor configuration
- [ ] Sync vs async replication choice

### Success Criteria
- Queue operations work across cluster
- Cluster handles node failures
- Messages are not lost on single node failure

---

## Phase 7: Advanced Features

**Goal**: Implement features for production parity with competitors.

### Scheduling
- [ ] Delayed messages (enqueue for future)
- [ ] Cron-based scheduled jobs
- [ ] Time-to-live (TTL) for messages
- [ ] Message expiration

### Rate Limiting
- [ ] Per-queue rate limits
- [ ] Per-consumer rate limits
- [ ] Sliding window algorithm
- [ ] Backpressure signaling

### Routing
- [ ] Topic-based routing
- [ ] Pattern matching on link content
- [ ] Exchange types (direct, topic, fanout)
- [ ] Binding management

### Pub/Sub
- [ ] Topic creation/deletion
- [ ] Subscribe/unsubscribe
- [ ] Fan-out delivery
- [ ] Message filtering

### Success Criteria
- Feature parity with BullMQ for common use cases
- Can replace RabbitMQ for simple routing needs

---

## Phase 8: Observability

**Goal**: Provide comprehensive monitoring and debugging capabilities.

### Metrics
- [ ] Queue depth metrics
- [ ] Throughput metrics (messages/second)
- [ ] Latency histograms
- [ ] Consumer lag
- [ ] Error rates
- [ ] Prometheus export format

### Logging
- [ ] Structured logging (JSON format)
- [ ] Configurable log levels
- [ ] Correlation IDs for tracing
- [ ] Log rotation support

### Health Checks
- [ ] Liveness endpoint
- [ ] Readiness endpoint
- [ ] Component health details

### Management UI (Optional)
- [ ] Web-based dashboard
- [ ] Queue visualization
- [ ] Message inspection
- [ ] Basic operations (purge, move)

### Success Criteria
- Can monitor cluster health via metrics
- Can debug issues via logs
- Health checks integrate with orchestrators

---

## Phase 9: Binary Protocol

**Goal**: Implement high-performance binary Links Notation.

### Binary Format Design
- [ ] Wire format specification
- [ ] Versioning strategy
- [ ] Compression support
- [ ] Forward/backward compatibility

### Implementation
- [ ] Binary encoder
- [ ] Binary decoder
- [ ] Zero-copy parsing optimization
- [ ] Buffer pooling

### Protocol Selection
- [ ] Automatic format detection
- [ ] Client capability negotiation
- [ ] Fallback to text notation

### Performance Validation
- [ ] Benchmark vs text notation
- [ ] Memory allocation profiling
- [ ] Latency impact analysis

### Success Criteria
- 5-10x reduction in message size
- No regression in functionality
- Backward compatible with text protocol

---

## Phase 10: Ecosystem & Integrations

**Goal**: Provide integrations with common frameworks and tools.

### Framework Integrations
- [ ] Express.js middleware
- [ ] Fastify plugin
- [ ] NestJS module
- [ ] Actix-web integration
- [ ] Axum integration

### Tool Integrations
- [ ] Docker image
- [ ] Kubernetes Helm chart
- [ ] Terraform provider
- [ ] CLI administration tool

### Client Libraries
- [ ] Python client (via Links Notation)
- [ ] Go client (via Links Notation)
- [ ] .NET client (via Links Notation)

### Documentation
- [ ] Production deployment guide
- [ ] Migration guide from other queues
- [ ] Performance tuning guide

### Success Criteria
- Easy integration with major frameworks
- One-command deployment options
- Cross-language interoperability

---

## Beyond: Future Considerations

Ideas for future development beyond the initial roadmap:

- **Event Sourcing**: Built-in event store with replay
- **Stream Processing**: Kafka Streams-like functionality
- **Multi-tenancy**: Isolated queues for different tenants
- **Geo-replication**: Cross-datacenter distribution
- **GraphQL API**: Alternative to Links Notation for web clients
- **WASM Runtime**: Run Links Queue in browser environments
- **Consensus Protocol**: Raft-based cluster for strong consistency

---

## Contributing

Contributions are welcome at any phase! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas for contribution:
1. Core link operations (Phase 1)
2. Test coverage improvement
3. Documentation and examples
4. Performance benchmarks

---

*This roadmap is a living document and will be updated as development progresses and priorities evolve.*
