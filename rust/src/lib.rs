//! links-queue - A lightweight message queue implementation.
//!
//! This crate provides the core Link and `LinkStore` abstractions for
//! building associative data structures and message queues.
//!
//! # Core Concepts
//!
//! - **Link**: A directed relationship from source to target, identified by a unique ID.
//! - **`LinkStore`**: A storage backend for managing links with CRUD operations.
//! - **`LinkPattern`**: A pattern for querying links with wildcard support.
//! - **[`MemoryLinkStore`]**: In-memory storage backend with O(1) lookups.
//! - **[`Queue`]**: A message queue built on top of Links for queue operations.
//! - **[`QueueManager`]**: Manager for creating and managing queue instances.
//!
//! # Design Goals
//!
//! - Compatible with [links-notation](https://github.com/link-foundation/links-notation)
//! - Compatible with [doublets-rs](https://github.com/linksplatform/doublets-rs) patterns
//! - Extensible for universal links with any number of references
//!
//! # Example
//!
//! ```rust
//! use links_queue::{Link, LinkRef, LinkPattern, Any};
//!
//! // Create a simple link
//! let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
//! assert_eq!(link.id, 1);
//! assert_eq!(link.source_id(), 2);
//! assert_eq!(link.target_id(), 3);
//!
//! // Create a nested link structure
//! let inner = Link::new(2u64, LinkRef::Id(3), LinkRef::Id(4));
//! let outer = Link::new(1u64, LinkRef::link(inner), LinkRef::Id(5));
//!
//! // Pattern matching
//! let pattern = LinkPattern::with_source(LinkRef::Id(2u64));
//! assert!(pattern.matches(&Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3))));
//! ```
//!
//! # Using the In-Memory Backend
//!
//! ```rust
//! use links_queue::{MemoryLinkStore, LinkStore, LinkRef, LinkPattern};
//!
//! let mut store = MemoryLinkStore::<u64>::new();
//!
//! // Create a link
//! let link = store.create(LinkRef::Id(2), LinkRef::Id(3)).unwrap();
//! println!("Created link: {:?}", link); // Link { id: 1, source: Id(2), target: Id(3) }
//!
//! // Deduplication - same structure returns existing link
//! let duplicate = store.create(LinkRef::Id(2), LinkRef::Id(3)).unwrap();
//! assert_eq!(duplicate.id, link.id);
//!
//! // Find links by pattern
//! let results = store.find(&LinkPattern::with_source(LinkRef::Id(2)));
//! assert_eq!(results.len(), 1);
//! ```

// =============================================================================
// Module Declarations
// =============================================================================

pub mod backends;
pub mod client;
pub mod cluster;
pub mod observability;
pub mod queue;
pub mod server;
mod traits;

// Web framework integrations (feature-gated)
#[cfg(any(feature = "axum", feature = "actix"))]
pub mod integrations;

// =============================================================================
// Public Re-exports
// =============================================================================

pub use backends::MemoryLinkStore;
pub use queue::{
    EnqueueResult, MemoryQueue, MemoryQueueManager, MemoryQueueWithStorage, Queue, QueueError,
    QueueErrorCode, QueueInfo, QueueManager, QueueOptions, QueueResult, QueueStats,
};
pub use traits::{
    Any, Link, LinkError, LinkPattern, LinkRef, LinkResult, LinkStore, LinkType, PatternField,
};

// Re-export storage backend types
pub use backends::{
    BackendCapabilities, BackendConfig, BackendError, BackendRegistry, BackendResult, BackendStats,
    DurabilityLevel, MemoryBackend, OperationStats, StorageBackend, StorageBackendDyn,
};

// Re-export link-cli backend types
pub use backends::{
    LinkCliBackend, LinkCliConfig, LinkCliProcess, LinksNotation, NotationParseError,
    NotationResult, ParsedLink, ProcessConfig, ProcessError, ProcessResult,
};

// Re-export cluster types
pub use cluster::{
    // Coordinator
    ClusterBuilder,
    // Traits and configuration
    ClusterConfig,
    ClusterCoordinator,
    ClusterError,
    ClusterErrorCode,
    ClusterEvent,
    ClusterNode,
    ClusterResult,
    ClusterStats,
    // Replication
    DataReplicationManager,
    DefaultClusterCoordinator,
    DiscoveryMethod,
    // Discovery
    DiscoveryService,
    // Gossip
    GossipConfig,
    GossipMessage,
    GossipMessageType,
    GossipProtocol,
    GossipStats,
    // Partitioning
    HashRing,
    // Node implementation
    LocalNode,
    MemberState,
    Node,
    NodeBuilder,
    NodeCounts,
    NodeMetadata,
    NodeStatus,
    PartitionKey,
    PartitionManager,
    PartitionStats,
    ReplicationConfig,
    ReplicationManager,
    ReplicationRequest,
    ReplicationResponse,
    ReplicationStats,
    StaticDiscovery,
    SyncMode,
};

// Re-export server types
pub use server::{
    Connection, ConnectionId, ConnectionInfo, ConnectionState, LinksQueueServer, Request, Response,
    Router, ServerConfig, ServerError, ServerErrorCode, ServerEvent, ServerResult, ServerStats,
};

// Re-export client types
pub use client::{
    ClientConfig, ClientConnection, ClientConnectionState, ClientError, ClientErrorCode,
    ClientResult, LinksQueueClient, Subscription,
};

// Re-export observability types
pub use observability::{
    create_queue_logger,
    ComponentChecker,
    ComponentHealth,
    // Metrics
    Counter,
    Gauge,
    HealthCheckResult,
    HealthChecker,
    // Health
    HealthStatus,
    HistogramBucket,
    HistogramStats,
    LatencyHistogram,
    LatencyMetrics,
    LivenessResult,
    LogContext,
    LogEntry,
    LogFormat,
    // Logging
    LogLevel,
    LogOutput,
    Logger,
    MetricsRegistry,
    // Prometheus
    PrometheusExporter,
    QueueMetrics,
    QueueMetricsData,
    ReadinessResult,
    ThroughputMetrics,
    DEFAULT_LATENCY_BUCKETS,
};

// =============================================================================
// Package Version
// =============================================================================

/// Package version (matches Cargo.toml version).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

// =============================================================================
// Backward Compatible Exports (deprecated)
// =============================================================================

/// Adds two numbers together.
///
/// # Arguments
///
/// * `a` - First number
/// * `b` - Second number
///
/// # Returns
///
/// Sum of `a` and `b`
///
/// # Examples
///
/// ```
/// use links_queue::add;
/// assert_eq!(add(2, 3), 5);
/// ```
#[deprecated(since = "0.2.0", note = "Use the Link and LinkStore traits instead")]
#[must_use]
pub const fn add(a: i64, b: i64) -> i64 {
    a + b
}

/// Multiplies two numbers together.
///
/// # Arguments
///
/// * `a` - First number
/// * `b` - Second number
///
/// # Returns
///
/// Product of `a` and `b`
///
/// # Examples
///
/// ```
/// use links_queue::multiply;
/// assert_eq!(multiply(2, 3), 6);
/// ```
#[deprecated(since = "0.2.0", note = "Use the Link and LinkStore traits instead")]
#[must_use]
pub const fn multiply(a: i64, b: i64) -> i64 {
    a * b
}

/// Async delay function.
///
/// # Arguments
///
/// * `seconds` - Duration to wait in seconds
///
/// # Examples
///
/// ```
/// use links_queue::delay;
///
/// #[tokio::main]
/// async fn main() {
///     delay(0.1).await;
/// }
/// ```
#[deprecated(since = "0.2.0", note = "Will be removed in future versions")]
pub async fn delay(seconds: f64) {
    let duration = std::time::Duration::from_secs_f64(seconds);
    tokio::time::sleep(duration).await;
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod link_api_tests {
        use super::*;

        #[test]
        fn test_link_creation() {
            let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            assert_eq!(link.id, 1);
            assert_eq!(link.source_id(), 2);
            assert_eq!(link.target_id(), 3);
        }

        #[test]
        fn test_link_with_values() {
            let link = Link::with_values(
                1u64,
                LinkRef::Id(2),
                LinkRef::Id(3),
                vec![LinkRef::Id(4), LinkRef::Id(5)],
            );
            assert!(link.has_values());
        }

        #[test]
        fn test_nested_link() {
            let inner = Link::new(2u64, LinkRef::Id(3), LinkRef::Id(4));
            let outer = Link::new(1u64, LinkRef::link(inner), LinkRef::Id(5));
            assert_eq!(outer.source_id(), 2);
        }

        #[test]
        fn test_pattern_matching() {
            let pattern = LinkPattern::with_source(LinkRef::Id(2u64));
            let link1 = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let link2 = Link::new(1u64, LinkRef::Id(5), LinkRef::Id(3));
            assert!(pattern.matches(&link1));
            assert!(!pattern.matches(&link2));
        }

        #[test]
        fn test_any_pattern() {
            let pattern = LinkPattern::<u64>::new().source(Any).target(3u64);
            let link = Link::new(1u64, LinkRef::Id(999), LinkRef::Id(3));
            assert!(pattern.matches(&link));
        }
    }

    #[allow(deprecated)]
    mod backward_compat_tests {
        use super::*;

        #[test]
        fn test_add_positive_numbers() {
            assert_eq!(add(2, 3), 5);
        }

        #[test]
        fn test_add_negative_numbers() {
            assert_eq!(add(-1, -2), -3);
        }

        #[test]
        fn test_add_zero() {
            assert_eq!(add(5, 0), 5);
        }

        #[test]
        fn test_add_large_numbers() {
            assert_eq!(add(1_000_000, 2_000_000), 3_000_000);
        }

        #[test]
        fn test_multiply_positive_numbers() {
            assert_eq!(multiply(2, 3), 6);
        }

        #[test]
        fn test_multiply_by_zero() {
            assert_eq!(multiply(5, 0), 0);
        }

        #[test]
        fn test_multiply_negative_numbers() {
            assert_eq!(multiply(-2, 3), -6);
        }

        #[test]
        fn test_multiply_two_negatives() {
            assert_eq!(multiply(-2, -3), 6);
        }
    }

    mod delay_tests {
        use super::*;

        #[tokio::test]
        #[allow(deprecated)]
        async fn test_delay() {
            let start = std::time::Instant::now();
            delay(0.1).await;
            let elapsed = start.elapsed();
            assert!(elapsed.as_secs_f64() >= 0.1);
        }
    }
}
