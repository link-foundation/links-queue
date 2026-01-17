//! Cluster and Node trait definitions for links-queue multi-node operation.
//!
//! This module provides the traits for multi-node clustering, including
//! node discovery, partition management, and replication. These traits
//! establish the API contract for distributed operation, enabling both
//! `multi-memory` and `multi-stored` modes.
//!
//! # Design Goals
//!
//! - Support dynamic node discovery and health monitoring
//! - Provide partition management for horizontal scaling
//! - Enable configurable replication strategies
//! - Maintain API parity between JavaScript and Rust implementations
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::cluster::{ClusterCoordinator, ClusterNode, ClusterConfig};
//!
//! // Create coordinator with config
//! let config = ClusterConfig::new(vec!["node1:5000".into(), "node2:5000".into()]);
//! let coordinator = MyClusterCoordinator::new(config);
//!
//! // Join the cluster
//! coordinator.join(&["node1:5000", "node2:5000"]).await?;
//!
//! // Get healthy nodes
//! let healthy: Vec<_> = coordinator.get_nodes()
//!     .iter()
//!     .filter(|n| n.is_healthy())
//!     .collect();
//!
//! // Find partition owner
//! let owner = coordinator.get_partition_owner("queue:tasks:item:123");
//! ```
//!
//! # References
//!
//! - [ARCHITECTURE.md](../../../ARCHITECTURE.md) - Cluster Coordinator section
//! - [REQUIREMENTS.md](../../../REQUIREMENTS.md) - REQ-SCALE-001 through REQ-SCALE-022
//! - [ROADMAP.md](../../../ROADMAP.md) - Phase 6: Multi-Node Clustering

use std::fmt::Debug;
use std::future::Future;

use crate::{Link, LinkType};

// =============================================================================
// Node Status Types
// =============================================================================

/// Status of a cluster node.
///
/// # Variants
///
/// - `Healthy`: Node is operating normally and responsive
/// - `Suspect`: Node may be failing, awaiting confirmation
/// - `Dead`: Node has been confirmed as non-responsive
/// - `Joining`: Node is in the process of joining the cluster
/// - `Leaving`: Node is gracefully leaving the cluster
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum NodeStatus {
    /// Node is operating normally and responsive.
    Healthy,
    /// Node may be failing, awaiting confirmation.
    Suspect,
    /// Node has been confirmed as non-responsive.
    Dead,
    /// Node is in the process of joining the cluster.
    #[default]
    Joining,
    /// Node is gracefully leaving the cluster.
    Leaving,
}

impl std::fmt::Display for NodeStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Healthy => write!(f, "healthy"),
            Self::Suspect => write!(f, "suspect"),
            Self::Dead => write!(f, "dead"),
            Self::Joining => write!(f, "joining"),
            Self::Leaving => write!(f, "leaving"),
        }
    }
}

// =============================================================================
// ClusterNode Trait
// =============================================================================

/// Trait representing a node in the cluster.
///
/// A `ClusterNode` provides information about a single node in the distributed
/// system, including its identity, network address, and current health status.
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::ClusterNode;
///
/// async fn check_node<N: ClusterNode>(node: &N) -> Result<(), Box<dyn std::error::Error>> {
///     println!("Node {} at {}:{}", node.id(), node.address(), node.port());
///
///     if node.is_healthy() {
///         let latency = node.ping().await?;
///         println!("Latency: {}ms", latency);
///     }
///     Ok(())
/// }
/// ```
pub trait ClusterNode: Send + Sync + Debug + Clone {
    /// Returns the unique identifier for this node.
    ///
    /// This ID is stable across restarts and used for partition assignment.
    fn id(&self) -> &str;

    /// Returns the network address (hostname or IP) of the node.
    fn address(&self) -> &str;

    /// Returns the port number on which the node is listening.
    fn port(&self) -> u16;

    /// Returns the current status of the node.
    fn status(&self) -> NodeStatus;

    /// Sends a ping to the node and measures latency.
    ///
    /// # Returns
    ///
    /// The round-trip latency in milliseconds.
    ///
    /// # Errors
    ///
    /// Returns an error if the node is unreachable or times out.
    fn ping(&self) -> impl Future<Output = Result<u64, ClusterError>> + Send;

    /// Checks if the node is currently healthy.
    ///
    /// A node is considered healthy if its status is `NodeStatus::Healthy`.
    ///
    /// # Returns
    ///
    /// `true` if the node is healthy, `false` otherwise.
    fn is_healthy(&self) -> bool {
        self.status() == NodeStatus::Healthy
    }
}

// =============================================================================
// Cluster Event Types
// =============================================================================

/// Events emitted by the cluster coordinator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClusterEvent<N: ClusterNode> {
    /// A node has joined the cluster.
    NodeJoined(N),
    /// A node has left the cluster.
    NodeLeft(N),
    /// A node is suspected to be failing.
    NodeSuspect(N),
    /// The cluster leader has changed.
    LeaderChanged(N),
    /// Partition rebalancing has started.
    RebalanceStarted,
    /// Partition rebalancing has completed.
    RebalanceCompleted,
}

// =============================================================================
// ClusterCoordinator Trait
// =============================================================================

/// Trait for cluster coordination operations.
///
/// The `ClusterCoordinator` manages the distributed aspects of the system,
/// including node discovery, partition management, and leader election.
///
/// # Type Parameters
///
/// * `N` - The concrete `ClusterNode` type used by this coordinator
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::{ClusterCoordinator, ClusterNode};
///
/// async fn join_cluster<N, C>(coordinator: &C) -> Result<(), Box<dyn std::error::Error>>
/// where
///     N: ClusterNode,
///     C: ClusterCoordinator<N>,
/// {
///     // Join the cluster
///     coordinator.join(&["node1:5000", "node2:5000"]).await?;
///
///     // Get healthy nodes
///     let nodes = coordinator.get_nodes();
///     for node in nodes.iter().filter(|n| n.is_healthy()) {
///         println!("Healthy node: {}", node.id());
///     }
///
///     // Find partition owner
///     let owner = coordinator.get_partition_owner("queue:tasks:item:123");
///     println!("Owner: {}", owner.id());
///
///     Ok(())
/// }
/// ```
pub trait ClusterCoordinator<N: ClusterNode>: Send + Sync {
    // -------------------------------------------------------------------------
    // Node Management
    // -------------------------------------------------------------------------

    /// Joins the cluster by connecting to seed nodes.
    ///
    /// This initiates the cluster membership protocol, allowing this node
    /// to discover other nodes and participate in the cluster.
    ///
    /// # Arguments
    ///
    /// * `nodes` - List of seed node addresses (format: "host:port")
    ///
    /// # Errors
    ///
    /// Returns an error if unable to connect to any seed node.
    fn join(&self, nodes: &[&str]) -> impl Future<Output = Result<(), ClusterError>> + Send;

    /// Gracefully leaves the cluster.
    ///
    /// This notifies other nodes that this node is leaving and allows for
    /// graceful handoff of partitions and in-flight work.
    fn leave(&self) -> impl Future<Output = Result<(), ClusterError>> + Send;

    /// Returns all known nodes in the cluster.
    ///
    /// Includes nodes in all states (healthy, suspect, joining, leaving).
    /// Dead nodes are typically pruned after a configurable timeout.
    fn get_nodes(&self) -> Vec<N>;

    /// Returns the current cluster leader, if one exists.
    ///
    /// The leader is responsible for coordination tasks like partition
    /// assignment and rebalancing decisions.
    fn get_leader(&self) -> Option<N>;

    // -------------------------------------------------------------------------
    // Partition Management
    // -------------------------------------------------------------------------

    /// Determines which node owns a given partition key.
    ///
    /// The key is typically derived from the queue name and item ID.
    /// The coordinator uses consistent hashing or a similar algorithm
    /// to map keys to nodes.
    ///
    /// # Arguments
    ///
    /// * `key` - The partition key to look up
    ///
    /// # Returns
    ///
    /// The `ClusterNode` that owns this key.
    fn get_partition_owner(&self, key: &str) -> N;

    /// Triggers a rebalancing of partitions across the cluster.
    ///
    /// This is typically called automatically when nodes join or leave,
    /// but can be triggered manually for administrative purposes.
    fn rebalance(&self) -> impl Future<Output = Result<(), ClusterError>> + Send;

    // -------------------------------------------------------------------------
    // Statistics
    // -------------------------------------------------------------------------

    /// Returns statistics about the cluster state.
    fn get_stats(&self) -> ClusterStats;
}

// =============================================================================
// Replication Types
// =============================================================================

/// Synchronization mode for replication.
///
/// - `Sync`: Wait for all replicas to acknowledge before returning
/// - `Async`: Return immediately after primary write, replicate in background
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum SyncMode {
    /// Wait for all replicas to acknowledge before returning.
    Sync,
    /// Return immediately after primary write, replicate in background.
    #[default]
    Async,
}

impl std::fmt::Display for SyncMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sync => write!(f, "sync"),
            Self::Async => write!(f, "async"),
        }
    }
}

// =============================================================================
// ReplicationManager Trait
// =============================================================================

/// Trait for managing data replication across nodes.
///
/// The `ReplicationManager` ensures data durability and availability by
/// maintaining copies of links on multiple nodes.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
/// * `N` - The concrete `ClusterNode` type
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::ReplicationManager;
/// use links_queue::{Link, LinkRef};
///
/// async fn replicate_link<T, N, R>(
///     manager: &R,
///     link: Link<T>,
/// ) -> Result<(), Box<dyn std::error::Error>>
/// where
///     T: LinkType,
///     N: ClusterNode,
///     R: ReplicationManager<T, N>,
/// {
///     // Replicate the link
///     manager.replicate(&link).await?;
///
///     // Get replica nodes
///     let replicas = manager.get_replica_nodes(link.id);
///     println!("Link replicated on {} nodes", replicas.len());
///
///     // Ensure consistency
///     manager.ensure_consistency(link.id).await?;
///
///     Ok(())
/// }
/// ```
pub trait ReplicationManager<T: LinkType, N: ClusterNode>: Send + Sync {
    /// Returns the configured replication factor.
    ///
    /// This determines how many copies of each link are maintained.
    /// A factor of 1 means no replication (single copy).
    fn replication_factor(&self) -> usize;

    /// Returns the synchronization mode for replication.
    fn sync_mode(&self) -> SyncMode;

    /// Replicates a link to the configured replica nodes.
    ///
    /// In sync mode, this returns after all replicas have acknowledged.
    /// In async mode, this returns after the primary write, with replication
    /// happening in the background.
    ///
    /// # Arguments
    ///
    /// * `link` - The link to replicate
    ///
    /// # Errors
    ///
    /// Returns an error if replication fails and cannot meet the replication factor.
    fn replicate(&self, link: &Link<T>) -> impl Future<Output = Result<(), ClusterError>> + Send;

    /// Returns the nodes that hold replicas of a specific link.
    ///
    /// # Arguments
    ///
    /// * `link_id` - The ID of the link
    ///
    /// # Returns
    ///
    /// Vector of `ClusterNode`s holding replicas.
    fn get_replica_nodes(&self, link_id: T) -> Vec<N>;

    /// Ensures all replicas of a link are consistent.
    ///
    /// This performs a read-repair or active anti-entropy check to
    /// synchronize all replicas.
    ///
    /// # Arguments
    ///
    /// * `link_id` - The ID of the link to check
    ///
    /// # Errors
    ///
    /// Returns an error if consistency cannot be achieved.
    fn ensure_consistency(
        &self,
        link_id: T,
    ) -> impl Future<Output = Result<(), ClusterError>> + Send;
}

// =============================================================================
// Configuration Types
// =============================================================================

/// Discovery method for finding cluster nodes.
///
/// - `Static`: Use a fixed list of node addresses
/// - `Dns`: Discover nodes via DNS SRV records
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum DiscoveryMethod {
    /// Use a fixed list of node addresses.
    #[default]
    Static,
    /// Discover nodes via DNS SRV records.
    Dns,
}

impl std::fmt::Display for DiscoveryMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Static => write!(f, "static"),
            Self::Dns => write!(f, "dns"),
        }
    }
}

/// Configuration for replication behavior.
///
/// # Examples
///
/// ```rust
/// use links_queue::cluster::ReplicationConfig;
///
/// let config = ReplicationConfig::new(3, true)
///     .with_min_replicas(2);
/// assert_eq!(config.factor, 3);
/// assert!(config.sync);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicationConfig {
    /// Number of replicas to maintain for each link.
    /// Defaults to 1 (no replication).
    pub factor: usize,

    /// Whether to use synchronous replication.
    /// Defaults to false (async replication).
    pub sync: bool,

    /// Minimum number of replicas that must acknowledge before considering
    /// a write successful (for sync mode).
    /// Defaults to `factor`.
    pub min_replicas: Option<usize>,
}

impl ReplicationConfig {
    /// Creates a new `ReplicationConfig` with the given factor and sync mode.
    #[inline]
    #[must_use]
    pub const fn new(factor: usize, sync: bool) -> Self {
        Self {
            factor,
            sync,
            min_replicas: None,
        }
    }

    /// Sets the minimum number of replicas required for acknowledgment.
    #[inline]
    #[must_use]
    pub const fn with_min_replicas(mut self, min_replicas: usize) -> Self {
        self.min_replicas = Some(min_replicas);
        self
    }

    /// Returns the minimum replicas, defaulting to factor if not set.
    #[inline]
    #[must_use]
    pub fn min_replicas_or_default(&self) -> usize {
        self.min_replicas.unwrap_or(self.factor)
    }
}

impl Default for ReplicationConfig {
    fn default() -> Self {
        Self {
            factor: 1,
            sync: false,
            min_replicas: None,
        }
    }
}

/// Configuration for cluster operation.
///
/// This configuration controls how a node participates in the cluster,
/// including discovery, replication, and health checking.
///
/// # Examples
///
/// ```rust
/// use links_queue::cluster::{ClusterConfig, ReplicationConfig, DiscoveryMethod};
///
/// let config = ClusterConfig::new(vec![
///     "node1:5000".to_string(),
///     "node2:5000".to_string(),
/// ])
/// .with_discovery(DiscoveryMethod::Static)
/// .with_replication(ReplicationConfig::new(3, true));
///
/// assert_eq!(config.nodes.len(), 2);
/// assert_eq!(config.discovery, DiscoveryMethod::Static);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterConfig {
    /// Initial list of node addresses (format: "host:port").
    ///
    /// For static discovery, this is the complete list of nodes.
    /// For DNS discovery, these are the seed nodes for initial bootstrap.
    pub nodes: Vec<String>,

    /// Method used to discover cluster nodes.
    ///
    /// Defaults to `DiscoveryMethod::Static`.
    pub discovery: DiscoveryMethod,

    /// Replication configuration.
    ///
    /// If not provided, replication is disabled (single copy).
    pub replication: Option<ReplicationConfig>,

    /// Interval in milliseconds for health checks.
    /// Defaults to 5000ms (5 seconds).
    pub health_check_interval: u64,

    /// Timeout in milliseconds for health check pings.
    /// Defaults to 1000ms (1 second).
    pub health_check_timeout: u64,

    /// Number of failed health checks before marking a node as suspect.
    /// Defaults to 3.
    pub suspect_threshold: u32,

    /// Number of consecutive failures before marking a node as dead.
    /// Defaults to 5.
    pub dead_threshold: u32,

    /// Time in milliseconds to wait before removing a dead node from the cluster.
    /// Defaults to 300000ms (5 minutes).
    pub dead_node_removal_delay: u64,

    /// Unique identifier for this node.
    /// If not provided, a UUID will be generated.
    pub node_id: Option<String>,

    /// Address to advertise to other nodes.
    /// If not provided, the system will attempt to detect the local address.
    pub advertise_address: Option<String>,

    /// Port to advertise to other nodes.
    /// If not provided, uses the local listening port.
    pub advertise_port: Option<u16>,
}

impl ClusterConfig {
    /// Creates a new `ClusterConfig` with the given node list.
    #[inline]
    #[must_use]
    pub fn new(nodes: Vec<String>) -> Self {
        Self {
            nodes,
            discovery: DiscoveryMethod::default(),
            replication: None,
            health_check_interval: 5000,
            health_check_timeout: 1000,
            suspect_threshold: 3,
            dead_threshold: 5,
            dead_node_removal_delay: 300_000,
            node_id: None,
            advertise_address: None,
            advertise_port: None,
        }
    }

    /// Sets the discovery method.
    #[inline]
    #[must_use]
    pub const fn with_discovery(mut self, discovery: DiscoveryMethod) -> Self {
        self.discovery = discovery;
        self
    }

    /// Sets the replication configuration.
    #[inline]
    #[must_use]
    pub const fn with_replication(mut self, replication: ReplicationConfig) -> Self {
        self.replication = Some(replication);
        self
    }

    /// Sets the health check interval in milliseconds.
    #[inline]
    #[must_use]
    pub const fn with_health_check_interval(mut self, interval: u64) -> Self {
        self.health_check_interval = interval;
        self
    }

    /// Sets the health check timeout in milliseconds.
    #[inline]
    #[must_use]
    pub const fn with_health_check_timeout(mut self, timeout: u64) -> Self {
        self.health_check_timeout = timeout;
        self
    }

    /// Sets the suspect threshold.
    #[inline]
    #[must_use]
    pub const fn with_suspect_threshold(mut self, threshold: u32) -> Self {
        self.suspect_threshold = threshold;
        self
    }

    /// Sets the dead threshold.
    #[inline]
    #[must_use]
    pub const fn with_dead_threshold(mut self, threshold: u32) -> Self {
        self.dead_threshold = threshold;
        self
    }

    /// Sets the dead node removal delay in milliseconds.
    #[inline]
    #[must_use]
    pub const fn with_dead_node_removal_delay(mut self, delay: u64) -> Self {
        self.dead_node_removal_delay = delay;
        self
    }

    /// Sets the node ID.
    #[inline]
    #[must_use]
    pub fn with_node_id(mut self, node_id: String) -> Self {
        self.node_id = Some(node_id);
        self
    }

    /// Sets the advertise address.
    #[inline]
    #[must_use]
    pub fn with_advertise_address(mut self, address: String) -> Self {
        self.advertise_address = Some(address);
        self
    }

    /// Sets the advertise port.
    #[inline]
    #[must_use]
    pub const fn with_advertise_port(mut self, port: u16) -> Self {
        self.advertise_port = Some(port);
        self
    }
}

impl Default for ClusterConfig {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

// =============================================================================
// Cluster Statistics
// =============================================================================

/// Statistics about the cluster state.
///
/// # Examples
///
/// ```rust,ignore
/// let stats = coordinator.get_stats();
/// println!("Cluster: {}/{} healthy", stats.healthy_nodes, stats.total_nodes);
/// ```
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ClusterStats {
    /// Total number of known nodes.
    pub total_nodes: usize,

    /// Number of healthy nodes.
    pub healthy_nodes: usize,

    /// Number of suspect nodes.
    pub suspect_nodes: usize,

    /// Number of dead nodes (pending removal).
    pub dead_nodes: usize,

    /// Whether this node is currently the leader.
    pub is_leader: bool,

    /// Total number of partitions.
    pub total_partitions: usize,

    /// Number of partitions owned by this node.
    pub local_partitions: usize,

    /// Average replication factor across all data.
    pub average_replication_factor: f64,

    /// Number of under-replicated links.
    pub under_replicated_links: usize,

    /// Unix timestamp (milliseconds) when the node joined the cluster.
    pub joined_at: u64,

    /// Unix timestamp (milliseconds) of last successful rebalance, or 0 if never.
    pub last_rebalance_at: u64,
}

impl ClusterStats {
    /// Creates a new `ClusterStats` with default values.
    #[inline]
    #[must_use]
    pub const fn new() -> Self {
        Self {
            total_nodes: 0,
            healthy_nodes: 0,
            suspect_nodes: 0,
            dead_nodes: 0,
            is_leader: false,
            total_partitions: 0,
            local_partitions: 0,
            average_replication_factor: 0.0,
            under_replicated_links: 0,
            joined_at: 0,
            last_rebalance_at: 0,
        }
    }
}

// =============================================================================
// Error Types
// =============================================================================

/// Error codes for cluster operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClusterErrorCode {
    /// Not connected to the cluster.
    NotConnected,
    /// Already joined to a cluster.
    AlreadyJoined,
    /// Node not found.
    NodeNotFound,
    /// No leader elected.
    NoLeader,
    /// Replication failed.
    ReplicationFailed,
    /// Consistency check failed.
    ConsistencyError,
    /// Partition operation error.
    PartitionError,
    /// Network communication error.
    NetworkError,
    /// Operation timed out.
    Timeout,
}

impl std::fmt::Display for ClusterErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotConnected => write!(f, "NOT_CONNECTED"),
            Self::AlreadyJoined => write!(f, "ALREADY_JOINED"),
            Self::NodeNotFound => write!(f, "NODE_NOT_FOUND"),
            Self::NoLeader => write!(f, "NO_LEADER"),
            Self::ReplicationFailed => write!(f, "REPLICATION_FAILED"),
            Self::ConsistencyError => write!(f, "CONSISTENCY_ERROR"),
            Self::PartitionError => write!(f, "PARTITION_ERROR"),
            Self::NetworkError => write!(f, "NETWORK_ERROR"),
            Self::Timeout => write!(f, "TIMEOUT"),
        }
    }
}

/// Error returned by cluster operations.
///
/// # Examples
///
/// ```rust,ignore
/// match coordinator.join(&["node1:5000"]).await {
///     Ok(()) => println!("Joined cluster"),
///     Err(ClusterError { code: ClusterErrorCode::NetworkError, .. }) => {
///         println!("Unable to reach seed nodes");
///     }
///     Err(e) => return Err(e.into()),
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterError {
    /// The error code identifying the type of error.
    pub code: ClusterErrorCode,
    /// Human-readable error message.
    pub message: String,
}

impl ClusterError {
    /// Creates a new `ClusterError`.
    #[inline]
    pub fn new(code: ClusterErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Creates a "not connected" error.
    #[inline]
    #[must_use]
    pub fn not_connected() -> Self {
        Self::new(ClusterErrorCode::NotConnected, "Not connected to cluster")
    }

    /// Creates an "already joined" error.
    #[inline]
    #[must_use]
    pub fn already_joined() -> Self {
        Self::new(ClusterErrorCode::AlreadyJoined, "Already joined to a cluster")
    }

    /// Creates a "node not found" error.
    #[inline]
    #[must_use]
    pub fn node_not_found(node_id: &str) -> Self {
        Self::new(
            ClusterErrorCode::NodeNotFound,
            format!("Node '{node_id}' not found"),
        )
    }

    /// Creates a "no leader" error.
    #[inline]
    #[must_use]
    pub fn no_leader() -> Self {
        Self::new(ClusterErrorCode::NoLeader, "No leader elected")
    }

    /// Creates a "replication failed" error.
    #[inline]
    #[must_use]
    pub fn replication_failed(details: &str) -> Self {
        Self::new(
            ClusterErrorCode::ReplicationFailed,
            format!("Replication failed: {details}"),
        )
    }

    /// Creates a "consistency error".
    #[inline]
    #[must_use]
    pub fn consistency_error(details: &str) -> Self {
        Self::new(
            ClusterErrorCode::ConsistencyError,
            format!("Consistency check failed: {details}"),
        )
    }

    /// Creates a "network error".
    #[inline]
    #[must_use]
    pub fn network_error(details: &str) -> Self {
        Self::new(
            ClusterErrorCode::NetworkError,
            format!("Network error: {details}"),
        )
    }

    /// Creates a "timeout" error.
    #[inline]
    #[must_use]
    pub fn timeout(operation: &str) -> Self {
        Self::new(
            ClusterErrorCode::Timeout,
            format!("Operation timed out: {operation}"),
        )
    }
}

impl std::fmt::Display for ClusterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ClusterError {}

/// Result type for cluster operations.
pub type ClusterResult<T> = Result<T, ClusterError>;

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod node_status_tests {
        use super::*;

        #[test]
        fn test_node_status_display() {
            assert_eq!(format!("{}", NodeStatus::Healthy), "healthy");
            assert_eq!(format!("{}", NodeStatus::Suspect), "suspect");
            assert_eq!(format!("{}", NodeStatus::Dead), "dead");
            assert_eq!(format!("{}", NodeStatus::Joining), "joining");
            assert_eq!(format!("{}", NodeStatus::Leaving), "leaving");
        }

        #[test]
        fn test_node_status_default() {
            assert_eq!(NodeStatus::default(), NodeStatus::Joining);
        }
    }

    mod sync_mode_tests {
        use super::*;

        #[test]
        fn test_sync_mode_display() {
            assert_eq!(format!("{}", SyncMode::Sync), "sync");
            assert_eq!(format!("{}", SyncMode::Async), "async");
        }

        #[test]
        fn test_sync_mode_default() {
            assert_eq!(SyncMode::default(), SyncMode::Async);
        }
    }

    mod discovery_method_tests {
        use super::*;

        #[test]
        fn test_discovery_method_display() {
            assert_eq!(format!("{}", DiscoveryMethod::Static), "static");
            assert_eq!(format!("{}", DiscoveryMethod::Dns), "dns");
        }

        #[test]
        fn test_discovery_method_default() {
            assert_eq!(DiscoveryMethod::default(), DiscoveryMethod::Static);
        }
    }

    mod replication_config_tests {
        use super::*;

        #[test]
        fn test_replication_config_new() {
            let config = ReplicationConfig::new(3, true);
            assert_eq!(config.factor, 3);
            assert!(config.sync);
            assert!(config.min_replicas.is_none());
        }

        #[test]
        fn test_replication_config_with_min_replicas() {
            let config = ReplicationConfig::new(3, true).with_min_replicas(2);
            assert_eq!(config.min_replicas, Some(2));
            assert_eq!(config.min_replicas_or_default(), 2);
        }

        #[test]
        fn test_replication_config_default() {
            let config = ReplicationConfig::default();
            assert_eq!(config.factor, 1);
            assert!(!config.sync);
            assert_eq!(config.min_replicas_or_default(), 1);
        }
    }

    mod cluster_config_tests {
        use super::*;

        #[test]
        fn test_cluster_config_new() {
            let config = ClusterConfig::new(vec!["node1:5000".to_string()]);
            assert_eq!(config.nodes.len(), 1);
            assert_eq!(config.discovery, DiscoveryMethod::Static);
            assert!(config.replication.is_none());
        }

        #[test]
        fn test_cluster_config_builder() {
            let config = ClusterConfig::new(vec!["node1:5000".to_string()])
                .with_discovery(DiscoveryMethod::Dns)
                .with_replication(ReplicationConfig::new(3, true))
                .with_health_check_interval(10000)
                .with_health_check_timeout(2000)
                .with_suspect_threshold(5)
                .with_dead_threshold(10)
                .with_node_id("my-node".to_string())
                .with_advertise_address("192.168.1.1".to_string())
                .with_advertise_port(5001);

            assert_eq!(config.discovery, DiscoveryMethod::Dns);
            assert!(config.replication.is_some());
            assert_eq!(config.health_check_interval, 10000);
            assert_eq!(config.health_check_timeout, 2000);
            assert_eq!(config.suspect_threshold, 5);
            assert_eq!(config.dead_threshold, 10);
            assert_eq!(config.node_id, Some("my-node".to_string()));
            assert_eq!(
                config.advertise_address,
                Some("192.168.1.1".to_string())
            );
            assert_eq!(config.advertise_port, Some(5001));
        }

        #[test]
        fn test_cluster_config_default() {
            let config = ClusterConfig::default();
            assert!(config.nodes.is_empty());
            assert_eq!(config.health_check_interval, 5000);
            assert_eq!(config.health_check_timeout, 1000);
        }
    }

    mod cluster_stats_tests {
        use super::*;

        #[test]
        fn test_cluster_stats_new() {
            let stats = ClusterStats::new();
            assert_eq!(stats.total_nodes, 0);
            assert_eq!(stats.healthy_nodes, 0);
            assert!(!stats.is_leader);
        }
    }

    mod cluster_error_tests {
        use super::*;

        #[test]
        fn test_cluster_error_code_display() {
            assert_eq!(
                format!("{}", ClusterErrorCode::NotConnected),
                "NOT_CONNECTED"
            );
            assert_eq!(
                format!("{}", ClusterErrorCode::NetworkError),
                "NETWORK_ERROR"
            );
        }

        #[test]
        fn test_cluster_error_factories() {
            let err = ClusterError::not_connected();
            assert_eq!(err.code, ClusterErrorCode::NotConnected);

            let err = ClusterError::already_joined();
            assert_eq!(err.code, ClusterErrorCode::AlreadyJoined);

            let err = ClusterError::node_not_found("node-1");
            assert_eq!(err.code, ClusterErrorCode::NodeNotFound);
            assert!(err.message.contains("node-1"));

            let err = ClusterError::no_leader();
            assert_eq!(err.code, ClusterErrorCode::NoLeader);

            let err = ClusterError::replication_failed("not enough replicas");
            assert_eq!(err.code, ClusterErrorCode::ReplicationFailed);

            let err = ClusterError::network_error("connection refused");
            assert_eq!(err.code, ClusterErrorCode::NetworkError);

            let err = ClusterError::timeout("join");
            assert_eq!(err.code, ClusterErrorCode::Timeout);
        }

        #[test]
        fn test_cluster_error_display() {
            let err = ClusterError::not_connected();
            let display = format!("{err}");
            assert!(display.contains("NOT_CONNECTED"));
        }
    }
}
