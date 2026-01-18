---
'links-queue-js': minor
---

Add multi-node clustering support for distributed queue operation

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
