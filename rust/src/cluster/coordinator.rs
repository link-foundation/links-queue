//! Cluster coordinator implementation.
//!
//! This module provides the main coordinator for managing cluster operations,
//! including node management, partition assignment, and leader election.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, RwLock};

use super::discovery::DiscoveryService;
use super::gossip::{GossipConfig, GossipProtocol};
use super::node::{LocalNode, Node};
use super::partition::PartitionManager;
use super::traits::{
    ClusterConfig, ClusterCoordinator, ClusterError, ClusterEvent, ClusterNode, ClusterStats,
};

// =============================================================================
// Default Cluster Coordinator
// =============================================================================

/// Default implementation of `ClusterCoordinator`.
///
/// Provides full cluster coordination functionality including:
/// - Node discovery and health monitoring
/// - Gossip-based membership management
/// - Consistent hashing for partition assignment
/// - Leader election (simple: lowest node ID)
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::{DefaultClusterCoordinator, ClusterConfig};
///
/// let config = ClusterConfig::new(vec![
///     "node1:5000".to_string(),
///     "node2:5000".to_string(),
/// ]);
///
/// let coordinator = DefaultClusterCoordinator::new(config, "local-node", "0.0.0.0", 5000);
/// coordinator.start().await?;
///
/// // Join the cluster
/// coordinator.join(&["node1:5000", "node2:5000"]).await?;
///
/// // Get healthy nodes
/// let nodes = coordinator.get_nodes();
/// for node in nodes.iter().filter(|n| n.is_healthy()) {
///     println!("Healthy: {}", node.id());
/// }
/// ```
pub struct DefaultClusterCoordinator {
    /// Cluster configuration.
    config: ClusterConfig,

    /// Local node representation.
    local_node: LocalNode,

    /// Discovery service.
    discovery: Arc<DiscoveryService>,

    /// Gossip protocol.
    gossip: Arc<GossipProtocol>,

    /// Partition manager.
    partitions: Arc<PartitionManager>,

    /// Event broadcaster.
    event_tx: broadcast::Sender<ClusterEvent<Node>>,

    /// Running state.
    running: AtomicBool,

    /// Joined state.
    joined: AtomicBool,

    /// Timestamp when joined.
    joined_at: AtomicU64,

    /// Timestamp of last rebalance.
    last_rebalance_at: AtomicU64,

    /// Cached stats.
    stats_cache: RwLock<ClusterStats>,
}

impl DefaultClusterCoordinator {
    /// Creates a new cluster coordinator.
    ///
    /// # Arguments
    ///
    /// * `config` - Cluster configuration
    /// * `node_id` - Unique identifier for the local node
    /// * `address` - Address to advertise to other nodes
    /// * `port` - Port to advertise to other nodes
    #[must_use]
    pub fn new(config: ClusterConfig, node_id: &str, address: &str, port: u16) -> Self {
        let local_node = LocalNode::new(Node::new(node_id, address, port));

        let discovery = Arc::new(DiscoveryService::new(config.clone()));

        let gossip_config = GossipConfig::new()
            .with_gossip_interval(config.health_check_interval)
            .with_gossip_timeout(config.health_check_timeout)
            .with_port(config.gossip_port.unwrap_or(5001));

        let gossip = Arc::new(GossipProtocol::new(
            gossip_config,
            local_node.node().clone(),
        ));

        let replication_factor = config.replication.as_ref().map(|r| r.factor).unwrap_or(1);

        let partitions = Arc::new(PartitionManager::new(256, 100, replication_factor));

        let (event_tx, _) = broadcast::channel(256);

        Self {
            config,
            local_node,
            discovery,
            gossip,
            partitions,
            event_tx,
            running: AtomicBool::new(false),
            joined: AtomicBool::new(false),
            joined_at: AtomicU64::new(0),
            last_rebalance_at: AtomicU64::new(0),
            stats_cache: RwLock::new(ClusterStats::new()),
        }
    }

    /// Creates a coordinator from configuration.
    #[must_use]
    pub fn from_config(config: ClusterConfig) -> Self {
        let node_id = config.node_id.clone().unwrap_or_else(|| uuid_v4_simple());

        let address = config
            .advertise_address
            .clone()
            .unwrap_or_else(|| "127.0.0.1".to_string());

        let port = config.advertise_port.unwrap_or(5000);

        Self::new(config, &node_id, &address, port)
    }

    /// Starts the coordinator (but does not join the cluster).
    pub async fn start(&self) -> Result<(), ClusterError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(ClusterError::already_joined());
        }

        // Start discovery service
        self.discovery.start().await?;

        // Start gossip protocol
        self.gossip.start().await?;

        // Add local node to partition manager
        self.partitions
            .add_node(self.local_node.node().clone())
            .await;

        // Mark local node as healthy
        self.local_node.mark_healthy().await;

        Ok(())
    }

    /// Stops the coordinator.
    pub async fn stop(&self) {
        // Mark as leaving
        self.local_node.mark_leaving().await;

        // Brief delay to propagate leaving status
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Stop components
        self.gossip.stop().await;
        self.discovery.stop().await;

        self.running.store(false, Ordering::SeqCst);
        self.joined.store(false, Ordering::SeqCst);
    }

    /// Returns the local node.
    #[must_use]
    pub fn local_node(&self) -> &LocalNode {
        &self.local_node
    }

    /// Returns the partition manager.
    #[must_use]
    pub fn partitions(&self) -> &PartitionManager {
        &self.partitions
    }

    /// Returns whether the coordinator is running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Returns whether the coordinator has joined a cluster.
    #[must_use]
    pub fn is_joined(&self) -> bool {
        self.joined.load(Ordering::SeqCst)
    }

    /// Subscribes to cluster events.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<ClusterEvent<Node>> {
        self.event_tx.subscribe()
    }

    /// Elects a leader based on node IDs (lowest ID wins).
    async fn elect_leader(&self) -> Option<Node> {
        let nodes = self.discovery.get_healthy_nodes().await;

        nodes
            .into_iter()
            .min_by(|a, b| a.id().cmp(b.id()))
            .map(|n| n.as_ref().clone())
    }

    /// Updates cached statistics.
    async fn update_stats(&self) {
        let counts = self.discovery.get_node_counts().await;
        let partition_stats = self.partitions.get_stats().await;
        let local_partitions = self
            .partitions
            .get_node_partitions(self.local_node.node().id())
            .await;

        let is_leader = self
            .elect_leader()
            .await
            .map(|l| l.id() == self.local_node.node().id())
            .unwrap_or(false);

        let replication_factor = self
            .config
            .replication
            .as_ref()
            .map(|r| r.factor as f64)
            .unwrap_or(1.0);

        let stats = ClusterStats {
            total_nodes: counts.total,
            healthy_nodes: counts.healthy,
            suspect_nodes: counts.suspect,
            dead_nodes: counts.dead,
            is_leader,
            total_partitions: partition_stats.partition_count,
            local_partitions: local_partitions.len(),
            average_replication_factor: replication_factor,
            under_replicated_links: 0, // Would need to track this
            joined_at: self.joined_at.load(Ordering::SeqCst),
            last_rebalance_at: self.last_rebalance_at.load(Ordering::SeqCst),
        };

        *self.stats_cache.write().await = stats;
    }
}

impl ClusterCoordinator<Node> for DefaultClusterCoordinator {
    async fn join(&self, nodes: &[&str]) -> Result<(), ClusterError> {
        if !self.is_running() {
            // Auto-start if not running
            self.start().await?;
        }

        if self.joined.swap(true, Ordering::SeqCst) {
            return Err(ClusterError::already_joined());
        }

        // Add seed nodes
        for addr in nodes {
            if let Ok(node) = Node::from_addr(addr) {
                self.discovery.add_node(node.clone()).await.ok();
                self.partitions.add_node(node.clone()).await;
                self.gossip.add_seed(addr).await.ok();
            }
        }

        // Record join time
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.joined_at.store(now, Ordering::SeqCst);

        // Update stats
        self.update_stats().await;

        Ok(())
    }

    async fn leave(&self) -> Result<(), ClusterError> {
        if !self.joined.load(Ordering::SeqCst) {
            return Err(ClusterError::not_connected());
        }

        // Mark as leaving
        self.local_node.mark_leaving().await;

        // Remove from partition manager
        self.partitions
            .remove_node(self.local_node.node().id())
            .await;

        // Trigger rebalance
        self.rebalance().await?;

        // Brief delay to propagate state
        tokio::time::sleep(Duration::from_millis(500)).await;

        self.joined.store(false, Ordering::SeqCst);

        Ok(())
    }

    fn get_nodes(&self) -> Vec<Node> {
        // Use try_read to avoid async in sync method
        // This returns empty if lock is held
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                self.discovery
                    .get_all_nodes()
                    .await
                    .into_iter()
                    .map(|n| n.as_ref().clone())
                    .collect()
            })
        })
    }

    fn get_leader(&self) -> Option<Node> {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async { self.elect_leader().await })
        })
    }

    fn get_partition_owner(&self, key: &str) -> Node {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                self.partitions
                    .get_owner(key)
                    .await
                    .map(|n| n.as_ref().clone())
                    .unwrap_or_else(|| self.local_node.node().clone())
            })
        })
    }

    async fn rebalance(&self) -> Result<(), ClusterError> {
        // Emit rebalance started event
        let _ = self.event_tx.send(ClusterEvent::RebalanceStarted);

        // Get all healthy nodes
        let healthy_nodes = self.discovery.get_healthy_nodes().await;

        // Remove dead nodes from partition manager
        let all_pm_nodes = self.partitions.get_all_nodes().await;
        for pm_node in all_pm_nodes {
            if !healthy_nodes.iter().any(|h| h.id() == pm_node.id()) {
                self.partitions.remove_node(pm_node.id()).await;
            }
        }

        // Add any missing healthy nodes
        for healthy in &healthy_nodes {
            let pm_nodes = self.partitions.get_all_nodes().await;
            if !pm_nodes.iter().any(|p| p.id() == healthy.id()) {
                self.partitions.add_node(healthy.as_ref().clone()).await;
            }
        }

        // Record rebalance time
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.last_rebalance_at.store(now, Ordering::SeqCst);

        // Update stats
        self.update_stats().await;

        // Emit rebalance completed event
        let _ = self.event_tx.send(ClusterEvent::RebalanceCompleted);

        Ok(())
    }

    fn get_stats(&self) -> ClusterStats {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(async { self.stats_cache.read().await.clone() })
        })
    }
}

impl std::fmt::Debug for DefaultClusterCoordinator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DefaultClusterCoordinator")
            .field("local_node", &self.local_node)
            .field("running", &self.running)
            .field("joined", &self.joined)
            .finish()
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Generates a simple UUID v4-like string (not cryptographically secure).
fn uuid_v4_simple() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    format!("{timestamp:032x}")
}

// =============================================================================
// Cluster Builder
// =============================================================================

/// Builder for creating a cluster coordinator.
#[derive(Debug, Default)]
pub struct ClusterBuilder {
    /// Node ID.
    node_id: Option<String>,
    /// Advertise address.
    address: Option<String>,
    /// Advertise port.
    port: Option<u16>,
    /// Seed nodes.
    seeds: Vec<String>,
    /// Replication factor.
    replication_factor: Option<usize>,
    /// Sync replication.
    sync_replication: bool,
    /// Health check interval.
    health_check_interval: Option<u64>,
}

impl ClusterBuilder {
    /// Creates a new cluster builder.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the node ID.
    #[must_use]
    pub fn node_id(mut self, id: impl Into<String>) -> Self {
        self.node_id = Some(id.into());
        self
    }

    /// Sets the advertise address.
    #[must_use]
    pub fn address(mut self, address: impl Into<String>) -> Self {
        self.address = Some(address.into());
        self
    }

    /// Sets the advertise port.
    #[must_use]
    pub const fn port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }

    /// Adds a seed node.
    #[must_use]
    pub fn seed(mut self, addr: impl Into<String>) -> Self {
        self.seeds.push(addr.into());
        self
    }

    /// Adds multiple seed nodes.
    #[must_use]
    pub fn seeds(mut self, addrs: impl IntoIterator<Item = impl Into<String>>) -> Self {
        for addr in addrs {
            self.seeds.push(addr.into());
        }
        self
    }

    /// Sets the replication factor.
    #[must_use]
    pub const fn replication_factor(mut self, factor: usize) -> Self {
        self.replication_factor = Some(factor);
        self
    }

    /// Enables synchronous replication.
    #[must_use]
    pub const fn sync_replication(mut self, sync: bool) -> Self {
        self.sync_replication = sync;
        self
    }

    /// Sets the health check interval.
    #[must_use]
    pub const fn health_check_interval(mut self, interval_ms: u64) -> Self {
        self.health_check_interval = Some(interval_ms);
        self
    }

    /// Builds the cluster coordinator.
    pub fn build(self) -> Result<DefaultClusterCoordinator, ClusterError> {
        let address = self
            .address
            .ok_or_else(|| ClusterError::network_error("Address is required"))?;

        let port = self
            .port
            .ok_or_else(|| ClusterError::network_error("Port is required"))?;

        let node_id = self.node_id.unwrap_or_else(uuid_v4_simple);

        let mut config = ClusterConfig::new(self.seeds)
            .with_node_id(node_id.clone())
            .with_advertise_address(address.clone())
            .with_advertise_port(port);

        if let Some(interval) = self.health_check_interval {
            config = config.with_health_check_interval(interval);
        }

        if let Some(factor) = self.replication_factor {
            let replication = super::traits::ReplicationConfig::new(factor, self.sync_replication);
            config = config.with_replication(replication);
        }

        Ok(DefaultClusterCoordinator::new(
            config, &node_id, &address, port,
        ))
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod default_coordinator_tests {
        use super::*;

        fn create_test_config() -> ClusterConfig {
            ClusterConfig::new(vec![])
                .with_node_id("test-node".to_string())
                .with_advertise_address("127.0.0.1".to_string())
                .with_advertise_port(5000)
                .with_gossip_port(0) // Use port 0 to let OS pick an available port
        }

        #[test]
        fn test_coordinator_new() {
            let config = create_test_config();
            let coordinator = DefaultClusterCoordinator::from_config(config);

            assert!(!coordinator.is_running());
            assert!(!coordinator.is_joined());
            assert_eq!(coordinator.local_node().node().id(), "test-node");
        }

        #[tokio::test]
        async fn test_coordinator_start() {
            let config = create_test_config();
            let coordinator = DefaultClusterCoordinator::from_config(config);

            let result = coordinator.start().await;
            assert!(result.is_ok());
            assert!(coordinator.is_running());

            coordinator.stop().await;
            assert!(!coordinator.is_running());
        }

        #[tokio::test]
        async fn test_coordinator_double_start() {
            let config = create_test_config();
            let coordinator = DefaultClusterCoordinator::from_config(config);

            coordinator.start().await.unwrap();
            let result = coordinator.start().await;
            assert!(result.is_err());

            coordinator.stop().await;
        }

        #[tokio::test]
        async fn test_coordinator_subscribe() {
            let config = create_test_config();
            let coordinator = DefaultClusterCoordinator::from_config(config);

            let _rx = coordinator.subscribe();
        }
    }

    mod cluster_builder_tests {
        use super::*;

        #[test]
        fn test_builder_basic() {
            let coordinator = ClusterBuilder::new()
                .node_id("my-node")
                .address("192.168.1.10")
                .port(5000)
                .build()
                .unwrap();

            assert_eq!(coordinator.local_node().node().id(), "my-node");
            assert_eq!(coordinator.local_node().node().address(), "192.168.1.10");
            assert_eq!(coordinator.local_node().node().port(), 5000);
        }

        #[test]
        fn test_builder_with_seeds() {
            let coordinator = ClusterBuilder::new()
                .node_id("my-node")
                .address("192.168.1.10")
                .port(5000)
                .seed("node1:5000")
                .seed("node2:5000")
                .build()
                .unwrap();

            assert!(!coordinator.is_running());
        }

        #[test]
        fn test_builder_with_replication() {
            let coordinator = ClusterBuilder::new()
                .node_id("my-node")
                .address("192.168.1.10")
                .port(5000)
                .replication_factor(3)
                .sync_replication(true)
                .build()
                .unwrap();

            assert_eq!(coordinator.partitions().replication_factor(), 3);
        }

        #[test]
        fn test_builder_missing_address() {
            let result = ClusterBuilder::new().port(5000).build();
            assert!(result.is_err());
        }

        #[test]
        fn test_builder_missing_port() {
            let result = ClusterBuilder::new().address("127.0.0.1").build();
            assert!(result.is_err());
        }
    }

    mod uuid_tests {
        use super::*;

        #[test]
        fn test_uuid_generation() {
            let id1 = uuid_v4_simple();
            let id2 = uuid_v4_simple();

            assert!(!id1.is_empty());
            // IDs should be different (with high probability)
            // Note: In very fast execution, they might be the same
            assert_ne!(id1, id2);
        }
    }
}
