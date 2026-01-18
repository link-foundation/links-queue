//! Cluster module for multi-node operation.
//!
//! This module provides the traits and implementations for distributed operation,
//! including node management, partition handling, and replication.
//!
//! # Overview
//!
//! The cluster module provides:
//! - **Node Discovery**: Finding and monitoring cluster nodes (`discovery`)
//! - **Partition Management**: Consistent hashing for data distribution (`partition`)
//! - **Replication**: Ensuring data durability and availability (`replication`)
//! - **Gossip Protocol**: Membership dissemination (`gossip`)
//! - **Coordination**: Leader election and cluster management (`coordinator`)
//!
//! # Quick Start
//!
//! ```rust,ignore
//! use links_queue::cluster::{
//!     ClusterBuilder, ClusterCoordinator, ClusterNode,
//! };
//!
//! // Create a cluster coordinator
//! let coordinator = ClusterBuilder::new()
//!     .node_id("my-node")
//!     .address("192.168.1.10")
//!     .port(5000)
//!     .seed("node1:5000")
//!     .seed("node2:5000")
//!     .replication_factor(3)
//!     .sync_replication(true)
//!     .build()?;
//!
//! // Start and join the cluster
//! coordinator.start().await?;
//! coordinator.join(&["node1:5000", "node2:5000"]).await?;
//!
//! // Get healthy nodes
//! for node in coordinator.get_nodes().iter().filter(|n| n.is_healthy()) {
//!     println!("Healthy node: {} at {}:{}", node.id(), node.address(), node.port());
//! }
//!
//! // Find partition owner for a key
//! let owner = coordinator.get_partition_owner("queue:tasks:item:123");
//! println!("Key owner: {}", owner.id());
//! ```
//!
//! # Architecture
//!
//! The cluster module is organized into several layers:
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                  DefaultClusterCoordinator               │
//! │  - Leader election                                       │
//! │  - Cluster state management                              │
//! │  - Event broadcasting                                    │
//! ├─────────────────────────────────────────────────────────┤
//! │ DiscoveryService │ GossipProtocol │ PartitionManager    │
//! │ - Node registry  │ - Membership   │ - Consistent hash   │
//! │ - Health checks  │ - State sync   │ - Partition assign  │
//! ├─────────────────────────────────────────────────────────┤
//! │                     DataReplicationManager               │
//! │  - Sync/async replication                                │
//! │  - Consistency checks                                    │
//! └─────────────────────────────────────────────────────────┘
//! ```
//!
//! # Operating Modes
//!
//! ## Multi-Memory Mode
//!
//! Distributed in-memory operation. Data is partitioned across nodes
//! but not persisted. Suitable for ephemeral workloads.
//!
//! ```rust,ignore
//! let config = ClusterConfig::new(vec!["node1:5000".into(), "node2:5000".into()])
//!     .with_discovery(DiscoveryMethod::Static);
//! // mode: "multi-memory" in JSON config
//! ```
//!
//! ## Multi-Stored Mode
//!
//! Distributed operation with persistence. Each node maintains local
//! storage via link-cli, with replication for durability.
//!
//! ```rust,ignore
//! let config = ClusterConfig::new(vec!["node1:5000".into(), "node2:5000".into()])
//!     .with_replication(ReplicationConfig::new(3, true));
//! // mode: "multi-stored" in JSON config
//! ```
//!
//! # References
//!
//! - [ARCHITECTURE.md](../../../ARCHITECTURE.md) - Cluster Coordinator section
//! - [REQUIREMENTS.md](../../../REQUIREMENTS.md) - REQ-MODE-020 through REQ-MODE-033
//! - [ROADMAP.md](../../../ROADMAP.md) - Phase 6: Multi-Node Clustering

#[cfg(test)]
mod tests;

// Core traits and types
mod traits;

// Implementation modules
mod coordinator;
mod discovery;
mod gossip;
mod node;
mod partition;
mod replication;

// =============================================================================
// Public Re-exports - Traits and Configuration
// =============================================================================

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
    // Status enums
    NodeStatus,
    ReplicationConfig,
    ReplicationManager,
    SyncMode,
};

// =============================================================================
// Public Re-exports - Node Implementation
// =============================================================================

pub use node::{LocalNode, Node, NodeBuilder, NodeMetadata};

// =============================================================================
// Public Re-exports - Discovery
// =============================================================================

pub use discovery::{DiscoveryService, NodeCounts, StaticDiscovery};

// =============================================================================
// Public Re-exports - Partitioning
// =============================================================================

pub use partition::{HashRing, PartitionKey, PartitionManager, PartitionStats};

// =============================================================================
// Public Re-exports - Replication
// =============================================================================

pub use replication::{
    DataReplicationManager, ReplicationRequest, ReplicationResponse, ReplicationStats,
};

// =============================================================================
// Public Re-exports - Gossip Protocol
// =============================================================================

pub use gossip::{
    GossipConfig, GossipMessage, GossipMessageType, GossipProtocol, GossipStats, MemberState,
};

// =============================================================================
// Public Re-exports - Coordinator
// =============================================================================

pub use coordinator::{ClusterBuilder, DefaultClusterCoordinator};
