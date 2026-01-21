# links-queue-js

## 0.14.0

### Minor Changes

- 7ca45ec: Add ecosystem integrations and deployment tools

  **JavaScript Framework Integrations:**
  - Express.js middleware with request-level facade and RESTful router
  - Fastify plugin with decorators and route prefixes
  - NestJS module with forRoot/forRootAsync patterns and decorators
  - Hono middleware for edge environments (Cloudflare Workers, Deno Deploy)

  **Deployment Tools:**
  - Docker images with multi-stage builds for JS and Rust versions
  - Docker Compose configurations for single node and cluster deployments
  - Kubernetes Helm chart with HPA, PVC, ConfigMap, and ServiceAccount support

  **CLI Enhancements:**
  - Queue management commands (create, delete, list, info, purge)
  - Message operations (send, receive, peek, ack, reject)
  - Cluster management (status, join, leave)
  - Statistics and health check commands

## 0.13.0

### Minor Changes

- 8e7a8d7: Add Phase 7 advanced queue features
  - **Scheduling**: Implement `CronParser`, `Scheduler`, and `ScheduledQueue` for delayed messages, cron jobs, TTL, and message expiration
  - **Rate Limiting**: Implement `SlidingWindowCounter`, `TokenBucket`, `RateLimiter`, and `RateLimitedQueue` with sliding window algorithm
  - **Routing**: Implement `TopicMatcher`, `DirectExchange`, `TopicExchange`, `FanoutExchange`, `HeadersExchange`, `Router`, and `RoutedQueueManager` for topic-based routing with AMQP-style wildcards
  - **Pub/Sub**: Implement `MessageFilter`, `PubSubBroker`, `ObservableQueue`, and `QueueBackedPubSub` for publish/subscribe patterns with message filtering

## 0.12.0

### Minor Changes

- ed40d4e: Add Binary Links Notation protocol for efficient link serialization
  - Implement binary encoder/decoder with 20-40% size reduction over text notation
  - Add LEB128 variable-length integer encoding for compact numeric values
  - Support nested links, self-references, and typed values (null, boolean, string, integer)
  - Add protocol negotiation mechanism for client-server capability exchange
  - Include comprehensive benchmark tests comparing binary vs text performance

### Patch Changes

- a3b228f: Add comprehensive test infrastructure including Vitest for coverage, test fixtures, helpers, and mock backends

## 0.11.0

### Minor Changes

- dcb7106: Add multi-node clustering support for distributed queue operation
  - Implement ClusterCoordinator for cluster coordination and management
  - Add NodeDiscovery for static and DNS-based node discovery
  - Add PartitionManager with consistent hashing for queue distribution
  - Add GossipProtocol for peer-to-peer membership management
  - Add ClusterError for cluster-specific error handling
  - Support node health checking with configurable timeouts
  - Implement simple leader election based on lexicographic node ID ordering
  - Add partition assignment and rebalancing on topology changes
  - Emit cluster events: node-joined, node-left, node-suspect, leader-changed, rebalance-started, rebalance-completed
  - Add comprehensive unit tests for all cluster components

## 0.10.0

### Minor Changes

- d8b7c82: Add TCP server mode for Links Queue
  - Implement LinksQueueServer with TCP socket support
  - Implement LinksQueueClient for connecting to TCP servers
  - Add CLI command for starting server: `links-queue server`
  - Support all queue operations over TCP: push, pop, peek, list, delete, getStats
  - Add connection management with idle timeout and max connections
  - Add graceful shutdown with connection draining

## 0.8.0

### Minor Changes

- 49c0bec: Add LinksQueue and MemoryQueueManager implementations
  - Implement `LinksQueue` class with FIFO ordering, visibility timeout, at-least-once delivery, acknowledgment/rejection, and dead letter queue support
  - Implement `MemoryQueueManager` for managing named queues with create/delete/get/list operations
  - Implement `DeliveryTracker` for in-flight item tracking with visibility timeouts and retry counting
  - Add TypeScript declarations for all new modules
  - Add comprehensive tests (50+ tests for queue implementation)

## 0.7.0

### Minor Changes

- 8442af6: Implement Queue and QueueManager for JavaScript
  - Add `MemoryQueue` class for FIFO queue with visibility timeout
  - Add `MemoryQueueWithStorage` wrapper for proper requeue support
  - Add `MemoryQueueManager` for queue lifecycle management
  - Add `DeliveryTracker`, `DeliveryRecord`, and `DeliveryState` for delivery tracking
  - Support at-least-once delivery guarantee with retry limits
  - Support dead letter queue routing for failed messages
  - Full API parity with Rust implementation

## 0.6.0

### Minor Changes

- 7539cee: Implement link-cli storage backend for persistent storage
  - Add `LinkCliBackend` class implementing StorageBackend interface
  - Add `LinkCliProcess` for managing link-cli child processes
  - Support CRUD operations via Links Notation protocol
  - Register link-cli backend in BackendRegistry
  - Full TypeScript type definitions for all new exports
  - Comprehensive unit tests with mocked link-cli

## 0.5.0

### Minor Changes

- 20a50af: Integrate links-notation library for parsing and serialization
  - Add `links-notation` as a production dependency
  - Add `LinksNotation` class with `parse()` and `stringify()` methods
  - Add `NotationParser` for custom parser configurations
  - Add `NotationStreamParser` for streaming large inputs
  - Add `NotationParseError` for detailed parse error information
  - Add protocol message types (`RequestType`, `ResponseStatus`, `ErrorCode`)
  - Add `Message` and `MessageBuilder` classes for protocol communication
  - Add helper functions for creating request/response messages
  - Full TypeScript type definitions for all new exports
  - Comprehensive unit tests for parsing, serialization, and messages

- 1f1be69: Add pluggable StorageBackend interface for switching between storage backends via configuration
  - Add `StorageBackend` interface with lifecycle, CRUD, batch, and metadata operations
  - Add `BackendCapabilities` and `BackendStats` types for backend introspection
  - Add `MemoryBackendAdapter` wrapping `MemoryLinkStore` with `StorageBackend` interface
  - Add `BackendRegistry` for registering and creating backends by configuration
  - Add comprehensive tests for backend registry and adapter

## 0.4.0

### Minor Changes

- d230857: Add Queue and QueueManager interfaces (API Contract)

  Phase 2 implementation defining the complete queue API contract:
  - Queue interface with enqueue, dequeue, peek, acknowledge, reject operations
  - QueueManager interface for queue lifecycle management
  - EnqueueResult, QueueStats, QueueOptions, QueueInfo types
  - QueueError class with typed error codes
  - QueueHandler and QueueSubscription types for consumer patterns

  This establishes the API contract that implementations must follow.

## 0.3.0

### Minor Changes

- c15dbd8: Add MemoryLinkStore - in-memory storage backend for JavaScript/TypeScript

  Features:
  - Implements LinkStore interface with full CRUD operations
  - O(1) lookups by ID using JavaScript Map
  - Link deduplication (identical source/target pairs share same ID)
  - Pattern matching with wildcard queries via Any symbol
  - Async API for consistency with other backends
  - Support for universal links with additional values
  - AsyncIterable iteration over matching links
  - Clear method to reset the store

  This backend is ideal for development, testing, and scenarios where persistence is not required.

## 0.2.0

### Minor Changes

- 24b0184: Add Link and LinkStore interfaces for Phase 1 API contract
  - Add `Link` interface with `id`, `source`, `target`, and optional `values` properties
  - Add `LinkRef` and `LinkId` types for flexible link referencing
  - Add `LinkStore` interface with CRUD operations (create, get, find, update, delete, etc.)
  - Add `LinkPattern` interface with `Any` wildcard for pattern matching
  - Add utility functions: `isLink`, `isLinkId`, `isLinkRef`, `getLinkId`, `createLink`, `matchesPattern`
  - Compatible with links-notation and doublets-rs patterns

## 0.1.6

### Patch Changes

- 7b20214: Rename project from links-mq to links-queue and add planning documentation
  - Renamed all package references from links-mq to links-queue
  - Added VISION.md with project goals and universal queue vision
  - Added REQUIREMENTS.md with detailed functional/non-functional requirements
  - Added ARCHITECTURE.md with system architecture and operating modes
  - Added ROADMAP.md with 10-phase development plan
  - Updated COMPARISON.md with new naming and roadmap references

## 0.1.5

### Patch Changes

- 3a49cca: Move JS implementation to separate folder for multi-language support
  - Restructured repository to support both JavaScript and Rust implementations
  - Moved all JS-related files to the `js/` folder
  - Updated CI/CD workflow for folder-based path filtering
  - No functional changes to the library

## 0.1.4

### Patch Changes

- Reorganized codebase structure with separate js folder
