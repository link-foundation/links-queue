//! Partition management for consistent hashing.
//!
//! This module provides consistent hashing for distributing data across
//! cluster nodes. It supports virtual nodes for better load distribution
//! and automatic rebalancing when the cluster topology changes.

// Allow intentional casts for hash calculations and statistics.
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::cast_precision_loss)]
#![allow(clippy::significant_drop_tightening)]
#![allow(clippy::missing_fields_in_debug)]

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use tokio::sync::RwLock;

use super::node::Node;
use super::traits::ClusterNode;

// =============================================================================
// Hash Ring
// =============================================================================

/// A consistent hash ring for partition assignment.
///
/// Uses virtual nodes (vnodes) to ensure better distribution of keys
/// across physical nodes. Each physical node is mapped to multiple
/// positions on the ring.
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::cluster::partition::HashRing;
/// use links_queue::cluster::Node;
///
/// let mut ring = HashRing::new(100); // 100 virtual nodes per physical node
///
/// ring.add_node(Node::new("node-1", "192.168.1.1", 5000));
/// ring.add_node(Node::new("node-2", "192.168.1.2", 5000));
///
/// let owner = ring.get_node("queue:tasks:item:123");
/// println!("Key is owned by: {}", owner.id());
/// ```
#[derive(Debug)]
pub struct HashRing<N: ClusterNode> {
    /// The ring mapping hash positions to nodes.
    ring: BTreeMap<u64, Arc<N>>,

    /// Number of virtual nodes per physical node.
    vnodes: usize,

    /// All physical nodes in the ring.
    nodes: Vec<Arc<N>>,
}

impl<N: ClusterNode> HashRing<N> {
    /// Creates a new hash ring with the specified number of virtual nodes.
    ///
    /// More virtual nodes provide better distribution but use more memory.
    /// A typical value is 100-150 virtual nodes per physical node.
    #[must_use]
    pub const fn new(vnodes: usize) -> Self {
        Self {
            ring: BTreeMap::new(),
            vnodes,
            nodes: Vec::new(),
        }
    }

    /// Creates a hash ring with default settings (100 virtual nodes).
    #[must_use]
    pub const fn with_defaults() -> Self {
        Self::new(100)
    }

    /// Adds a node to the ring.
    ///
    /// This will add `vnodes` virtual nodes for the physical node.
    pub fn add_node(&mut self, node: N) {
        let node_arc = Arc::new(node);

        for i in 0..self.vnodes {
            let key = format!("{}:{}", node_arc.id(), i);
            let hash = hash_key(&key);
            self.ring.insert(hash, Arc::clone(&node_arc));
        }

        self.nodes.push(node_arc);
    }

    /// Removes a node from the ring.
    ///
    /// Returns true if the node was found and removed.
    pub fn remove_node(&mut self, node_id: &str) -> bool {
        // Remove from nodes list
        let initial_len = self.nodes.len();
        self.nodes.retain(|n| n.id() != node_id);

        if self.nodes.len() == initial_len {
            return false;
        }

        // Remove all virtual nodes
        let mut to_remove = Vec::new();
        for i in 0..self.vnodes {
            let key = format!("{node_id}:{i}");
            let hash = hash_key(&key);
            to_remove.push(hash);
        }

        for hash in to_remove {
            self.ring.remove(&hash);
        }

        true
    }

    /// Gets the node responsible for a key.
    ///
    /// Uses consistent hashing to find the node that owns the given key.
    /// Returns `None` if the ring is empty.
    #[must_use]
    pub fn get_node(&self, key: &str) -> Option<Arc<N>> {
        if self.ring.is_empty() {
            return None;
        }

        let hash = hash_key(key);

        // Find the first node with a hash >= our key's hash
        if let Some((_, node)) = self.ring.range(hash..).next() {
            return Some(Arc::clone(node));
        }

        // Wrap around to the beginning of the ring
        if let Some((_, node)) = self.ring.iter().next() {
            return Some(Arc::clone(node));
        }

        None
    }

    /// Gets n nodes responsible for replicating a key.
    ///
    /// Returns the primary node and `n-1` successor nodes for replication.
    /// Nodes are returned in order of preference (primary first).
    #[must_use]
    pub fn get_replica_nodes(&self, key: &str, n: usize) -> Vec<Arc<N>> {
        if self.ring.is_empty() || n == 0 {
            return Vec::new();
        }

        let hash = hash_key(key);
        let mut result = Vec::with_capacity(n);
        let mut seen_ids = std::collections::HashSet::new();

        // Start from the key's position and walk clockwise
        let iter = self.ring.range(hash..).chain(self.ring.iter());

        for (_, node) in iter {
            if seen_ids.insert(node.id().to_string()) {
                result.push(Arc::clone(node));
                if result.len() >= n {
                    break;
                }
            }
        }

        result
    }

    /// Returns all physical nodes in the ring.
    #[must_use]
    pub fn get_all_nodes(&self) -> &[Arc<N>] {
        &self.nodes
    }

    /// Returns the number of physical nodes.
    #[must_use]
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Returns whether the ring is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Returns the number of virtual nodes in the ring.
    #[must_use]
    pub fn vnode_count(&self) -> usize {
        self.ring.len()
    }

    /// Calculates the distribution of keys across nodes.
    ///
    /// Useful for monitoring load distribution.
    #[must_use]
    pub fn get_distribution(&self) -> std::collections::HashMap<String, f64> {
        if self.ring.is_empty() {
            return std::collections::HashMap::new();
        }

        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let total_vnodes = self.ring.len();

        for node in self.ring.values() {
            *counts.entry(node.id().to_string()).or_insert(0) += 1;
        }

        counts
            .into_iter()
            .map(|(id, count)| (id, (count as f64) / (total_vnodes as f64) * 100.0))
            .collect()
    }
}

impl<N: ClusterNode> Default for HashRing<N> {
    fn default() -> Self {
        Self::with_defaults()
    }
}

impl<N: ClusterNode> Clone for HashRing<N> {
    fn clone(&self) -> Self {
        Self {
            ring: self.ring.clone(),
            vnodes: self.vnodes,
            nodes: self.nodes.clone(),
        }
    }
}

// =============================================================================
// Partition Manager
// =============================================================================

/// Manages partitions and their assignment to nodes.
///
/// The partition manager maintains the hash ring and handles rebalancing
/// when the cluster topology changes.
pub struct PartitionManager {
    /// The hash ring for partition assignment.
    ring: RwLock<HashRing<Node>>,

    /// Number of partitions (fixed at creation).
    partition_count: usize,

    /// Replication factor.
    replication_factor: usize,
}

impl PartitionManager {
    /// Creates a new partition manager.
    ///
    /// # Arguments
    ///
    /// * `partition_count` - Total number of partitions (should be a power of 2)
    /// * `vnodes` - Virtual nodes per physical node for the hash ring
    /// * `replication_factor` - Number of replicas for each partition
    #[must_use]
    pub fn new(partition_count: usize, vnodes: usize, replication_factor: usize) -> Self {
        Self {
            ring: RwLock::new(HashRing::new(vnodes)),
            partition_count,
            replication_factor,
        }
    }

    /// Creates a partition manager with default settings.
    #[must_use]
    pub fn with_defaults() -> Self {
        Self::new(256, 100, 1)
    }

    /// Adds a node to the partition manager.
    pub async fn add_node(&self, node: Node) {
        let mut ring = self.ring.write().await;
        ring.add_node(node);
    }

    /// Removes a node from the partition manager.
    pub async fn remove_node(&self, node_id: &str) -> bool {
        let mut ring = self.ring.write().await;
        ring.remove_node(node_id)
    }

    /// Gets the partition ID for a key.
    #[must_use]
    pub fn get_partition_id(&self, key: &str) -> usize {
        let hash = hash_key(key);
        (hash as usize) % self.partition_count
    }

    /// Gets the node that owns a key.
    pub async fn get_owner(&self, key: &str) -> Option<Arc<Node>> {
        let ring = self.ring.read().await;
        ring.get_node(key)
    }

    /// Gets the nodes that should hold replicas of a key.
    pub async fn get_replica_nodes(&self, key: &str) -> Vec<Arc<Node>> {
        let ring = self.ring.read().await;
        ring.get_replica_nodes(key, self.replication_factor)
    }

    /// Returns all nodes in the cluster.
    pub async fn get_all_nodes(&self) -> Vec<Arc<Node>> {
        let ring = self.ring.read().await;
        ring.get_all_nodes().to_vec()
    }

    /// Returns the partition count.
    #[must_use]
    pub const fn partition_count(&self) -> usize {
        self.partition_count
    }

    /// Returns the replication factor.
    #[must_use]
    pub const fn replication_factor(&self) -> usize {
        self.replication_factor
    }

    /// Calculates which partitions a node owns.
    pub async fn get_node_partitions(&self, node_id: &str) -> Vec<usize> {
        let ring = self.ring.read().await;
        let mut partitions = Vec::new();

        for i in 0..self.partition_count {
            let key = format!("partition:{i}");
            if let Some(owner) = ring.get_node(&key) {
                if owner.id() == node_id {
                    partitions.push(i);
                }
            }
        }

        partitions
    }

    /// Returns partition distribution statistics.
    pub async fn get_stats(&self) -> PartitionStats {
        let ring = self.ring.read().await;
        let distribution = ring.get_distribution();

        let node_count = ring.node_count();
        let expected_pct = if node_count > 0 {
            100.0 / node_count as f64
        } else {
            0.0
        };

        let variance = if distribution.is_empty() {
            0.0
        } else {
            distribution
                .values()
                .map(|pct| (pct - expected_pct).powi(2))
                .sum::<f64>()
                / distribution.len() as f64
        };

        PartitionStats {
            partition_count: self.partition_count,
            node_count,
            replication_factor: self.replication_factor,
            distribution,
            variance,
        }
    }
}

impl std::fmt::Debug for PartitionManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PartitionManager")
            .field("partition_count", &self.partition_count)
            .field("replication_factor", &self.replication_factor)
            .finish()
    }
}

// =============================================================================
// Partition Statistics
// =============================================================================

/// Statistics about partition distribution.
#[derive(Debug, Clone)]
pub struct PartitionStats {
    /// Total number of partitions.
    pub partition_count: usize,

    /// Number of nodes in the cluster.
    pub node_count: usize,

    /// Replication factor.
    pub replication_factor: usize,

    /// Percentage of virtual nodes assigned to each physical node.
    pub distribution: std::collections::HashMap<String, f64>,

    /// Variance in distribution (lower is better).
    pub variance: f64,
}

// =============================================================================
// Hash Function
// =============================================================================

/// Hashes a key to a u64 using a consistent hash function.
///
/// Uses a simple but effective hash that provides good distribution.
fn hash_key(key: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut hasher);
    hasher.finish()
}

/// Hashes bytes to a u64.
#[allow(dead_code)]
fn hash_bytes(data: &[u8]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    data.hash(&mut hasher);
    hasher.finish()
}

// =============================================================================
// Partition Key
// =============================================================================

/// A partition key that can be derived from various data types.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PartitionKey(String);

impl PartitionKey {
    /// Creates a partition key from a string.
    #[must_use]
    pub fn new(key: impl Into<String>) -> Self {
        Self(key.into())
    }

    /// Creates a partition key for a queue item.
    #[must_use]
    pub fn for_queue_item(queue_name: &str, item_id: &str) -> Self {
        Self(format!("queue:{queue_name}:item:{item_id}"))
    }

    /// Creates a partition key for a queue.
    #[must_use]
    pub fn for_queue(queue_name: &str) -> Self {
        Self(format!("queue:{queue_name}"))
    }

    /// Returns the key as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns the hash of this key.
    #[must_use]
    pub fn hash(&self) -> u64 {
        hash_key(&self.0)
    }
}

impl From<String> for PartitionKey {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for PartitionKey {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl std::fmt::Display for PartitionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod hash_ring_tests {
        use super::*;

        fn create_test_node(id: &str) -> Node {
            Node::new(id, "127.0.0.1", 5000)
        }

        #[test]
        fn test_hash_ring_new() {
            let ring = HashRing::<Node>::new(100);
            assert!(ring.is_empty());
            assert_eq!(ring.node_count(), 0);
        }

        #[test]
        fn test_hash_ring_add_node() {
            let mut ring = HashRing::new(100);
            ring.add_node(create_test_node("node-1"));

            assert!(!ring.is_empty());
            assert_eq!(ring.node_count(), 1);
            assert_eq!(ring.vnode_count(), 100);
        }

        #[test]
        fn test_hash_ring_remove_node() {
            let mut ring = HashRing::new(100);
            ring.add_node(create_test_node("node-1"));
            ring.add_node(create_test_node("node-2"));

            assert_eq!(ring.node_count(), 2);

            let removed = ring.remove_node("node-1");
            assert!(removed);
            assert_eq!(ring.node_count(), 1);

            let removed = ring.remove_node("nonexistent");
            assert!(!removed);
        }

        #[test]
        fn test_hash_ring_get_node() {
            let mut ring = HashRing::new(100);
            ring.add_node(create_test_node("node-1"));

            let node = ring.get_node("test-key");
            assert!(node.is_some());
            assert_eq!(node.unwrap().id(), "node-1");
        }

        #[test]
        fn test_hash_ring_get_node_empty() {
            let ring = HashRing::<Node>::new(100);
            assert!(ring.get_node("test-key").is_none());
        }

        #[test]
        fn test_hash_ring_get_replica_nodes() {
            let mut ring = HashRing::new(100);
            ring.add_node(create_test_node("node-1"));
            ring.add_node(create_test_node("node-2"));
            ring.add_node(create_test_node("node-3"));

            let replicas = ring.get_replica_nodes("test-key", 2);
            assert_eq!(replicas.len(), 2);

            // Replicas should be different nodes
            assert_ne!(replicas[0].id(), replicas[1].id());
        }

        #[test]
        fn test_hash_ring_get_replica_nodes_more_than_available() {
            let mut ring = HashRing::new(100);
            ring.add_node(create_test_node("node-1"));
            ring.add_node(create_test_node("node-2"));

            let replicas = ring.get_replica_nodes("test-key", 5);
            assert_eq!(replicas.len(), 2); // Only 2 nodes available
        }

        #[test]
        fn test_hash_ring_consistency() {
            let mut ring = HashRing::new(100);
            ring.add_node(create_test_node("node-1"));
            ring.add_node(create_test_node("node-2"));

            // Same key should always map to same node
            let node1 = ring.get_node("consistent-key");
            let node2 = ring.get_node("consistent-key");
            assert_eq!(node1.unwrap().id(), node2.unwrap().id());
        }

        #[test]
        fn test_hash_ring_distribution() {
            let mut ring = HashRing::new(100);
            ring.add_node(create_test_node("node-1"));
            ring.add_node(create_test_node("node-2"));

            let dist = ring.get_distribution();
            assert_eq!(dist.len(), 2);

            // Each node should have roughly 50% of vnodes
            for pct in dist.values() {
                assert!(*pct > 40.0 && *pct < 60.0);
            }
        }
    }

    mod partition_manager_tests {
        use super::*;

        fn create_test_node(id: &str) -> Node {
            Node::new(id, "127.0.0.1", 5000)
        }

        #[tokio::test]
        async fn test_partition_manager_new() {
            let pm = PartitionManager::new(256, 100, 2);
            assert_eq!(pm.partition_count(), 256);
            assert_eq!(pm.replication_factor(), 2);
        }

        #[tokio::test]
        async fn test_partition_manager_add_remove_node() {
            let pm = PartitionManager::with_defaults();

            pm.add_node(create_test_node("node-1")).await;
            let nodes = pm.get_all_nodes().await;
            assert_eq!(nodes.len(), 1);

            let removed = pm.remove_node("node-1").await;
            assert!(removed);

            let nodes = pm.get_all_nodes().await;
            assert!(nodes.is_empty());
        }

        #[tokio::test]
        async fn test_partition_manager_get_owner() {
            let pm = PartitionManager::with_defaults();
            pm.add_node(create_test_node("node-1")).await;

            let owner = pm.get_owner("test-key").await;
            assert!(owner.is_some());
            assert_eq!(owner.unwrap().id(), "node-1");
        }

        #[tokio::test]
        async fn test_partition_manager_get_partition_id() {
            let pm = PartitionManager::new(256, 100, 1);

            let id1 = pm.get_partition_id("key1");
            let id2 = pm.get_partition_id("key1");
            assert_eq!(id1, id2); // Same key, same partition

            assert!(id1 < 256); // Partition ID should be in range
        }

        #[tokio::test]
        async fn test_partition_manager_get_replica_nodes() {
            let pm = PartitionManager::new(256, 100, 3);
            pm.add_node(create_test_node("node-1")).await;
            pm.add_node(create_test_node("node-2")).await;
            pm.add_node(create_test_node("node-3")).await;

            let replicas = pm.get_replica_nodes("test-key").await;
            assert_eq!(replicas.len(), 3);
        }

        #[tokio::test]
        async fn test_partition_manager_stats() {
            let pm = PartitionManager::new(256, 100, 2);
            pm.add_node(create_test_node("node-1")).await;
            pm.add_node(create_test_node("node-2")).await;

            let stats = pm.get_stats().await;
            assert_eq!(stats.partition_count, 256);
            assert_eq!(stats.node_count, 2);
            assert_eq!(stats.replication_factor, 2);
            assert_eq!(stats.distribution.len(), 2);
        }
    }

    mod partition_key_tests {
        use super::*;

        #[test]
        fn test_partition_key_new() {
            let key = PartitionKey::new("test-key");
            assert_eq!(key.as_str(), "test-key");
        }

        #[test]
        fn test_partition_key_for_queue_item() {
            let key = PartitionKey::for_queue_item("tasks", "123");
            assert_eq!(key.as_str(), "queue:tasks:item:123");
        }

        #[test]
        fn test_partition_key_for_queue() {
            let key = PartitionKey::for_queue("tasks");
            assert_eq!(key.as_str(), "queue:tasks");
        }

        #[test]
        fn test_partition_key_hash() {
            let key1 = PartitionKey::new("test");
            let key2 = PartitionKey::new("test");
            let key3 = PartitionKey::new("other");

            assert_eq!(key1.hash(), key2.hash());
            assert_ne!(key1.hash(), key3.hash());
        }
    }

    mod hash_function_tests {
        use super::*;

        #[test]
        fn test_hash_key_consistency() {
            let h1 = hash_key("test");
            let h2 = hash_key("test");
            assert_eq!(h1, h2);
        }

        #[test]
        fn test_hash_key_different() {
            let h1 = hash_key("test1");
            let h2 = hash_key("test2");
            assert_ne!(h1, h2);
        }
    }
}
