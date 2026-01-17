/**
 * Cluster and Node type definitions for links-queue multi-node operation.
 *
 * This module provides the interfaces for multi-node clustering, including
 * node discovery, partition management, and replication. These interfaces
 * establish the API contract for distributed operation, enabling both
 * `multi-memory` and `multi-stored` modes.
 *
 * @module cluster/types
 *
 * Design goals:
 * - Support dynamic node discovery and health monitoring
 * - Provide partition management for horizontal scaling
 * - Enable configurable replication strategies
 * - Maintain API parity between JavaScript and Rust implementations
 *
 * @see ARCHITECTURE.md - Cluster Coordinator section
 * @see REQUIREMENTS.md - REQ-SCALE-001 through REQ-SCALE-022
 * @see ROADMAP.md - Phase 6: Multi-Node Clustering
 */

import type { Link, LinkId } from '../types.ts';

// =============================================================================
// Node Status Types
// =============================================================================

/**
 * Status of a cluster node.
 *
 * - `healthy`: Node is operating normally and responsive
 * - `suspect`: Node may be failing, awaiting confirmation
 * - `dead`: Node has been confirmed as non-responsive
 * - `joining`: Node is in the process of joining the cluster
 * - `leaving`: Node is gracefully leaving the cluster
 */
export type NodeStatus = 'healthy' | 'suspect' | 'dead' | 'joining' | 'leaving';

// =============================================================================
// ClusterNode Interface
// =============================================================================

/**
 * Represents a node in the cluster.
 *
 * A ClusterNode provides information about a single node in the distributed
 * system, including its identity, network address, and current health status.
 *
 * @example
 * // Get node information
 * const node = coordinator.getNodes()[0];
 * console.log(`Node ${node.id} at ${node.address}:${node.port}`);
 *
 * // Check node health
 * if (node.isHealthy()) {
 *   const latency = await node.ping();
 *   console.log(`Node ${node.id} responded in ${latency}ms`);
 * }
 */
export interface ClusterNode {
  /**
   * Unique identifier for this node.
   *
   * This ID is stable across restarts and used for partition assignment.
   */
  readonly id: string;

  /**
   * Network address (hostname or IP) of the node.
   */
  readonly address: string;

  /**
   * Port number on which the node is listening.
   */
  readonly port: number;

  /**
   * Current status of the node.
   */
  readonly status: NodeStatus;

  /**
   * Sends a ping to the node and measures latency.
   *
   * @returns Promise resolving to the round-trip latency in milliseconds
   * @throws If the node is unreachable or times out
   *
   * @example
   * try {
   *   const latency = await node.ping();
   *   console.log(`Latency: ${latency}ms`);
   * } catch (error) {
   *   console.error('Node unreachable');
   * }
   */
  ping(): Promise<number>;

  /**
   * Checks if the node is currently healthy.
   *
   * A node is considered healthy if its status is 'healthy'.
   *
   * @returns True if the node is healthy, false otherwise
   *
   * @example
   * if (node.isHealthy()) {
   *   // Safe to route requests to this node
   * }
   */
  isHealthy(): boolean;
}

// =============================================================================
// Cluster Event Types
// =============================================================================

/**
 * Event types emitted by the ClusterCoordinator.
 */
export type ClusterEventType =
  | 'node-joined'
  | 'node-left'
  | 'node-suspect'
  | 'leader-changed'
  | 'rebalance-started'
  | 'rebalance-completed';

/**
 * Event handler for node join events.
 */
export type NodeJoinedHandler = (node: ClusterNode) => void;

/**
 * Event handler for node leave events.
 */
export type NodeLeftHandler = (node: ClusterNode) => void;

/**
 * Event handler for node suspect events.
 */
export type NodeSuspectHandler = (node: ClusterNode) => void;

/**
 * Event handler for leader change events.
 */
export type LeaderChangedHandler = (node: ClusterNode) => void;

/**
 * Event handler for rebalance started events.
 */
export type RebalanceStartedHandler = () => void;

/**
 * Event handler for rebalance completed events.
 */
export type RebalanceCompletedHandler = () => void;

// =============================================================================
// ClusterCoordinator Interface
// =============================================================================

/**
 * Interface for cluster coordination operations.
 *
 * The ClusterCoordinator manages the distributed aspects of the system,
 * including node discovery, partition management, and leader election.
 *
 * @example
 * // Join a cluster
 * await coordinator.join(['node1:5000', 'node2:5000']);
 *
 * // Get all healthy nodes
 * const nodes = coordinator.getNodes().filter(n => n.isHealthy());
 *
 * // Find partition owner for a key
 * const owner = coordinator.getPartitionOwner('queue:tasks:item:123');
 *
 * // Listen for topology changes
 * coordinator.on('node-joined', (node) => {
 *   console.log(`Node ${node.id} joined the cluster`);
 * });
 */
export interface ClusterCoordinator {
  // ---------------------------------------------------------------------------
  // Node Management
  // ---------------------------------------------------------------------------

  /**
   * Joins the cluster by connecting to seed nodes.
   *
   * This initiates the cluster membership protocol, allowing this node
   * to discover other nodes and participate in the cluster.
   *
   * @param nodes - List of seed node addresses (format: "host:port")
   * @throws If unable to connect to any seed node
   *
   * @example
   * await coordinator.join(['node1.example.com:5000', 'node2.example.com:5000']);
   */
  join(nodes: string[]): Promise<void>;

  /**
   * Gracefully leaves the cluster.
   *
   * This notifies other nodes that this node is leaving and allows for
   * graceful handoff of partitions and in-flight work.
   *
   * @example
   * await coordinator.leave();
   */
  leave(): Promise<void>;

  /**
   * Returns all known nodes in the cluster.
   *
   * Includes nodes in all states (healthy, suspect, joining, leaving).
   * Dead nodes are typically pruned after a configurable timeout.
   *
   * @returns Array of ClusterNode instances
   *
   * @example
   * const nodes = coordinator.getNodes();
   * const healthyNodes = nodes.filter(n => n.isHealthy());
   * console.log(`${healthyNodes.length} of ${nodes.length} nodes healthy`);
   */
  getNodes(): ClusterNode[];

  /**
   * Returns the current cluster leader, if one exists.
   *
   * The leader is responsible for coordination tasks like partition
   * assignment and rebalancing decisions.
   *
   * @returns The leader node, or null if no leader is elected
   *
   * @example
   * const leader = coordinator.getLeader();
   * if (leader) {
   *   console.log(`Current leader: ${leader.id}`);
   * } else {
   *   console.log('No leader elected');
   * }
   */
  getLeader(): ClusterNode | null;

  // ---------------------------------------------------------------------------
  // Partition Management
  // ---------------------------------------------------------------------------

  /**
   * Determines which node owns a given partition key.
   *
   * The key is typically derived from the queue name and item ID.
   * The coordinator uses consistent hashing or a similar algorithm
   * to map keys to nodes.
   *
   * @param key - The partition key to look up
   * @returns The ClusterNode that owns this key
   *
   * @example
   * const key = `queue:${queueName}:item:${itemId}`;
   * const owner = coordinator.getPartitionOwner(key);
   * if (owner.id === localNodeId) {
   *   // Handle locally
   * } else {
   *   // Forward to owner
   * }
   */
  getPartitionOwner(key: string): ClusterNode;

  /**
   * Triggers a rebalancing of partitions across the cluster.
   *
   * This is typically called automatically when nodes join or leave,
   * but can be triggered manually for administrative purposes.
   *
   * @example
   * await coordinator.rebalance();
   * console.log('Rebalancing complete');
   */
  rebalance(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Returns statistics about the cluster state.
   *
   * @returns Current cluster statistics
   *
   * @example
   * const stats = coordinator.getStats();
   * console.log(`Cluster: ${stats.healthyNodes}/${stats.totalNodes} healthy`);
   */
  getStats(): ClusterStats;

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  /**
   * Registers a handler for node join events.
   *
   * @param event - The event type 'node-joined'
   * @param handler - The handler function
   */
  on(event: 'node-joined', handler: NodeJoinedHandler): void;

  /**
   * Registers a handler for node leave events.
   *
   * @param event - The event type 'node-left'
   * @param handler - The handler function
   */
  on(event: 'node-left', handler: NodeLeftHandler): void;

  /**
   * Registers a handler for node suspect events.
   *
   * @param event - The event type 'node-suspect'
   * @param handler - The handler function
   */
  on(event: 'node-suspect', handler: NodeSuspectHandler): void;

  /**
   * Registers a handler for leader change events.
   *
   * @param event - The event type 'leader-changed'
   * @param handler - The handler function
   */
  on(event: 'leader-changed', handler: LeaderChangedHandler): void;

  /**
   * Registers a handler for rebalance started events.
   *
   * @param event - The event type 'rebalance-started'
   * @param handler - The handler function
   */
  on(event: 'rebalance-started', handler: RebalanceStartedHandler): void;

  /**
   * Registers a handler for rebalance completed events.
   *
   * @param event - The event type 'rebalance-completed'
   * @param handler - The handler function
   */
  on(event: 'rebalance-completed', handler: RebalanceCompletedHandler): void;

  /**
   * Removes a previously registered event handler.
   *
   * @param event - The event type
   * @param handler - The handler function to remove
   */
  off(event: 'node-joined', handler: NodeJoinedHandler): void;
  off(event: 'node-left', handler: NodeLeftHandler): void;
  off(event: 'node-suspect', handler: NodeSuspectHandler): void;
  off(event: 'leader-changed', handler: LeaderChangedHandler): void;
  off(event: 'rebalance-started', handler: RebalanceStartedHandler): void;
  off(event: 'rebalance-completed', handler: RebalanceCompletedHandler): void;
}

// =============================================================================
// Replication Types
// =============================================================================

/**
 * Synchronization mode for replication.
 *
 * - `sync`: Wait for all replicas to acknowledge before returning
 * - `async`: Return immediately after primary write, replicate in background
 */
export type SyncMode = 'sync' | 'async';

// =============================================================================
// ReplicationManager Interface
// =============================================================================

/**
 * Interface for managing data replication across nodes.
 *
 * The ReplicationManager ensures data durability and availability by
 * maintaining copies of links on multiple nodes.
 *
 * @example
 * // Replicate a link
 * await replicationManager.replicate(link);
 *
 * // Get replica nodes for a link
 * const replicas = replicationManager.getReplicaNodes(linkId);
 * console.log(`Link ${linkId} is replicated on ${replicas.length} nodes`);
 *
 * // Ensure consistency across replicas
 * await replicationManager.ensureConsistency(linkId);
 */
export interface ReplicationManager {
  /**
   * The configured replication factor.
   *
   * This determines how many copies of each link are maintained.
   * A factor of 1 means no replication (single copy).
   */
  readonly replicationFactor: number;

  /**
   * The synchronization mode for replication.
   */
  readonly syncMode: SyncMode;

  /**
   * Replicates a link to the configured replica nodes.
   *
   * In sync mode, this returns after all replicas have acknowledged.
   * In async mode, this returns after the primary write, with replication
   * happening in the background.
   *
   * @param link - The link to replicate
   * @throws If replication fails and cannot meet the replication factor
   *
   * @example
   * await replicationManager.replicate(link);
   */
  replicate(link: Link): Promise<void>;

  /**
   * Returns the nodes that hold replicas of a specific link.
   *
   * @param linkId - The ID of the link
   * @returns Array of ClusterNodes holding replicas
   *
   * @example
   * const replicas = replicationManager.getReplicaNodes(42);
   * if (replicas.length < replicationManager.replicationFactor) {
   *   console.warn('Under-replicated link detected');
   * }
   */
  getReplicaNodes(linkId: LinkId): ClusterNode[];

  /**
   * Ensures all replicas of a link are consistent.
   *
   * This performs a read-repair or active anti-entropy check to
   * synchronize all replicas.
   *
   * @param linkId - The ID of the link to check
   * @throws If consistency cannot be achieved
   *
   * @example
   * await replicationManager.ensureConsistency(42);
   */
  ensureConsistency(linkId: LinkId): Promise<void>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Discovery method for finding cluster nodes.
 *
 * - `static`: Use a fixed list of node addresses
 * - `dns`: Discover nodes via DNS SRV records
 */
export type DiscoveryMethod = 'static' | 'dns';

/**
 * Configuration for replication behavior.
 *
 * @example
 * const replicationConfig: ReplicationConfig = {
 *   factor: 3,
 *   sync: true,
 *   minReplicas: 2,
 * };
 */
export interface ReplicationConfig {
  /**
   * Number of replicas to maintain for each link.
   * Defaults to 1 (no replication).
   */
  factor: number;

  /**
   * Whether to use synchronous replication.
   * Defaults to false (async replication).
   */
  sync: boolean;

  /**
   * Minimum number of replicas that must acknowledge before considering
   * a write successful (for sync mode).
   * Defaults to replicationFactor.
   */
  minReplicas?: number;
}

/**
 * Configuration for cluster operation.
 *
 * This configuration controls how a node participates in the cluster,
 * including discovery, replication, and health checking.
 *
 * @example
 * const clusterConfig: ClusterConfig = {
 *   nodes: ['node1:5000', 'node2:5000', 'node3:5000'],
 *   discovery: 'static',
 *   replication: {
 *     factor: 3,
 *     sync: true,
 *   },
 * };
 */
export interface ClusterConfig {
  /**
   * Initial list of node addresses (format: "host:port").
   *
   * For static discovery, this is the complete list of nodes.
   * For DNS discovery, these are the seed nodes for initial bootstrap.
   */
  nodes: string[];

  /**
   * Method used to discover cluster nodes.
   *
   * - `static`: Use the provided node list directly
   * - `dns`: Discover nodes via DNS SRV records
   *
   * Defaults to 'static'.
   */
  discovery: DiscoveryMethod;

  /**
   * Replication configuration.
   *
   * If not provided, replication is disabled (single copy).
   */
  replication?: ReplicationConfig;

  /**
   * Interval in milliseconds for health checks.
   * Defaults to 5000ms (5 seconds).
   */
  healthCheckInterval?: number;

  /**
   * Timeout in milliseconds for health check pings.
   * Defaults to 1000ms (1 second).
   */
  healthCheckTimeout?: number;

  /**
   * Number of failed health checks before marking a node as suspect.
   * Defaults to 3.
   */
  suspectThreshold?: number;

  /**
   * Number of consecutive failures before marking a node as dead.
   * Defaults to 5.
   */
  deadThreshold?: number;

  /**
   * Time in milliseconds to wait before removing a dead node from the cluster.
   * Defaults to 300000ms (5 minutes).
   */
  deadNodeRemovalDelay?: number;

  /**
   * Unique identifier for this node.
   * If not provided, a UUID will be generated.
   */
  nodeId?: string;

  /**
   * Address to advertise to other nodes.
   * If not provided, the system will attempt to detect the local address.
   */
  advertiseAddress?: string;

  /**
   * Port to advertise to other nodes.
   * If not provided, uses the local listening port.
   */
  advertisePort?: number;
}

// =============================================================================
// Cluster Statistics
// =============================================================================

/**
 * Statistics about the cluster state.
 *
 * @example
 * const stats = coordinator.getStats();
 * console.log(`Cluster: ${stats.healthyNodes}/${stats.totalNodes} healthy`);
 */
export interface ClusterStats {
  /**
   * Total number of known nodes.
   */
  readonly totalNodes: number;

  /**
   * Number of healthy nodes.
   */
  readonly healthyNodes: number;

  /**
   * Number of suspect nodes.
   */
  readonly suspectNodes: number;

  /**
   * Number of dead nodes (pending removal).
   */
  readonly deadNodes: number;

  /**
   * Whether this node is currently the leader.
   */
  readonly isLeader: boolean;

  /**
   * Total number of partitions.
   */
  readonly totalPartitions: number;

  /**
   * Number of partitions owned by this node.
   */
  readonly localPartitions: number;

  /**
   * Average replication factor across all data.
   */
  readonly averageReplicationFactor: number;

  /**
   * Number of under-replicated links.
   */
  readonly underReplicatedLinks: number;

  /**
   * Timestamp when the node joined the cluster (ISO string).
   */
  readonly joinedAt: string;

  /**
   * Time since last successful rebalance (ISO string, or null if never).
   */
  readonly lastRebalanceAt: string | null;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for cluster operations.
 */
export type ClusterErrorCode =
  | 'NOT_CONNECTED'
  | 'ALREADY_JOINED'
  | 'NODE_NOT_FOUND'
  | 'NO_LEADER'
  | 'REPLICATION_FAILED'
  | 'CONSISTENCY_ERROR'
  | 'PARTITION_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

/**
 * Error thrown by cluster operations.
 *
 * @example
 * try {
 *   await coordinator.join(['node1:5000']);
 * } catch (error) {
 *   if (error instanceof ClusterError && error.code === 'NETWORK_ERROR') {
 *     console.log('Unable to reach seed nodes');
 *   }
 * }
 */
export class ClusterError extends Error {
  /**
   * The error code identifying the type of error.
   */
  readonly code: ClusterErrorCode;

  /**
   * Creates a new ClusterError.
   *
   * @param code - Error code
   * @param message - Human-readable error message
   */
  constructor(code: ClusterErrorCode, message: string) {
    super(message);
    this.name = 'ClusterError';
    this.code = code;
  }
}
