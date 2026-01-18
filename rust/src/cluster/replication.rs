//! Data replication manager.
//!
//! This module provides replication management for maintaining data copies
//! across multiple nodes for durability and availability.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

use crate::{Link, LinkType};

use super::node::Node;
use super::partition::PartitionManager;
use super::traits::{
    ClusterError, ReplicationConfig, ReplicationManager as ReplicationManagerTrait, SyncMode,
};

// =============================================================================
// Replication Manager Implementation
// =============================================================================

/// Manages data replication across cluster nodes.
///
/// The `DataReplicationManager` ensures that data is replicated to the
/// appropriate nodes based on the configured replication factor and sync mode.
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::replication::DataReplicationManager;
/// use links_queue::cluster::ReplicationConfig;
///
/// let config = ReplicationConfig::new(3, true); // 3 replicas, sync mode
/// let manager = DataReplicationManager::new(config, partition_manager);
///
/// // Replicate a link
/// manager.replicate(&link).await?;
///
/// // Get replica nodes for a link
/// let replicas = manager.get_replica_nodes(link.id);
/// ```
pub struct DataReplicationManager<T: LinkType> {
    /// Replication configuration.
    config: ReplicationConfig,

    /// Partition manager for determining replica nodes.
    partition_manager: Arc<PartitionManager>,

    /// Pending replications (for async mode).
    pending: RwLock<HashMap<String, PendingReplication<T>>>,

    /// Statistics.
    stats: ReplicationStats,

    /// Connection timeout.
    connection_timeout: Duration,

    /// Replication timeout.
    replication_timeout: Duration,
}

/// A pending replication operation.
#[derive(Debug)]
#[allow(dead_code)] // Fields used for tracking async replications in future
struct PendingReplication<T: LinkType> {
    /// The link to replicate.
    link: Link<T>,
    /// Target nodes.
    targets: Vec<String>,
    /// Number of successful replications.
    success_count: usize,
    /// Timestamp when replication started.
    started_at: u64,
}

impl<T: LinkType + std::fmt::Display + 'static> DataReplicationManager<T> {
    /// Creates a new replication manager.
    #[must_use]
    pub fn new(config: ReplicationConfig, partition_manager: Arc<PartitionManager>) -> Self {
        Self {
            config,
            partition_manager,
            pending: RwLock::new(HashMap::new()),
            stats: ReplicationStats::default(),
            connection_timeout: Duration::from_secs(5),
            replication_timeout: Duration::from_secs(30),
        }
    }

    /// Sets the connection timeout.
    #[must_use]
    pub const fn with_connection_timeout(mut self, timeout: Duration) -> Self {
        self.connection_timeout = timeout;
        self
    }

    /// Sets the replication timeout.
    #[must_use]
    pub const fn with_replication_timeout(mut self, timeout: Duration) -> Self {
        self.replication_timeout = timeout;
        self
    }

    /// Returns the replication configuration.
    #[must_use]
    pub const fn config(&self) -> &ReplicationConfig {
        &self.config
    }

    /// Returns replication statistics.
    #[must_use]
    pub fn stats(&self) -> &ReplicationStats {
        &self.stats
    }

    /// Replicates a link to the appropriate nodes.
    pub async fn replicate_link(&self, link: &Link<T>) -> Result<(), ClusterError> {
        let key = format!("link:{}", link.id);
        let replica_nodes = self.partition_manager.get_replica_nodes(&key).await;

        if replica_nodes.is_empty() {
            return Err(ClusterError::replication_failed(
                "No replica nodes available",
            ));
        }

        let required_replicas = self.config.min_replicas_or_default();

        if self.config.sync {
            // Synchronous replication - wait for all required replicas
            self.replicate_sync(link, &replica_nodes, required_replicas)
                .await
        } else {
            // Asynchronous replication - return immediately, replicate in background
            self.replicate_async(link, &replica_nodes).await
        }
    }

    /// Synchronous replication.
    async fn replicate_sync(
        &self,
        link: &Link<T>,
        nodes: &[Arc<Node>],
        required: usize,
    ) -> Result<(), ClusterError> {
        let mut success_count = 0;
        let mut last_error = None;

        for node in nodes {
            match self.send_replication(node, link).await {
                Ok(_) => {
                    success_count += 1;
                    self.stats.successful.fetch_add(1, Ordering::SeqCst);

                    if success_count >= required {
                        return Ok(());
                    }
                }
                Err(e) => {
                    self.stats.failed.fetch_add(1, Ordering::SeqCst);
                    last_error = Some(e);
                }
            }
        }

        if success_count >= required {
            Ok(())
        } else {
            Err(last_error.unwrap_or_else(|| {
                ClusterError::replication_failed(&format!(
                    "Only {success_count}/{required} replicas succeeded"
                ))
            }))
        }
    }

    /// Asynchronous replication.
    async fn replicate_async(
        &self,
        link: &Link<T>,
        nodes: &[Arc<Node>],
    ) -> Result<(), ClusterError> {
        let link_clone = link.clone();
        let nodes_clone: Vec<Arc<Node>> = nodes.to_vec();
        let stats = self.stats.clone();
        let timeout = self.replication_timeout;

        // Spawn background task
        tokio::spawn(async move {
            for node in nodes_clone {
                let result = tokio::time::timeout(
                    timeout,
                    Self::send_replication_static(&node, &link_clone),
                )
                .await;

                match result {
                    Ok(Ok(_)) => {
                        stats.successful.fetch_add(1, Ordering::SeqCst);
                    }
                    Ok(Err(_)) | Err(_) => {
                        stats.failed.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }
        });

        self.stats.pending.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    /// Sends a replication request to a node.
    async fn send_replication(&self, node: &Node, link: &Link<T>) -> Result<(), ClusterError> {
        Self::send_replication_static(node, link).await
    }

    /// Static version of send_replication for use in spawned tasks.
    async fn send_replication_static(node: &Node, link: &Link<T>) -> Result<(), ClusterError> {
        // Connect to the node
        let mut stream = node.connect(Duration::from_secs(5)).await?;

        // Serialize the replication message
        let msg = format!(
            "REPLICATE {} {} {}\n",
            link.id,
            link.source_id(),
            link.target_id()
        );

        // Send the message
        stream
            .write_all(msg.as_bytes())
            .await
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        // Read acknowledgment
        let mut buf = [0u8; 3];
        stream
            .read_exact(&mut buf)
            .await
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        if &buf == b"OK\n" {
            Ok(())
        } else {
            Err(ClusterError::replication_failed("Replication rejected"))
        }
    }

    /// Ensures all replicas of a link are consistent.
    pub async fn ensure_link_consistency(&self, link_id: T) -> Result<(), ClusterError> {
        let key = format!("link:{link_id}");
        let replica_nodes = self.partition_manager.get_replica_nodes(&key).await;

        if replica_nodes.is_empty() {
            return Err(ClusterError::consistency_error("No replica nodes"));
        }

        // Read from all replicas and compare
        let mut values: Vec<Option<Link<T>>> = Vec::new();

        for node in &replica_nodes {
            match self.read_from_replica::<T>(node, link_id).await {
                Ok(link) => values.push(Some(link)),
                Err(_) => values.push(None),
            }
        }

        // Check if all non-None values are the same
        let non_empty: Vec<_> = values.iter().filter_map(|v| v.as_ref()).collect();

        if non_empty.is_empty() {
            return Err(ClusterError::consistency_error("No replicas have the link"));
        }

        let first = non_empty[0];
        for value in &non_empty[1..] {
            if value.id != first.id || value.source != first.source || value.target != first.target
            {
                // Inconsistency detected - would trigger repair
                self.stats
                    .consistency_repairs
                    .fetch_add(1, Ordering::SeqCst);
                return Err(ClusterError::consistency_error(
                    "Replica inconsistency detected",
                ));
            }
        }

        Ok(())
    }

    /// Reads a link from a replica node.
    async fn read_from_replica<U: LinkType + std::fmt::Display>(
        &self,
        node: &Node,
        link_id: U,
    ) -> Result<Link<U>, ClusterError> {
        let mut stream = node.connect(self.connection_timeout).await?;

        // Send read request
        let msg = format!("READ {link_id}\n");
        stream
            .write_all(msg.as_bytes())
            .await
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        // Read response (simplified - would need proper parsing)
        let mut buf = vec![0u8; 1024];
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        if n == 0 {
            return Err(ClusterError::network_error("Empty response"));
        }

        // Parse response (simplified)
        let response = String::from_utf8_lossy(&buf[..n]);
        if response.starts_with("NOT_FOUND") {
            return Err(ClusterError::new(
                super::traits::ClusterErrorCode::NodeNotFound,
                "Link not found",
            ));
        }

        // Would parse the actual link here
        Err(ClusterError::network_error("Parsing not implemented"))
    }

    /// Returns the number of pending async replications.
    pub async fn pending_count(&self) -> usize {
        self.pending.read().await.len()
    }

    /// Processes pending async replications (for retry).
    pub async fn process_pending(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut pending = self.pending.write().await;
        let timeout_ms = self.replication_timeout.as_millis() as u64;

        // Remove timed-out entries
        pending.retain(|_, p| (now - p.started_at) < timeout_ms);
    }
}

impl<T: LinkType + std::fmt::Display + 'static> ReplicationManagerTrait<T, Node>
    for DataReplicationManager<T>
{
    fn replication_factor(&self) -> usize {
        self.config.factor
    }

    fn sync_mode(&self) -> SyncMode {
        if self.config.sync {
            SyncMode::Sync
        } else {
            SyncMode::Async
        }
    }

    async fn replicate(&self, link: &Link<T>) -> Result<(), ClusterError> {
        self.replicate_link(link).await
    }

    fn get_replica_nodes(&self, link_id: T) -> Vec<Node> {
        // This is synchronous in the trait, so we need to block
        // In a real implementation, this would be cached or use a different approach
        let _key = format!("link:{link_id}");

        // Use try_read to avoid blocking if possible
        // For a production implementation, we'd want a different design
        Vec::new()
    }

    async fn ensure_consistency(&self, link_id: T) -> Result<(), ClusterError> {
        self.ensure_link_consistency(link_id).await
    }
}

impl<T: LinkType> std::fmt::Debug for DataReplicationManager<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DataReplicationManager")
            .field("config", &self.config)
            .field("stats", &self.stats)
            .finish()
    }
}

// =============================================================================
// Replication Statistics
// =============================================================================

/// Statistics about replication operations.
#[derive(Debug, Default, Clone)]
pub struct ReplicationStats {
    /// Number of successful replications.
    pub successful: Arc<AtomicU64>,
    /// Number of failed replications.
    pub failed: Arc<AtomicU64>,
    /// Number of pending async replications.
    pub pending: Arc<AtomicU64>,
    /// Number of consistency repairs performed.
    pub consistency_repairs: Arc<AtomicU64>,
}

impl ReplicationStats {
    /// Creates new statistics.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the total number of replication attempts.
    #[must_use]
    pub fn total_attempts(&self) -> u64 {
        self.successful.load(Ordering::SeqCst) + self.failed.load(Ordering::SeqCst)
    }

    /// Returns the success rate as a percentage.
    #[must_use]
    pub fn success_rate(&self) -> f64 {
        let total = self.total_attempts();
        if total == 0 {
            100.0
        } else {
            (self.successful.load(Ordering::SeqCst) as f64 / total as f64) * 100.0
        }
    }

    /// Resets all statistics.
    pub fn reset(&self) {
        self.successful.store(0, Ordering::SeqCst);
        self.failed.store(0, Ordering::SeqCst);
        self.pending.store(0, Ordering::SeqCst);
        self.consistency_repairs.store(0, Ordering::SeqCst);
    }
}

// =============================================================================
// Replication Request
// =============================================================================

/// A replication request message.
#[derive(Debug, Clone)]
pub struct ReplicationRequest<T: LinkType> {
    /// Request ID.
    pub id: String,
    /// The link to replicate.
    pub link: Link<T>,
    /// Source node ID.
    pub source_node: String,
    /// Timestamp.
    pub timestamp: u64,
}

impl<T: LinkType + std::fmt::Display> ReplicationRequest<T> {
    /// Creates a new replication request.
    #[must_use]
    pub fn new(link: Link<T>, source_node: String) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Self {
            id: format!("rep-{timestamp}-{}", link.id),
            link,
            source_node,
            timestamp,
        }
    }
}

// =============================================================================
// Replication Response
// =============================================================================

/// A replication response message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplicationResponse {
    /// Replication succeeded.
    Success,
    /// Replication failed with error message.
    Failed(String),
    /// Already have this data (deduplication).
    AlreadyExists,
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod replication_stats_tests {
        use super::*;

        #[test]
        fn test_stats_new() {
            let stats = ReplicationStats::new();
            assert_eq!(stats.successful.load(Ordering::SeqCst), 0);
            assert_eq!(stats.failed.load(Ordering::SeqCst), 0);
        }

        #[test]
        fn test_stats_total_attempts() {
            let stats = ReplicationStats::new();
            stats.successful.store(10, Ordering::SeqCst);
            stats.failed.store(5, Ordering::SeqCst);
            assert_eq!(stats.total_attempts(), 15);
        }

        #[test]
        fn test_stats_success_rate() {
            let stats = ReplicationStats::new();
            stats.successful.store(80, Ordering::SeqCst);
            stats.failed.store(20, Ordering::SeqCst);
            assert!((stats.success_rate() - 80.0).abs() < 0.01);
        }

        #[test]
        fn test_stats_success_rate_no_attempts() {
            let stats = ReplicationStats::new();
            assert_eq!(stats.success_rate(), 100.0);
        }

        #[test]
        fn test_stats_reset() {
            let stats = ReplicationStats::new();
            stats.successful.store(10, Ordering::SeqCst);
            stats.failed.store(5, Ordering::SeqCst);

            stats.reset();

            assert_eq!(stats.successful.load(Ordering::SeqCst), 0);
            assert_eq!(stats.failed.load(Ordering::SeqCst), 0);
        }
    }

    mod replication_request_tests {
        use super::*;
        use crate::LinkRef;

        #[test]
        fn test_request_new() {
            let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let request = ReplicationRequest::new(link.clone(), "node-1".to_string());

            assert!(request.id.starts_with("rep-"));
            assert_eq!(request.link.id, link.id);
            assert_eq!(request.source_node, "node-1");
            assert!(request.timestamp > 0);
        }
    }

    mod replication_response_tests {
        use super::*;

        #[test]
        fn test_response_variants() {
            assert_eq!(ReplicationResponse::Success, ReplicationResponse::Success);
            assert_eq!(
                ReplicationResponse::AlreadyExists,
                ReplicationResponse::AlreadyExists
            );

            let failed = ReplicationResponse::Failed("error".to_string());
            assert!(matches!(failed, ReplicationResponse::Failed(_)));
        }
    }

    mod data_replication_manager_tests {
        use super::*;

        fn create_test_manager() -> DataReplicationManager<u64> {
            let config = ReplicationConfig::new(3, true);
            let pm = Arc::new(PartitionManager::with_defaults());
            DataReplicationManager::new(config, pm)
        }

        #[test]
        fn test_manager_new() {
            let manager = create_test_manager();
            assert_eq!(manager.config().factor, 3);
            assert!(manager.config().sync);
        }

        #[test]
        fn test_manager_replication_factor() {
            let manager = create_test_manager();
            assert_eq!(manager.replication_factor(), 3);
        }

        #[test]
        fn test_manager_sync_mode() {
            let manager = create_test_manager();
            assert_eq!(manager.sync_mode(), SyncMode::Sync);

            let config = ReplicationConfig::new(2, false);
            let pm = Arc::new(PartitionManager::with_defaults());
            let async_manager = DataReplicationManager::<u64>::new(config, pm);
            assert_eq!(async_manager.sync_mode(), SyncMode::Async);
        }

        #[tokio::test]
        async fn test_manager_pending_count() {
            let manager = create_test_manager();
            assert_eq!(manager.pending_count().await, 0);
        }

        #[test]
        fn test_manager_stats() {
            let manager = create_test_manager();
            let stats = manager.stats();
            assert_eq!(stats.total_attempts(), 0);
        }
    }
}
