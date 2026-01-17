//! Cluster module for multi-node operation.
//!
//! This module provides the traits and types for distributed operation,
//! including node management, partition handling, and replication.
//!
//! # Overview
//!
//! The cluster module establishes the API contract for:
//! - **Node Discovery**: Finding and monitoring cluster nodes
//! - **Partition Management**: Distributing data across nodes
//! - **Replication**: Ensuring data durability and availability
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::cluster::{
//!     ClusterConfig, ClusterCoordinator, ClusterNode, ReplicationConfig,
//! };
//!
//! // Configure the cluster
//! let config = ClusterConfig::new(vec![
//!     "node1:5000".to_string(),
//!     "node2:5000".to_string(),
//! ])
//! .with_replication(ReplicationConfig::new(3, true));
//!
//! // Create and join cluster
//! let coordinator = MyClusterCoordinator::new(config);
//! coordinator.join(&["node1:5000"]).await?;
//! ```

mod traits;

pub use traits::{
    // Configuration types
    ClusterConfig,
    // Traits
    ClusterCoordinator,
    // Error types
    ClusterError,
    ClusterErrorCode,
    // Event types
    ClusterEvent,
    ClusterNode,
    ClusterResult,
    // Statistics
    ClusterStats,
    DiscoveryMethod,
    // Status and mode enums
    NodeStatus,
    ReplicationConfig,
    ReplicationManager,
    SyncMode,
};
