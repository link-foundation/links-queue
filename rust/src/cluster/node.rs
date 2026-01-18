//! Cluster node implementation.
//!
//! This module provides the concrete implementation of `ClusterNode` trait,
//! representing a single node in the distributed cluster.

use std::fmt::Debug;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::RwLock;

use super::traits::{ClusterError, ClusterNode, NodeStatus};

// =============================================================================
// Node Implementation
// =============================================================================

/// Concrete implementation of a cluster node.
///
/// Represents a node in the cluster with its network address, health status,
/// and connection management.
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::Node;
///
/// let node = Node::new("node-1", "192.168.1.10", 5000);
/// assert_eq!(node.id(), "node-1");
/// assert_eq!(node.address(), "192.168.1.10");
/// assert_eq!(node.port(), 5000);
/// ```
#[derive(Debug)]
pub struct Node {
    /// Unique identifier for this node.
    id: String,

    /// Network address (hostname or IP).
    address: String,

    /// Port number.
    port: u16,

    /// Current node status.
    status: RwLock<NodeStatus>,

    /// Number of consecutive health check failures.
    failure_count: AtomicU32,

    /// Last successful ping time (Unix timestamp in milliseconds).
    last_ping_at: AtomicU64,

    /// Last measured latency in microseconds.
    last_latency_us: AtomicU64,

    /// Metadata about this node.
    metadata: RwLock<NodeMetadata>,
}

/// Metadata about a cluster node.
#[derive(Debug, Clone, Default)]
pub struct NodeMetadata {
    /// Node's advertised capabilities.
    pub capabilities: Vec<String>,

    /// Node version.
    pub version: Option<String>,

    /// Additional key-value metadata.
    pub tags: std::collections::HashMap<String, String>,

    /// Unix timestamp when the node joined the cluster.
    pub joined_at: u64,

    /// Number of partitions owned by this node.
    pub partition_count: usize,
}

impl Node {
    /// Creates a new node with the given ID, address, and port.
    #[must_use]
    pub fn new(id: impl Into<String>, address: impl Into<String>, port: u16) -> Self {
        Self {
            id: id.into(),
            address: address.into(),
            port,
            status: RwLock::new(NodeStatus::Joining),
            failure_count: AtomicU32::new(0),
            last_ping_at: AtomicU64::new(0),
            last_latency_us: AtomicU64::new(0),
            metadata: RwLock::new(NodeMetadata::default()),
        }
    }

    /// Creates a node from a socket address string (e.g., "192.168.1.10:5000").
    ///
    /// The node ID will be generated from the address.
    pub fn from_addr(addr: &str) -> Result<Self, ClusterError> {
        let parts: Vec<&str> = addr.split(':').collect();
        if parts.len() != 2 {
            return Err(ClusterError::network_error(&format!(
                "Invalid address format: {addr}"
            )));
        }

        let address = parts[0].to_string();
        let port: u16 = parts[1].parse().map_err(|_| {
            ClusterError::network_error(&format!("Invalid port in address: {addr}"))
        })?;

        // Generate ID from address
        let id = format!("{address}:{port}");

        Ok(Self::new(id, address, port))
    }

    /// Creates a node from a `SocketAddr`.
    #[must_use]
    pub fn from_socket_addr(addr: SocketAddr) -> Self {
        let id = addr.to_string();
        let address = addr.ip().to_string();
        let port = addr.port();
        Self::new(id, address, port)
    }

    /// Sets the node ID.
    #[must_use]
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }

    /// Sets the initial node status.
    pub async fn set_status(&self, status: NodeStatus) {
        *self.status.write().await = status;
    }

    /// Increments the failure count and returns the new count.
    pub fn increment_failures(&self) -> u32 {
        self.failure_count.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Resets the failure count to zero.
    pub fn reset_failures(&self) {
        self.failure_count.store(0, Ordering::SeqCst);
    }

    /// Returns the current failure count.
    #[must_use]
    pub fn failure_count(&self) -> u32 {
        self.failure_count.load(Ordering::SeqCst)
    }

    /// Updates the last ping timestamp.
    pub fn update_ping_time(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.last_ping_at.store(now, Ordering::SeqCst);
    }

    /// Returns the last ping timestamp.
    #[must_use]
    pub fn last_ping_at(&self) -> u64 {
        self.last_ping_at.load(Ordering::SeqCst)
    }

    /// Updates the last measured latency.
    pub fn update_latency(&self, latency: Duration) {
        self.last_latency_us
            .store(latency.as_micros() as u64, Ordering::SeqCst);
    }

    /// Returns the last measured latency.
    #[must_use]
    pub fn last_latency(&self) -> Duration {
        Duration::from_micros(self.last_latency_us.load(Ordering::SeqCst))
    }

    /// Returns a reference to the node metadata.
    pub async fn metadata(&self) -> NodeMetadata {
        self.metadata.read().await.clone()
    }

    /// Updates the node metadata.
    pub async fn set_metadata(&self, metadata: NodeMetadata) {
        *self.metadata.write().await = metadata;
    }

    /// Returns the socket address for this node.
    pub fn socket_addr(&self) -> Result<SocketAddr, ClusterError> {
        let addr_str = format!("{}:{}", self.address, self.port);
        addr_str.parse().map_err(|_| {
            ClusterError::network_error(&format!("Invalid socket address: {addr_str}"))
        })
    }

    /// Attempts to connect to this node.
    pub async fn connect(&self, timeout: Duration) -> Result<TcpStream, ClusterError> {
        let addr = self.socket_addr()?;

        tokio::time::timeout(timeout, TcpStream::connect(addr))
            .await
            .map_err(|_| ClusterError::timeout("connect"))?
            .map_err(|e| ClusterError::network_error(&e.to_string()))
    }

    /// Performs a health check ping to this node.
    ///
    /// Returns the round-trip latency in milliseconds.
    pub async fn health_check(&self, timeout: Duration) -> Result<u64, ClusterError> {
        let start = Instant::now();

        // Connect to the node
        let mut stream = self.connect(timeout).await?;

        // Send a ping message (simple protocol: "PING\n")
        let ping_msg = b"PING\n";
        stream
            .write_all(ping_msg)
            .await
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        // Read the response (expect "PONG\n")
        let mut buf = [0u8; 5];
        tokio::time::timeout(timeout, stream.read_exact(&mut buf))
            .await
            .map_err(|_| ClusterError::timeout("ping response"))?
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        if &buf != b"PONG\n" {
            return Err(ClusterError::network_error("Invalid ping response"));
        }

        let latency = start.elapsed();
        self.update_latency(latency);
        self.update_ping_time();
        self.reset_failures();

        Ok(latency.as_millis() as u64)
    }
}

impl Clone for Node {
    fn clone(&self) -> Self {
        // Note: We create a new node with the same identity but fresh state
        // This is intentional for the ClusterNode trait which requires Clone
        Self {
            id: self.id.clone(),
            address: self.address.clone(),
            port: self.port,
            status: RwLock::new(NodeStatus::Joining),
            failure_count: AtomicU32::new(self.failure_count.load(Ordering::SeqCst)),
            last_ping_at: AtomicU64::new(self.last_ping_at.load(Ordering::SeqCst)),
            last_latency_us: AtomicU64::new(self.last_latency_us.load(Ordering::SeqCst)),
            metadata: RwLock::new(NodeMetadata::default()),
        }
    }
}

impl PartialEq for Node {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for Node {}

impl std::hash::Hash for Node {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl ClusterNode for Node {
    fn id(&self) -> &str {
        &self.id
    }

    fn address(&self) -> &str {
        &self.address
    }

    fn port(&self) -> u16 {
        self.port
    }

    fn status(&self) -> NodeStatus {
        // Use try_read to avoid blocking, default to Joining if locked
        self.status
            .try_read()
            .map(|s| *s)
            .unwrap_or(NodeStatus::Joining)
    }

    async fn ping(&self) -> Result<u64, ClusterError> {
        self.health_check(Duration::from_secs(5)).await
    }
}

// =============================================================================
// Node Builder
// =============================================================================

/// Builder for creating nodes with custom configuration.
#[derive(Debug, Default)]
pub struct NodeBuilder {
    id: Option<String>,
    address: Option<String>,
    port: Option<u16>,
    status: NodeStatus,
    metadata: NodeMetadata,
}

impl NodeBuilder {
    /// Creates a new node builder.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the node ID.
    #[must_use]
    pub fn id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Sets the node address.
    #[must_use]
    pub fn address(mut self, address: impl Into<String>) -> Self {
        self.address = Some(address.into());
        self
    }

    /// Sets the node port.
    #[must_use]
    pub const fn port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }

    /// Sets the initial status.
    #[must_use]
    pub const fn status(mut self, status: NodeStatus) -> Self {
        self.status = status;
        self
    }

    /// Sets the node version.
    #[must_use]
    pub fn version(mut self, version: impl Into<String>) -> Self {
        self.metadata.version = Some(version.into());
        self
    }

    /// Adds a capability.
    #[must_use]
    pub fn capability(mut self, capability: impl Into<String>) -> Self {
        self.metadata.capabilities.push(capability.into());
        self
    }

    /// Adds a tag.
    #[must_use]
    pub fn tag(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.tags.insert(key.into(), value.into());
        self
    }

    /// Builds the node.
    ///
    /// # Errors
    ///
    /// Returns an error if address or port are not set.
    pub fn build(self) -> Result<Node, ClusterError> {
        let address = self
            .address
            .ok_or_else(|| ClusterError::network_error("Node address is required"))?;

        let port = self
            .port
            .ok_or_else(|| ClusterError::network_error("Node port is required"))?;

        let id = self.id.unwrap_or_else(|| format!("{address}:{port}"));

        let node = Node::new(id, address, port);

        // Set status synchronously using the blocking API
        // Since this is a new node, no one else can be accessing it
        *node.status.blocking_write() = self.status;
        *node.metadata.blocking_write() = self.metadata;

        Ok(node)
    }
}

// =============================================================================
// Local Node
// =============================================================================

/// Represents the local node in the cluster.
///
/// This is a special node that represents "this" node in the cluster,
/// with additional functionality for managing local state.
#[derive(Debug)]
pub struct LocalNode {
    /// The underlying node.
    inner: Arc<Node>,

    /// Whether this node is the cluster leader.
    is_leader: std::sync::atomic::AtomicBool,

    /// Start time of this node.
    started_at: Instant,
}

impl LocalNode {
    /// Creates a new local node.
    #[must_use]
    pub fn new(node: Node) -> Self {
        Self {
            inner: Arc::new(node),
            is_leader: std::sync::atomic::AtomicBool::new(false),
            started_at: Instant::now(),
        }
    }

    /// Returns a reference to the inner node.
    #[must_use]
    pub fn node(&self) -> &Node {
        &self.inner
    }

    /// Returns an `Arc` to the inner node.
    #[must_use]
    pub fn node_arc(&self) -> Arc<Node> {
        Arc::clone(&self.inner)
    }

    /// Returns whether this node is the cluster leader.
    #[must_use]
    pub fn is_leader(&self) -> bool {
        self.is_leader.load(Ordering::SeqCst)
    }

    /// Sets the leader status.
    pub fn set_leader(&self, is_leader: bool) {
        self.is_leader.store(is_leader, Ordering::SeqCst);
    }

    /// Returns how long this node has been running.
    #[must_use]
    pub fn uptime(&self) -> Duration {
        self.started_at.elapsed()
    }

    /// Marks this node as healthy.
    pub async fn mark_healthy(&self) {
        self.inner.set_status(NodeStatus::Healthy).await;
    }

    /// Marks this node as leaving.
    pub async fn mark_leaving(&self) {
        self.inner.set_status(NodeStatus::Leaving).await;
    }
}

impl Clone for LocalNode {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            is_leader: std::sync::atomic::AtomicBool::new(self.is_leader.load(Ordering::SeqCst)),
            started_at: self.started_at,
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod node_tests {
        use super::*;

        #[test]
        fn test_node_new() {
            let node = Node::new("node-1", "192.168.1.10", 5000);
            assert_eq!(node.id(), "node-1");
            assert_eq!(node.address(), "192.168.1.10");
            assert_eq!(node.port(), 5000);
        }

        #[test]
        fn test_node_from_addr() {
            let node = Node::from_addr("192.168.1.10:5000").unwrap();
            assert_eq!(node.address(), "192.168.1.10");
            assert_eq!(node.port(), 5000);
        }

        #[test]
        fn test_node_from_addr_invalid() {
            assert!(Node::from_addr("invalid").is_err());
            assert!(Node::from_addr("192.168.1.10").is_err());
            assert!(Node::from_addr("192.168.1.10:abc").is_err());
        }

        #[test]
        fn test_node_socket_addr() {
            let node = Node::new("node-1", "127.0.0.1", 5000);
            let addr = node.socket_addr().unwrap();
            assert_eq!(addr.to_string(), "127.0.0.1:5000");
        }

        #[test]
        fn test_node_failure_count() {
            let node = Node::new("node-1", "127.0.0.1", 5000);
            assert_eq!(node.failure_count(), 0);

            assert_eq!(node.increment_failures(), 1);
            assert_eq!(node.increment_failures(), 2);
            assert_eq!(node.failure_count(), 2);

            node.reset_failures();
            assert_eq!(node.failure_count(), 0);
        }

        #[test]
        fn test_node_clone() {
            let node = Node::new("node-1", "127.0.0.1", 5000);
            node.increment_failures();
            node.increment_failures();

            let cloned = node.clone();
            assert_eq!(cloned.id(), node.id());
            assert_eq!(cloned.address(), node.address());
            assert_eq!(cloned.port(), node.port());
            assert_eq!(cloned.failure_count(), 2);
        }

        #[test]
        fn test_node_equality() {
            let node1 = Node::new("node-1", "127.0.0.1", 5000);
            let node2 = Node::new("node-1", "192.168.1.1", 6000);
            let node3 = Node::new("node-2", "127.0.0.1", 5000);

            assert_eq!(node1, node2); // Same ID
            assert_ne!(node1, node3); // Different ID
        }

        #[tokio::test]
        async fn test_node_status() {
            let node = Node::new("node-1", "127.0.0.1", 5000);
            assert_eq!(node.status(), NodeStatus::Joining);

            node.set_status(NodeStatus::Healthy).await;
            assert_eq!(node.status(), NodeStatus::Healthy);

            node.set_status(NodeStatus::Dead).await;
            assert_eq!(node.status(), NodeStatus::Dead);
        }

        #[test]
        fn test_node_latency() {
            let node = Node::new("node-1", "127.0.0.1", 5000);
            assert_eq!(node.last_latency(), Duration::ZERO);

            node.update_latency(Duration::from_millis(50));
            assert_eq!(node.last_latency(), Duration::from_micros(50000));
        }
    }

    mod node_builder_tests {
        use super::*;

        #[test]
        fn test_builder_basic() {
            let node = NodeBuilder::new()
                .address("127.0.0.1")
                .port(5000)
                .build()
                .unwrap();

            assert_eq!(node.id(), "127.0.0.1:5000");
            assert_eq!(node.address(), "127.0.0.1");
            assert_eq!(node.port(), 5000);
        }

        #[test]
        fn test_builder_with_id() {
            let node = NodeBuilder::new()
                .id("custom-id")
                .address("127.0.0.1")
                .port(5000)
                .build()
                .unwrap();

            assert_eq!(node.id(), "custom-id");
        }

        #[test]
        fn test_builder_with_status() {
            let node = NodeBuilder::new()
                .address("127.0.0.1")
                .port(5000)
                .status(NodeStatus::Healthy)
                .build()
                .unwrap();

            assert_eq!(node.status(), NodeStatus::Healthy);
        }

        #[test]
        fn test_builder_missing_address() {
            let result = NodeBuilder::new().port(5000).build();
            assert!(result.is_err());
        }

        #[test]
        fn test_builder_missing_port() {
            let result = NodeBuilder::new().address("127.0.0.1").build();
            assert!(result.is_err());
        }
    }

    mod local_node_tests {
        use super::*;

        #[test]
        fn test_local_node_new() {
            let node = Node::new("local", "127.0.0.1", 5000);
            let local = LocalNode::new(node);

            assert_eq!(local.node().id(), "local");
            assert!(!local.is_leader());
        }

        #[test]
        fn test_local_node_leader() {
            let node = Node::new("local", "127.0.0.1", 5000);
            let local = LocalNode::new(node);

            assert!(!local.is_leader());
            local.set_leader(true);
            assert!(local.is_leader());
            local.set_leader(false);
            assert!(!local.is_leader());
        }

        #[test]
        fn test_local_node_uptime() {
            let node = Node::new("local", "127.0.0.1", 5000);
            let local = LocalNode::new(node);

            let uptime = local.uptime();
            assert!(uptime.as_nanos() > 0);
        }

        #[tokio::test]
        async fn test_local_node_mark_healthy() {
            let node = Node::new("local", "127.0.0.1", 5000);
            let local = LocalNode::new(node);

            local.mark_healthy().await;
            assert_eq!(local.node().status(), NodeStatus::Healthy);
        }

        #[tokio::test]
        async fn test_local_node_mark_leaving() {
            let node = Node::new("local", "127.0.0.1", 5000);
            let local = LocalNode::new(node);

            local.mark_leaving().await;
            assert_eq!(local.node().status(), NodeStatus::Leaving);
        }
    }
}
