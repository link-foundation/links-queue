//! Node discovery implementation.
//!
//! This module provides mechanisms for discovering and monitoring cluster nodes.
//! It supports static node lists and health monitoring with automatic status updates.

// Allow holding RwLock guards across loop iterations for batch operations.
// Allow intentional casts for timestamp conversions.
#![allow(clippy::significant_drop_tightening)]
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::missing_fields_in_debug)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;

use super::node::Node;
use super::traits::{
    ClusterConfig, ClusterError, ClusterEvent, ClusterNode, DiscoveryMethod, NodeStatus,
};

// =============================================================================
// Discovery Service
// =============================================================================

/// Service for discovering and monitoring cluster nodes.
///
/// The discovery service maintains a registry of known nodes and performs
/// periodic health checks to update node statuses.
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::discovery::DiscoveryService;
/// use links_queue::cluster::ClusterConfig;
///
/// let config = ClusterConfig::new(vec![
///     "node1:5000".to_string(),
///     "node2:5000".to_string(),
/// ]);
///
/// let discovery = DiscoveryService::new(config);
/// discovery.start().await?;
///
/// let nodes = discovery.get_healthy_nodes().await;
/// ```
pub struct DiscoveryService {
    /// Configuration for the discovery service.
    config: ClusterConfig,

    /// Registry of known nodes.
    nodes: Arc<RwLock<HashMap<String, Arc<Node>>>>,

    /// Event sender for cluster events.
    event_tx: broadcast::Sender<ClusterEvent<Node>>,

    /// Handle to the health check task.
    health_check_handle: RwLock<Option<JoinHandle<()>>>,

    /// Whether the service is running.
    running: std::sync::atomic::AtomicBool,
}

impl DiscoveryService {
    /// Creates a new discovery service with the given configuration.
    #[must_use]
    pub fn new(config: ClusterConfig) -> Self {
        let (event_tx, _) = broadcast::channel(256);

        Self {
            config,
            nodes: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            health_check_handle: RwLock::new(None),
            running: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Starts the discovery service.
    ///
    /// This will:
    /// 1. Populate the initial node list from configuration
    /// 2. Start periodic health checks
    pub async fn start(&self) -> Result<(), ClusterError> {
        if self.running.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Err(ClusterError::already_joined());
        }

        // Populate initial nodes based on discovery method
        match self.config.discovery {
            DiscoveryMethod::Static => {
                self.populate_static_nodes().await?;
            }
            DiscoveryMethod::Dns => {
                // DNS discovery would query SRV records
                // For now, fall back to static
                self.populate_static_nodes().await?;
            }
        }

        // Start health check loop
        self.start_health_checks().await;

        Ok(())
    }

    /// Stops the discovery service.
    pub async fn stop(&self) {
        self.running
            .store(false, std::sync::atomic::Ordering::SeqCst);

        // Stop health check task
        let mut handle = self.health_check_handle.write().await;
        if let Some(h) = handle.take() {
            h.abort();
        }
    }

    /// Returns whether the service is running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Populates nodes from the static configuration.
    async fn populate_static_nodes(&self) -> Result<(), ClusterError> {
        let mut nodes = self.nodes.write().await;

        for addr in &self.config.nodes {
            let node = Node::from_addr(addr)?;
            let node_arc = Arc::new(node);
            nodes.insert(node_arc.id().to_string(), node_arc);
        }

        Ok(())
    }

    /// Starts the periodic health check loop.
    async fn start_health_checks(&self) {
        let nodes = Arc::clone(&self.nodes);
        let event_tx = self.event_tx.clone();
        let config = self.config.clone();
        let running = self.running.load(std::sync::atomic::Ordering::SeqCst);

        if !running {
            return;
        }

        let handle = tokio::spawn(async move {
            let interval = Duration::from_millis(config.health_check_interval);
            let timeout = Duration::from_millis(config.health_check_timeout);

            loop {
                tokio::time::sleep(interval).await;

                // Get all nodes to check
                let nodes_to_check: Vec<Arc<Node>> = {
                    let nodes_guard = nodes.read().await;
                    nodes_guard.values().cloned().collect()
                };

                // Check each node
                for node in nodes_to_check {
                    let current_status = node.status();

                    // Skip dead nodes
                    if current_status == NodeStatus::Dead {
                        continue;
                    }

                    if let Ok(_latency) = node.health_check(timeout).await {
                        // Node is healthy
                        if current_status != NodeStatus::Healthy {
                            node.set_status(NodeStatus::Healthy).await;
                            let _ = event_tx.send(ClusterEvent::NodeJoined(node.as_ref().clone()));
                        }
                    } else {
                        // Health check failed
                        let failures = node.increment_failures();

                        if failures >= config.dead_threshold {
                            if current_status != NodeStatus::Dead {
                                node.set_status(NodeStatus::Dead).await;
                                let _ =
                                    event_tx.send(ClusterEvent::NodeLeft(node.as_ref().clone()));
                            }
                        } else if failures >= config.suspect_threshold
                            && current_status != NodeStatus::Suspect
                        {
                            node.set_status(NodeStatus::Suspect).await;
                            let _ = event_tx.send(ClusterEvent::NodeSuspect(node.as_ref().clone()));
                        }
                    }
                }
            }
        });

        *self.health_check_handle.write().await = Some(handle);
    }

    /// Adds a node to the registry.
    pub async fn add_node(&self, node: Node) -> Result<(), ClusterError> {
        let mut nodes = self.nodes.write().await;
        let id = node.id().to_string();
        let node_arc = Arc::new(node);

        if nodes.contains_key(&id) {
            return Err(ClusterError::new(
                super::traits::ClusterErrorCode::AlreadyJoined,
                format!("Node {id} already exists"),
            ));
        }

        let _ = self
            .event_tx
            .send(ClusterEvent::NodeJoined(node_arc.as_ref().clone()));
        nodes.insert(id, node_arc);

        Ok(())
    }

    /// Removes a node from the registry.
    pub async fn remove_node(&self, node_id: &str) -> Option<Arc<Node>> {
        let mut nodes = self.nodes.write().await;
        let node = nodes.remove(node_id);

        if let Some(ref n) = node {
            let _ = self
                .event_tx
                .send(ClusterEvent::NodeLeft(n.as_ref().clone()));
        }

        node
    }

    /// Gets a node by ID.
    pub async fn get_node(&self, node_id: &str) -> Option<Arc<Node>> {
        let nodes = self.nodes.read().await;
        nodes.get(node_id).cloned()
    }

    /// Returns all known nodes.
    pub async fn get_all_nodes(&self) -> Vec<Arc<Node>> {
        let nodes = self.nodes.read().await;
        nodes.values().cloned().collect()
    }

    /// Returns all healthy nodes.
    pub async fn get_healthy_nodes(&self) -> Vec<Arc<Node>> {
        let nodes = self.nodes.read().await;
        nodes
            .values()
            .filter(|n| n.status() == NodeStatus::Healthy)
            .cloned()
            .collect()
    }

    /// Returns the number of nodes in each status.
    pub async fn get_node_counts(&self) -> NodeCounts {
        let nodes = self.nodes.read().await;
        let mut counts = NodeCounts::default();

        for node in nodes.values() {
            counts.total += 1;
            match node.status() {
                NodeStatus::Healthy => counts.healthy += 1,
                NodeStatus::Suspect => counts.suspect += 1,
                NodeStatus::Dead => counts.dead += 1,
                NodeStatus::Joining => counts.joining += 1,
                NodeStatus::Leaving => counts.leaving += 1,
            }
        }

        counts
    }

    /// Subscribes to cluster events.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<ClusterEvent<Node>> {
        self.event_tx.subscribe()
    }

    /// Performs an immediate health check on all nodes.
    pub async fn check_all_nodes(&self) -> Vec<(String, Result<u64, ClusterError>)> {
        let nodes = self.get_all_nodes().await;
        let timeout = Duration::from_millis(self.config.health_check_timeout);

        let mut results = Vec::with_capacity(nodes.len());

        for node in nodes {
            let result = node.health_check(timeout).await;
            results.push((node.id().to_string(), result));
        }

        results
    }

    /// Marks a node as dead manually.
    pub async fn mark_node_dead(&self, node_id: &str) -> Result<(), ClusterError> {
        let nodes = self.nodes.read().await;
        let node = nodes
            .get(node_id)
            .ok_or_else(|| ClusterError::node_not_found(node_id))?;

        node.set_status(NodeStatus::Dead).await;
        let _ = self
            .event_tx
            .send(ClusterEvent::NodeLeft(node.as_ref().clone()));

        Ok(())
    }

    /// Triggers node removal for dead nodes older than the removal delay.
    pub async fn cleanup_dead_nodes(&self) -> usize {
        let removal_delay = self.config.dead_node_removal_delay;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut nodes = self.nodes.write().await;
        let mut to_remove = Vec::new();

        for (id, node) in nodes.iter() {
            if node.status() == NodeStatus::Dead {
                let last_ping = node.last_ping_at();
                if last_ping > 0 && (now - last_ping) > removal_delay {
                    to_remove.push(id.clone());
                }
            }
        }

        for id in &to_remove {
            nodes.remove(id);
        }

        to_remove.len()
    }
}

impl std::fmt::Debug for DiscoveryService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DiscoveryService")
            .field("config", &self.config)
            .field("running", &self.running)
            .finish()
    }
}

// =============================================================================
// Node Counts
// =============================================================================

/// Counts of nodes in each status.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NodeCounts {
    /// Total number of nodes.
    pub total: usize,
    /// Number of healthy nodes.
    pub healthy: usize,
    /// Number of suspect nodes.
    pub suspect: usize,
    /// Number of dead nodes.
    pub dead: usize,
    /// Number of joining nodes.
    pub joining: usize,
    /// Number of leaving nodes.
    pub leaving: usize,
}

// =============================================================================
// Static Discovery (for testing and simple setups)
// =============================================================================

/// Simple static discovery that uses a fixed list of nodes.
pub struct StaticDiscovery {
    /// List of node addresses.
    nodes: Vec<String>,
}

impl StaticDiscovery {
    /// Creates a new static discovery with the given node addresses.
    #[must_use]
    pub const fn new(nodes: Vec<String>) -> Self {
        Self { nodes }
    }

    /// Returns the configured nodes.
    pub fn discover(&self) -> Result<Vec<Node>, ClusterError> {
        let mut result = Vec::with_capacity(self.nodes.len());
        for addr in &self.nodes {
            result.push(Node::from_addr(addr)?);
        }
        Ok(result)
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod discovery_service_tests {
        use super::*;

        fn create_test_config() -> ClusterConfig {
            ClusterConfig::new(vec![
                "127.0.0.1:5001".to_string(),
                "127.0.0.1:5002".to_string(),
            ])
            .with_health_check_interval(100)
            .with_health_check_timeout(50)
        }

        #[test]
        fn test_discovery_service_new() {
            let config = create_test_config();
            let discovery = DiscoveryService::new(config);
            assert!(!discovery.is_running());
        }

        #[tokio::test]
        async fn test_discovery_service_start() {
            let config = create_test_config();
            let discovery = DiscoveryService::new(config);

            let result = discovery.start().await;
            assert!(result.is_ok());
            assert!(discovery.is_running());

            discovery.stop().await;
            assert!(!discovery.is_running());
        }

        #[tokio::test]
        async fn test_discovery_service_double_start() {
            let config = create_test_config();
            let discovery = DiscoveryService::new(config);

            discovery.start().await.unwrap();
            let result = discovery.start().await;
            assert!(result.is_err());

            discovery.stop().await;
        }

        #[tokio::test]
        async fn test_discovery_service_get_all_nodes() {
            let config = create_test_config();
            let discovery = DiscoveryService::new(config);
            discovery.start().await.unwrap();

            let nodes = discovery.get_all_nodes().await;
            assert_eq!(nodes.len(), 2);

            discovery.stop().await;
        }

        #[tokio::test]
        async fn test_discovery_service_add_remove_node() {
            let config = ClusterConfig::new(vec![]);
            let discovery = DiscoveryService::new(config);
            discovery.start().await.unwrap();

            // Add a node
            let node = Node::new("test-node", "127.0.0.1", 5003);
            discovery.add_node(node).await.unwrap();

            let nodes = discovery.get_all_nodes().await;
            assert_eq!(nodes.len(), 1);

            // Remove the node
            let removed = discovery.remove_node("test-node").await;
            assert!(removed.is_some());

            let nodes = discovery.get_all_nodes().await;
            assert!(nodes.is_empty());

            discovery.stop().await;
        }

        #[tokio::test]
        async fn test_discovery_service_get_node() {
            let config = ClusterConfig::new(vec!["127.0.0.1:5001".to_string()]);
            let discovery = DiscoveryService::new(config);
            discovery.start().await.unwrap();

            let node = discovery.get_node("127.0.0.1:5001").await;
            assert!(node.is_some());

            let node = discovery.get_node("nonexistent").await;
            assert!(node.is_none());

            discovery.stop().await;
        }

        #[tokio::test]
        async fn test_discovery_service_node_counts() {
            let config = create_test_config();
            let discovery = DiscoveryService::new(config);
            discovery.start().await.unwrap();

            let counts = discovery.get_node_counts().await;
            assert_eq!(counts.total, 2);
            assert_eq!(counts.joining, 2); // Initial status

            discovery.stop().await;
        }

        #[tokio::test]
        async fn test_discovery_service_subscribe() {
            let config = ClusterConfig::new(vec![]);
            let discovery = DiscoveryService::new(config);
            discovery.start().await.unwrap();

            let mut rx = discovery.subscribe();

            // Add a node to trigger an event
            let node = Node::new("test-node", "127.0.0.1", 5003);
            discovery.add_node(node).await.unwrap();

            // Should receive the event
            let event = rx.recv().await;
            assert!(matches!(event, Ok(ClusterEvent::NodeJoined(_))));

            discovery.stop().await;
        }
    }

    mod static_discovery_tests {
        use super::*;

        #[test]
        fn test_static_discovery() {
            let discovery = StaticDiscovery::new(vec![
                "127.0.0.1:5001".to_string(),
                "127.0.0.1:5002".to_string(),
            ]);

            let nodes = discovery.discover().unwrap();
            assert_eq!(nodes.len(), 2);
            assert_eq!(nodes[0].address(), "127.0.0.1");
            assert_eq!(nodes[0].port(), 5001);
        }

        #[test]
        fn test_static_discovery_invalid_address() {
            let discovery = StaticDiscovery::new(vec!["invalid".to_string()]);
            let result = discovery.discover();
            assert!(result.is_err());
        }
    }

    mod node_counts_tests {
        use super::*;

        #[test]
        fn test_node_counts_default() {
            let counts = NodeCounts::default();
            assert_eq!(counts.total, 0);
            assert_eq!(counts.healthy, 0);
            assert_eq!(counts.suspect, 0);
            assert_eq!(counts.dead, 0);
        }
    }
}
