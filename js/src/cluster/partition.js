/**
 * Partition management for links-queue multi-node clustering.
 *
 * This module provides the PartitionManager class that handles
 * consistent hashing and partition assignment across cluster nodes.
 *
 * @module cluster/partition
 *
 * @see ARCHITECTURE.md - Cluster Coordinator section
 * @see REQUIREMENTS.md - REQ-SCALE-010 through REQ-SCALE-012
 */

import { createHash } from 'node:crypto';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default partition configuration.
 */
const DEFAULT_CONFIG = {
  partitionCount: 256,
  virtualNodes: 150,
};

// =============================================================================
// PartitionManager Class
// =============================================================================

/**
 * Manages partition assignment for distributed queue operation.
 *
 * Uses consistent hashing to map keys to partitions and partitions to nodes.
 * This ensures minimal data movement when nodes join or leave the cluster.
 *
 * @example
 * const partitionManager = new PartitionManager({ partitionCount: 256 });
 *
 * partitionManager.assignPartitions(['node-1', 'node-2', 'node-3']);
 *
 * const partition = partitionManager.getPartition('queue:tasks:item:123');
 * const owner = partitionManager.getPartitionOwner(partition);
 */
export class PartitionManager {
  /**
   * Creates a new PartitionManager.
   *
   * @param {Object} config - Partition configuration
   * @param {number} [config.partitionCount=256] - Number of partitions
   * @param {number} [config.virtualNodes=150] - Virtual nodes per physical node
   */
  constructor(config = {}) {
    /**
     * Number of partitions.
     * @type {number}
     * @private
     */
    this._partitionCount =
      config.partitionCount ?? DEFAULT_CONFIG.partitionCount;

    /**
     * Virtual nodes per physical node for consistent hashing.
     * @type {number}
     * @private
     */
    this._virtualNodes = config.virtualNodes ?? DEFAULT_CONFIG.virtualNodes;

    /**
     * Maps partition number to node ID.
     * @type {Map<number, string>}
     * @private
     */
    this._partitionToNode = new Map();

    /**
     * Maps node ID to list of partitions.
     * @type {Map<string, number[]>}
     * @private
     */
    this._nodeToPartitions = new Map();

    /**
     * Sorted hash ring for consistent hashing.
     * @type {Array<{hash: number, nodeId: string}>}
     * @private
     */
    this._hashRing = [];
  }

  /**
   * Gets the total number of partitions.
   *
   * @returns {number} Partition count
   */
  getPartitionCount() {
    return this._partitionCount;
  }

  /**
   * Computes a hash value for a key.
   *
   * @param {string} key - The key to hash
   * @returns {number} 32-bit hash value
   * @private
   */
  _hash(key) {
    const hash = createHash('md5').update(key).digest();
    // Use first 4 bytes as unsigned 32-bit integer
    return hash.readUInt32BE(0);
  }

  /**
   * Gets the partition number for a key.
   *
   * @param {string} key - The partition key
   * @returns {number} Partition number (0 to partitionCount - 1)
   */
  getPartition(key) {
    const hash = this._hash(key);
    return hash % this._partitionCount;
  }

  /**
   * Gets the node ID that owns a partition.
   *
   * @param {number} partition - Partition number
   * @returns {string|null} Node ID or null if not assigned
   */
  getPartitionOwner(partition) {
    return this._partitionToNode.get(partition) || null;
  }

  /**
   * Gets the node ID that owns the partition for a key.
   *
   * @param {string} key - The partition key
   * @returns {string|null} Node ID or null if not assigned
   */
  getKeyOwner(key) {
    const partition = this.getPartition(key);
    return this.getPartitionOwner(partition);
  }

  /**
   * Gets all partitions assigned to a node.
   *
   * @param {string} nodeId - Node ID
   * @returns {number[]} Array of partition numbers
   */
  getPartitionsForNode(nodeId) {
    return this._nodeToPartitions.get(nodeId) || [];
  }

  /**
   * Assigns partitions to the given nodes.
   *
   * Uses consistent hashing with virtual nodes to distribute
   * partitions evenly and minimize movement on topology changes.
   *
   * @param {string[]} nodeIds - Array of node IDs (should be sorted)
   */
  assignPartitions(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) {
      return;
    }

    // Clear existing assignments
    this._partitionToNode.clear();
    this._nodeToPartitions.clear();
    this._hashRing = [];

    // Build hash ring with virtual nodes
    for (const nodeId of nodeIds) {
      this._nodeToPartitions.set(nodeId, []);

      for (let i = 0; i < this._virtualNodes; i++) {
        const virtualKey = `${nodeId}:${i}`;
        const hash = this._hash(virtualKey);
        this._hashRing.push({ hash, nodeId });
      }
    }

    // Sort hash ring
    this._hashRing.sort((a, b) => a.hash - b.hash);

    // Assign partitions using the hash ring
    for (let partition = 0; partition < this._partitionCount; partition++) {
      const partitionKey = `partition:${partition}`;
      const partitionHash = this._hash(partitionKey);

      // Find the first node in the ring with hash >= partition hash
      const nodeId = this._findNodeInRing(partitionHash);

      this._partitionToNode.set(partition, nodeId);
      this._nodeToPartitions.get(nodeId).push(partition);
    }
  }

  /**
   * Finds the node in the hash ring responsible for a hash value.
   *
   * @param {number} hash - Hash value to look up
   * @returns {string} Node ID
   * @private
   */
  _findNodeInRing(hash) {
    if (this._hashRing.length === 0) {
      return null;
    }

    // Binary search for the first node with hash >= target
    let left = 0;
    let right = this._hashRing.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this._hashRing[mid].hash < hash) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // Wrap around if we've gone past the end
    if (left >= this._hashRing.length) {
      left = 0;
    }

    return this._hashRing[left].nodeId;
  }

  /**
   * Gets statistics about partition distribution.
   *
   * @returns {{min: number, max: number, stdDev: number}} Distribution stats
   */
  getDistributionStats() {
    const counts = Array.from(this._nodeToPartitions.values()).map(
      (p) => p.length
    );

    if (counts.length === 0) {
      return { min: 0, max: 0, stdDev: 0 };
    }

    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance =
      counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    return { min, max, stdDev };
  }
}
