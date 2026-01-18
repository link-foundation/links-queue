/**
 * Cluster module type definitions.
 *
 * Re-exports all cluster-related types from the types.ts module.
 */

export {
  // Status types
  NodeStatus,
  // Node interface
  ClusterNode,
  // Event types
  ClusterEventType,
  NodeJoinedHandler,
  NodeLeftHandler,
  NodeSuspectHandler,
  LeaderChangedHandler,
  RebalanceStartedHandler,
  RebalanceCompletedHandler,
  // Coordinator interface
  ClusterCoordinator,
  // Replication types
  SyncMode,
  ReplicationManager,
  // Configuration types
  DiscoveryMethod,
  ReplicationConfig,
  ClusterConfig,
  // Statistics
  ClusterStats,
  // Error types
  ClusterErrorCode,
  ClusterError,
} from './types.ts';
