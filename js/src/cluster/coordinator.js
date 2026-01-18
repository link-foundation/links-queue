/**
 * Cluster Coordinator implementation for links-queue multi-node operation.
 *
 * This module provides the ClusterCoordinator class that manages the distributed
 * aspects of the system, including node discovery, partition management,
 * leader election, and cluster membership.
 *
 * @module cluster/coordinator
 *
 * @see ARCHITECTURE.md - Cluster Coordinator section
 * @see REQUIREMENTS.md - REQ-SCALE-001 through REQ-SCALE-022
 * @see ROADMAP.md - Phase 6: Multi-Node Clustering
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ClusterError } from './types.js';
import { NodeDiscovery } from './discovery.js';
import { PartitionManager } from './partition.js';
import { GossipProtocol } from './gossip.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  healthCheckInterval: 5000,
  healthCheckTimeout: 1000,
  suspectThreshold: 3,
  deadThreshold: 5,
  deadNodeRemovalDelay: 300000,
  partitionCount: 256,
};

// =============================================================================
// ClusterNodeImpl Class
// =============================================================================

/**
 * Implementation of the ClusterNode interface.
 */
export class ClusterNodeImpl {
  /**
   * Creates a new ClusterNodeImpl.
   *
   * @param {Object} config - Node configuration
   * @param {string} config.id - Node ID
   * @param {string} config.address - Network address
   * @param {number} config.port - Port number
   * @param {import('./types.ts').NodeStatus} [config.status='joining'] - Initial status
   */
  constructor(config) {
    /** @type {string} */
    this.id = config.id;

    /** @type {string} */
    this.address = config.address;

    /** @type {number} */
    this.port = config.port;

    /** @type {import('./types.ts').NodeStatus} */
    this.status = config.status || 'joining';

    /**
     * Last time this node was seen healthy.
     * @type {number}
     */
    this.lastSeen = Date.now();

    /**
     * Number of consecutive failed health checks.
     * @type {number}
     */
    this.failedChecks = 0;

    /**
     * Last recorded latency in milliseconds.
     * @type {number}
     */
    this.lastLatency = 0;

    /**
     * Connection reference (if established).
     * @type {import('node:net').Socket|null}
     * @private
     */
    this._connection = null;

    /**
     * Gossip protocol reference for pinging.
     * @type {GossipProtocol|null}
     * @private
     */
    this._gossip = null;
  }

  /**
   * Sets the gossip protocol reference for pinging.
   *
   * @param {GossipProtocol} gossip - Gossip protocol instance
   */
  setGossip(gossip) {
    this._gossip = gossip;
  }

  /**
   * Sends a ping to the node and measures latency.
   *
   * @returns {Promise<number>} Round-trip latency in milliseconds
   * @throws {Error} If the node is unreachable or times out
   */
  async ping() {
    if (this._gossip) {
      const start = Date.now();
      await this._gossip.ping(this);
      const latency = Date.now() - start;
      this.lastLatency = latency;
      this.lastSeen = Date.now();
      this.failedChecks = 0;
      return latency;
    }

    // Fallback: simulate ping for testing
    return new Promise((resolve, reject) => {
      if (this.status === 'dead') {
        reject(new Error('Node is dead'));
      } else {
        const latency = Math.random() * 10 + 1;
        this.lastLatency = latency;
        this.lastSeen = Date.now();
        this.failedChecks = 0;
        resolve(latency);
      }
    });
  }

  /**
   * Checks if the node is currently healthy.
   *
   * @returns {boolean} True if the node is healthy
   */
  isHealthy() {
    return this.status === 'healthy';
  }

  /**
   * Returns the full address string.
   *
   * @returns {string} Address in "host:port" format
   */
  getFullAddress() {
    return `${this.address}:${this.port}`;
  }

  /**
   * Converts to a plain object for serialization.
   *
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      id: this.id,
      address: this.address,
      port: this.port,
      status: this.status,
      lastSeen: this.lastSeen,
      lastLatency: this.lastLatency,
    };
  }
}

// =============================================================================
// ClusterCoordinatorImpl Class
// =============================================================================

/**
 * Implementation of the ClusterCoordinator interface.
 *
 * Manages the distributed aspects of the system, including:
 * - Node discovery and membership
 * - Health checking and failure detection
 * - Leader election
 * - Partition assignment
 *
 * @extends EventEmitter
 * @implements {import('./types.ts').ClusterCoordinator}
 *
 * @example
 * const coordinator = new ClusterCoordinatorImpl({
 *   nodes: ['node1:5000', 'node2:5000'],
 *   discovery: 'static',
 *   nodeId: 'local-node-1',
 *   advertiseAddress: '192.168.1.10',
 *   advertisePort: 5000,
 * });
 *
 * await coordinator.join(['node1:5000', 'node2:5000']);
 *
 * coordinator.on('node-joined', (node) => {
 *   console.log(`Node joined: ${node.id}`);
 * });
 */
export class ClusterCoordinatorImpl extends EventEmitter {
  /**
   * Creates a new ClusterCoordinatorImpl.
   *
   * @param {import('./types.ts').ClusterConfig} config - Cluster configuration
   */
  constructor(config) {
    super();

    /**
     * Configuration.
     * @type {import('./types.ts').ClusterConfig}
     * @private
     */
    this._config = {
      nodes: config.nodes || [],
      discovery: config.discovery || 'static',
      replication: config.replication,
      healthCheckInterval:
        config.healthCheckInterval ?? DEFAULT_CONFIG.healthCheckInterval,
      healthCheckTimeout:
        config.healthCheckTimeout ?? DEFAULT_CONFIG.healthCheckTimeout,
      suspectThreshold:
        config.suspectThreshold ?? DEFAULT_CONFIG.suspectThreshold,
      deadThreshold: config.deadThreshold ?? DEFAULT_CONFIG.deadThreshold,
      deadNodeRemovalDelay:
        config.deadNodeRemovalDelay ?? DEFAULT_CONFIG.deadNodeRemovalDelay,
      nodeId: config.nodeId ?? randomUUID(),
      advertiseAddress: config.advertiseAddress,
      advertisePort: config.advertisePort,
    };

    /**
     * Local node representation.
     * @type {ClusterNodeImpl}
     * @private
     */
    this._localNode = new ClusterNodeImpl({
      id: this._config.nodeId,
      address: this._config.advertiseAddress || 'localhost',
      port: this._config.advertisePort || 5000,
      status: 'joining',
    });

    /**
     * Known nodes in the cluster (including local).
     * @type {Map<string, ClusterNodeImpl>}
     * @private
     */
    this._nodes = new Map();
    this._nodes.set(this._localNode.id, this._localNode);

    /**
     * Current cluster leader.
     * @type {ClusterNodeImpl|null}
     * @private
     */
    this._leader = null;

    /**
     * Whether the coordinator has joined a cluster.
     * @type {boolean}
     * @private
     */
    this._joined = false;

    /**
     * Health check interval timer.
     * @type {NodeJS.Timeout|null}
     * @private
     */
    this._healthCheckTimer = null;

    /**
     * Dead node cleanup timers.
     * @type {Map<string, NodeJS.Timeout>}
     * @private
     */
    this._deadNodeTimers = new Map();

    /**
     * Node discovery manager.
     * @type {NodeDiscovery}
     * @private
     */
    this._discovery = new NodeDiscovery(this._config);

    /**
     * Partition manager.
     * @type {PartitionManager}
     * @private
     */
    this._partitionManager = new PartitionManager({
      partitionCount: DEFAULT_CONFIG.partitionCount,
    });

    /**
     * Gossip protocol for membership.
     * @type {GossipProtocol|null}
     * @private
     */
    this._gossip = null;

    /**
     * Timestamp when the node joined the cluster.
     * @type {string|null}
     * @private
     */
    this._joinedAt = null;

    /**
     * Timestamp of last rebalance.
     * @type {string|null}
     * @private
     */
    this._lastRebalanceAt = null;
  }

  // ---------------------------------------------------------------------------
  // Node Management
  // ---------------------------------------------------------------------------

  /**
   * Joins the cluster by connecting to seed nodes.
   *
   * @param {string[]} nodes - List of seed node addresses (format: "host:port")
   * @returns {Promise<void>}
   * @throws {ClusterError} If already joined or unable to connect
   */
  async join(nodes) {
    if (this._joined) {
      throw new ClusterError('ALREADY_JOINED', 'Already joined a cluster');
    }

    const seedNodes = nodes.length > 0 ? nodes : this._config.nodes;

    // Initialize gossip protocol
    this._gossip = new GossipProtocol({
      localNode: this._localNode,
      onMessage: (message) => this._handleGossipMessage(message),
    });

    // Link local node to gossip
    this._localNode.setGossip(this._gossip);

    // Discover initial nodes
    const discoveredNodes = await this._discovery.discover(seedNodes);

    // Add discovered nodes
    for (const nodeInfo of discoveredNodes) {
      const node = new ClusterNodeImpl({
        id: nodeInfo.id || randomUUID(),
        address: nodeInfo.address,
        port: nodeInfo.port,
        status: 'healthy',
      });
      node.setGossip(this._gossip);
      this._addNode(node);
    }

    // Mark local node as healthy
    this._localNode.status = 'healthy';
    this._joined = true;
    this._joinedAt = new Date().toISOString();

    // Start health checking
    this._startHealthChecks();

    // Elect leader
    await this._electLeader();

    // Initial partition assignment
    await this._assignPartitions();
  }

  /**
   * Gracefully leaves the cluster.
   *
   * @returns {Promise<void>}
   */
  async leave() {
    if (!this._joined) {
      return;
    }

    // Notify other nodes we're leaving
    this._localNode.status = 'leaving';
    await this._broadcastStateChange(this._localNode);

    // Stop health checks
    this._stopHealthChecks();

    // Clear dead node timers
    for (const timer of this._deadNodeTimers.values()) {
      clearTimeout(timer);
    }
    this._deadNodeTimers.clear();

    // Close gossip connections
    if (this._gossip) {
      await this._gossip.close();
      this._gossip = null;
    }

    // Remove all nodes except local
    for (const [nodeId, node] of this._nodes) {
      if (nodeId !== this._localNode.id) {
        this._nodes.delete(nodeId);
        this.emit('node-left', node);
      }
    }

    this._joined = false;
    this._leader = null;
  }

  /**
   * Returns all known nodes in the cluster.
   *
   * @returns {ClusterNodeImpl[]} Array of ClusterNode instances
   */
  getNodes() {
    return Array.from(this._nodes.values());
  }

  /**
   * Returns the current cluster leader.
   *
   * @returns {ClusterNodeImpl|null} The leader node, or null
   */
  getLeader() {
    return this._leader;
  }

  /**
   * Gets the local node.
   *
   * @returns {ClusterNodeImpl} The local node
   */
  getLocalNode() {
    return this._localNode;
  }

  /**
   * Checks if this node is the cluster leader.
   *
   * @returns {boolean} True if this is the leader
   */
  isLeader() {
    return Boolean(this._leader && this._leader.id === this._localNode.id);
  }

  // ---------------------------------------------------------------------------
  // Partition Management
  // ---------------------------------------------------------------------------

  /**
   * Determines which node owns a given partition key.
   *
   * @param {string} key - The partition key to look up
   * @returns {ClusterNodeImpl} The ClusterNode that owns this key
   */
  getPartitionOwner(key) {
    const partition = this._partitionManager.getPartition(key);
    const healthyNodes = this.getNodes().filter((n) => n.isHealthy());

    if (healthyNodes.length === 0) {
      return this._localNode;
    }

    const nodeIndex = partition % healthyNodes.length;
    return healthyNodes[nodeIndex];
  }

  /**
   * Gets the partition number for a key.
   *
   * @param {string} key - The key to get partition for
   * @returns {number} Partition number
   */
  getPartition(key) {
    return this._partitionManager.getPartition(key);
  }

  /**
   * Triggers a rebalancing of partitions across the cluster.
   *
   * @returns {Promise<void>}
   */
  async rebalance() {
    this.emit('rebalance-started');

    await this._assignPartitions();

    this._lastRebalanceAt = new Date().toISOString();
    this.emit('rebalance-completed');
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Returns statistics about the cluster state.
   *
   * @returns {import('./types.ts').ClusterStats} Current cluster statistics
   */
  getStats() {
    const nodes = this.getNodes();
    const healthyNodes = nodes.filter((n) => n.status === 'healthy');
    const suspectNodes = nodes.filter((n) => n.status === 'suspect');
    const deadNodes = nodes.filter((n) => n.status === 'dead');

    const localPartitions = this._partitionManager.getPartitionsForNode(
      this._localNode.id
    );

    return {
      totalNodes: nodes.length,
      healthyNodes: healthyNodes.length,
      suspectNodes: suspectNodes.length,
      deadNodes: deadNodes.length,
      isLeader: this.isLeader(),
      totalPartitions: this._partitionManager.getPartitionCount(),
      localPartitions: localPartitions.length,
      averageReplicationFactor: this._config.replication?.factor || 1,
      underReplicatedLinks: 0, // TODO: Track actual under-replication
      joinedAt: this._joinedAt || new Date().toISOString(),
      lastRebalanceAt: this._lastRebalanceAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  /**
   * Registers a handler for cluster events.
   * This method is inherited from EventEmitter.
   *
   * @param {string} event - Event type
   * @param {Function} handler - Handler function
   */
  // on(), off() methods inherited from EventEmitter

  // ---------------------------------------------------------------------------
  // Internal Methods
  // ---------------------------------------------------------------------------

  /**
   * Adds a node to the cluster.
   *
   * @param {ClusterNodeImpl} node - Node to add
   * @private
   */
  _addNode(node) {
    if (this._nodes.has(node.id)) {
      return;
    }

    this._nodes.set(node.id, node);
    this.emit('node-joined', node);
  }

  /**
   * Removes a node from the cluster.
   *
   * @param {string} nodeId - ID of node to remove
   * @private
   */
  _removeNode(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node || nodeId === this._localNode.id) {
      return;
    }

    this._nodes.delete(nodeId);
    this.emit('node-left', node);

    // Re-elect leader if needed
    if (this._leader && this._leader.id === nodeId) {
      this._electLeader();
    }
  }

  /**
   * Starts periodic health checking.
   *
   * @private
   */
  _startHealthChecks() {
    if (this._healthCheckTimer) {
      return;
    }

    this._healthCheckTimer = setInterval(
      () => this._performHealthChecks(),
      this._config.healthCheckInterval
    );
  }

  /**
   * Stops health checking.
   *
   * @private
   */
  _stopHealthChecks() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
  }

  /**
   * Performs health checks on all remote nodes.
   *
   * @private
   */
  async _performHealthChecks() {
    const nodes = this.getNodes().filter((n) => n.id !== this._localNode.id);

    for (const node of nodes) {
      try {
        await Promise.race([
          node.ping(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Timeout')),
              this._config.healthCheckTimeout
            )
          ),
        ]);

        // Node is healthy
        if (node.status !== 'healthy') {
          node.status = 'healthy';
          node.failedChecks = 0;
        }
      } catch {
        // Health check failed
        node.failedChecks++;

        if (
          node.failedChecks >= this._config.deadThreshold &&
          node.status !== 'dead'
        ) {
          this._markNodeDead(node);
        } else if (
          node.failedChecks >= this._config.suspectThreshold &&
          node.status === 'healthy'
        ) {
          this._markNodeSuspect(node);
        }
      }
    }
  }

  /**
   * Marks a node as suspect.
   *
   * @param {ClusterNodeImpl} node - Node to mark
   * @private
   */
  _markNodeSuspect(node) {
    node.status = 'suspect';
    this.emit('node-suspect', node);
  }

  /**
   * Marks a node as dead.
   *
   * @param {ClusterNodeImpl} node - Node to mark
   * @private
   */
  _markNodeDead(node) {
    node.status = 'dead';

    // Schedule removal after delay
    const timer = setTimeout(() => {
      this._removeNode(node.id);
      this._deadNodeTimers.delete(node.id);
    }, this._config.deadNodeRemovalDelay);

    this._deadNodeTimers.set(node.id, timer);
  }

  /**
   * Elects a new cluster leader using simple leader election.
   *
   * Uses the node with the lexicographically smallest ID among healthy nodes.
   *
   * @private
   */
  async _electLeader() {
    const healthyNodes = this.getNodes()
      .filter((n) => n.isHealthy())
      .sort((a, b) => a.id.localeCompare(b.id));

    const newLeader = healthyNodes[0] || this._localNode;

    if (!this._leader || this._leader.id !== newLeader.id) {
      this._leader = newLeader;
      this.emit('leader-changed', newLeader);
    }
  }

  /**
   * Assigns partitions to nodes.
   *
   * @private
   */
  async _assignPartitions() {
    const healthyNodes = this.getNodes().filter((n) => n.isHealthy());
    const nodeIds = healthyNodes.map((n) => n.id).sort();

    this._partitionManager.assignPartitions(nodeIds);
  }

  /**
   * Broadcasts state change to other nodes.
   *
   * @param {ClusterNodeImpl} node - Node whose state changed
   * @private
   */
  async _broadcastStateChange(node) {
    if (this._gossip) {
      await this._gossip.broadcast({
        type: 'state-change',
        node: node.toJSON(),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handles incoming gossip messages.
   *
   * @param {Object} message - Gossip message
   * @private
   */
  _handleGossipMessage(message) {
    switch (message.type) {
      case 'state-change':
        this._handleStateChange(message);
        break;
      case 'join':
        this._handleJoinMessage(message);
        break;
      case 'leave':
        this._handleLeaveMessage(message);
        break;
      default:
        // Unknown message type
        break;
    }
  }

  /**
   * Handles state change message.
   *
   * @param {Object} message - State change message
   * @private
   */
  _handleStateChange(message) {
    const nodeInfo = message.node;
    let node = this._nodes.get(nodeInfo.id);

    if (!node) {
      node = new ClusterNodeImpl({
        id: nodeInfo.id,
        address: nodeInfo.address,
        port: nodeInfo.port,
        status: nodeInfo.status,
      });
      node.setGossip(this._gossip);
      this._addNode(node);
    } else {
      node.status = nodeInfo.status;
      node.lastSeen = Date.now();
    }
  }

  /**
   * Handles join message.
   *
   * @param {Object} message - Join message
   * @private
   */
  _handleJoinMessage(message) {
    const nodeInfo = message.node;
    if (!this._nodes.has(nodeInfo.id)) {
      const node = new ClusterNodeImpl({
        id: nodeInfo.id,
        address: nodeInfo.address,
        port: nodeInfo.port,
        status: 'healthy',
      });
      node.setGossip(this._gossip);
      this._addNode(node);

      // Trigger rebalance
      this.rebalance();
    }
  }

  /**
   * Handles leave message.
   *
   * @param {Object} message - Leave message
   * @private
   */
  _handleLeaveMessage(message) {
    const nodeId = message.nodeId;
    this._removeNode(nodeId);

    // Trigger rebalance
    this.rebalance();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new ClusterCoordinator instance.
 *
 * @param {import('./types.ts').ClusterConfig} config - Cluster configuration
 * @returns {ClusterCoordinatorImpl} Cluster coordinator instance
 *
 * @example
 * const coordinator = createClusterCoordinator({
 *   nodes: ['node1:5000', 'node2:5000'],
 *   discovery: 'static',
 * });
 */
export function createClusterCoordinator(config) {
  return new ClusterCoordinatorImpl(config);
}
