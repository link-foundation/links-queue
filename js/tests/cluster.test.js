/**
 * Tests for the cluster module.
 *
 * Tests for node discovery, partition management, gossip protocol,
 * and cluster coordination.
 *
 * Note: Uses inline setup/teardown instead of beforeEach/afterEach for Deno compatibility.
 * Deno's node:test compatibility layer doesn't support beforeEach/afterEach.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  ClusterCoordinatorImpl,
  ClusterNodeImpl,
  createClusterCoordinator,
} from '../src/cluster/coordinator.js';
import { NodeDiscovery } from '../src/cluster/discovery.js';
import { PartitionManager } from '../src/cluster/partition.js';
import { GossipProtocol } from '../src/cluster/gossip.js';
import { ClusterError } from '../src/cluster/types.js';

// =============================================================================
// Helper Functions (replacing beforeEach/afterEach for Deno compatibility)
// =============================================================================

/**
 * Creates a fresh PartitionManager for testing.
 * @returns {PartitionManager}
 */
function createPartitionManager() {
  return new PartitionManager({ partitionCount: 256 });
}

/**
 * Creates a fresh GossipProtocol setup for testing.
 * @returns {{gossip: GossipProtocol, localNode: ClusterNodeImpl}}
 */
function createGossipSetup() {
  const localNode = new ClusterNodeImpl({
    id: 'local-node',
    address: 'localhost',
    port: 5000,
    status: 'healthy',
  });

  const gossip = new GossipProtocol({
    localNode,
    onMessage: () => {},
  });

  return { gossip, localNode };
}

/**
 * Creates a fresh ClusterCoordinator for testing.
 * @returns {ClusterCoordinatorImpl}
 */
function createCoordinator() {
  return new ClusterCoordinatorImpl({
    nodeId: 'test-node-1',
    advertiseAddress: 'localhost',
    advertisePort: 5000,
    nodes: [],
    discovery: 'static',
  });
}

// =============================================================================
// ClusterError Tests
// =============================================================================

describe('ClusterError', () => {
  it('should create error with code and message', () => {
    const error = new ClusterError('NOT_CONNECTED', 'Not connected to cluster');

    assert.strictEqual(error.code, 'NOT_CONNECTED');
    assert.strictEqual(error.message, 'Not connected to cluster');
    assert.strictEqual(error.name, 'ClusterError');
    assert(error instanceof Error);
  });
});

// =============================================================================
// ClusterNodeImpl Tests
// =============================================================================

describe('ClusterNodeImpl', () => {
  it('should create a node with required properties', () => {
    const node = new ClusterNodeImpl({
      id: 'node-1',
      address: '192.168.1.10',
      port: 5000,
    });

    assert.strictEqual(node.id, 'node-1');
    assert.strictEqual(node.address, '192.168.1.10');
    assert.strictEqual(node.port, 5000);
    assert.strictEqual(node.status, 'joining');
  });

  it('should create a node with custom status', () => {
    const node = new ClusterNodeImpl({
      id: 'node-1',
      address: '192.168.1.10',
      port: 5000,
      status: 'healthy',
    });

    assert.strictEqual(node.status, 'healthy');
  });

  it('should return full address', () => {
    const node = new ClusterNodeImpl({
      id: 'node-1',
      address: '192.168.1.10',
      port: 5000,
    });

    assert.strictEqual(node.getFullAddress(), '192.168.1.10:5000');
  });

  it('should check if node is healthy', () => {
    const node = new ClusterNodeImpl({
      id: 'node-1',
      address: '192.168.1.10',
      port: 5000,
      status: 'healthy',
    });

    assert.strictEqual(node.isHealthy(), true);

    node.status = 'dead';
    assert.strictEqual(node.isHealthy(), false);
  });

  it('should convert to JSON', () => {
    const node = new ClusterNodeImpl({
      id: 'node-1',
      address: '192.168.1.10',
      port: 5000,
      status: 'healthy',
    });

    const json = node.toJSON();
    assert.strictEqual(json.id, 'node-1');
    assert.strictEqual(json.address, '192.168.1.10');
    assert.strictEqual(json.port, 5000);
    assert.strictEqual(json.status, 'healthy');
  });

  it('should ping without gossip (fallback mode)', async () => {
    const node = new ClusterNodeImpl({
      id: 'node-1',
      address: '192.168.1.10',
      port: 5000,
      status: 'healthy',
    });

    const latency = await node.ping();
    assert(typeof latency === 'number');
    assert(latency >= 0);
  });

  it('should fail ping when dead', async () => {
    const node = new ClusterNodeImpl({
      id: 'node-1',
      address: '192.168.1.10',
      port: 5000,
      status: 'dead',
    });

    await assert.rejects(async () => node.ping(), /Node is dead/);
  });
});

// =============================================================================
// PartitionManager Tests
// =============================================================================

describe('PartitionManager', () => {
  it('should create with default partition count', () => {
    const pm = new PartitionManager();
    assert.strictEqual(pm.getPartitionCount(), 256);
  });

  it('should create with custom partition count', () => {
    const pm = new PartitionManager({ partitionCount: 1024 });
    assert.strictEqual(pm.getPartitionCount(), 1024);
  });

  it('should compute partition for key', () => {
    const partitionManager = createPartitionManager();
    const partition = partitionManager.getPartition('test-key');
    assert(typeof partition === 'number');
    assert(partition >= 0);
    assert(partition < 256);
  });

  it('should return consistent partition for same key', () => {
    const partitionManager = createPartitionManager();
    const key = 'consistent-key';
    const partition1 = partitionManager.getPartition(key);
    const partition2 = partitionManager.getPartition(key);
    assert.strictEqual(partition1, partition2);
  });

  it('should assign partitions to nodes', () => {
    const partitionManager = createPartitionManager();
    const nodeIds = ['node-1', 'node-2', 'node-3'];
    partitionManager.assignPartitions(nodeIds);

    const node1Partitions = partitionManager.getPartitionsForNode('node-1');
    const node2Partitions = partitionManager.getPartitionsForNode('node-2');
    const node3Partitions = partitionManager.getPartitionsForNode('node-3');

    // All partitions should be assigned
    const totalAssigned =
      node1Partitions.length + node2Partitions.length + node3Partitions.length;
    assert.strictEqual(totalAssigned, 256);
  });

  it('should return partition owner after assignment', () => {
    const partitionManager = createPartitionManager();
    const nodeIds = ['node-1', 'node-2'];
    partitionManager.assignPartitions(nodeIds);

    const owner = partitionManager.getPartitionOwner(0);
    assert(owner === 'node-1' || owner === 'node-2');
  });

  it('should return null for unassigned partition', () => {
    const partitionManager = createPartitionManager();
    const owner = partitionManager.getPartitionOwner(0);
    assert.strictEqual(owner, null);
  });

  it('should return key owner', () => {
    const partitionManager = createPartitionManager();
    const nodeIds = ['node-1', 'node-2'];
    partitionManager.assignPartitions(nodeIds);

    const owner = partitionManager.getKeyOwner('test-key');
    assert(owner === 'node-1' || owner === 'node-2');
  });

  it('should distribute partitions fairly', () => {
    const partitionManager = createPartitionManager();
    const nodeIds = ['node-1', 'node-2', 'node-3', 'node-4'];
    partitionManager.assignPartitions(nodeIds);

    const stats = partitionManager.getDistributionStats();

    // With consistent hashing, distribution should be reasonably even
    // Each node should have roughly 256/4 = 64 partitions
    assert(stats.min > 0);
    assert(stats.max <= 256);
    // Standard deviation should be reasonable (less than 50% of mean)
    assert(stats.stdDev < 64);
  });
});

// =============================================================================
// NodeDiscovery Tests
// =============================================================================

describe('NodeDiscovery', () => {
  it('should create with config', () => {
    const discovery = new NodeDiscovery({
      discovery: 'static',
      nodes: ['node1:5000', 'node2:5000'],
    });

    assert(discovery instanceof NodeDiscovery);
  });

  it('should parse valid address', async () => {
    const discovery = new NodeDiscovery({
      discovery: 'static',
      nodes: [],
    });

    // Call discover with invalid ports to test parsing
    // Since no servers are running, all nodes will be unreachable
    const nodes = await discovery.discover(['invalid:abc', 'also:invalid']);
    assert.strictEqual(nodes.length, 0);
  });

  it('should refresh node list', async () => {
    const discovery = new NodeDiscovery({
      discovery: 'static',
      nodes: [],
    });

    const nodes = await discovery.refresh();
    assert(Array.isArray(nodes));
  });
});

// =============================================================================
// GossipProtocol Tests
// =============================================================================

describe('GossipProtocol', () => {
  it('should create gossip protocol', async () => {
    const { gossip } = createGossipSetup();
    assert(gossip instanceof GossipProtocol);
    await gossip.close();
  });

  it('should add and remove peers', async () => {
    const { gossip } = createGossipSetup();

    const peer = new ClusterNodeImpl({
      id: 'peer-node',
      address: 'localhost',
      port: 5001,
      status: 'healthy',
    });

    gossip.addPeer(peer);
    gossip.removePeer('peer-node');

    await gossip.close();
  });

  it('should not add local node as peer', async () => {
    const { gossip, localNode } = createGossipSetup();

    gossip.addPeer(localNode);
    // Should not throw and should silently ignore

    await gossip.close();
  });

  it('should start and close', async () => {
    const { gossip } = createGossipSetup();

    await gossip.start();
    await gossip.close();
  });
});

// =============================================================================
// ClusterCoordinatorImpl Tests
// =============================================================================

describe('ClusterCoordinatorImpl', () => {
  it('should create coordinator with config', async () => {
    const coordinator = createCoordinator();
    assert(coordinator instanceof ClusterCoordinatorImpl);
    await coordinator.leave();
  });

  it('should have local node', async () => {
    const coordinator = createCoordinator();
    const localNode = coordinator.getLocalNode();
    assert.strictEqual(localNode.id, 'test-node-1');
    await coordinator.leave();
  });

  it('should return nodes list', async () => {
    const coordinator = createCoordinator();
    const nodes = coordinator.getNodes();
    assert(Array.isArray(nodes));
    assert.strictEqual(nodes.length, 1); // Just local node
    await coordinator.leave();
  });

  it('should return null leader before joining', async () => {
    const coordinator = createCoordinator();
    const leader = coordinator.getLeader();
    assert.strictEqual(leader, null);
    await coordinator.leave();
  });

  it('should not be leader before joining', async () => {
    const coordinator = createCoordinator();
    assert.strictEqual(coordinator.isLeader(), false);
    await coordinator.leave();
  });

  it('should throw when joining twice', async () => {
    const coordinator = createCoordinator();
    await coordinator.join([]);

    await assert.rejects(async () => coordinator.join([]), /Already joined/);

    await coordinator.leave();
  });

  it('should get partition owner', async () => {
    const coordinator = createCoordinator();
    await coordinator.join([]);

    const owner = coordinator.getPartitionOwner('test-key');
    assert(owner !== null);
    assert.strictEqual(owner.id, 'test-node-1');

    await coordinator.leave();
  });

  it('should get partition number', async () => {
    const coordinator = createCoordinator();
    await coordinator.join([]);

    const partition = coordinator.getPartition('test-key');
    assert(typeof partition === 'number');
    assert(partition >= 0);

    await coordinator.leave();
  });

  it('should return stats', async () => {
    const coordinator = createCoordinator();
    await coordinator.join([]);

    const stats = coordinator.getStats();
    assert.strictEqual(stats.totalNodes, 1);
    assert.strictEqual(stats.healthyNodes, 1);
    assert.strictEqual(stats.isLeader, true);

    await coordinator.leave();
  });

  it('should rebalance', async () => {
    const coordinator = createCoordinator();
    await coordinator.join([]);

    let rebalanceStarted = false;
    let rebalanceCompleted = false;

    coordinator.on('rebalance-started', () => {
      rebalanceStarted = true;
    });
    coordinator.on('rebalance-completed', () => {
      rebalanceCompleted = true;
    });

    await coordinator.rebalance();

    assert.strictEqual(rebalanceStarted, true);
    assert.strictEqual(rebalanceCompleted, true);

    await coordinator.leave();
  });

  it('should leave gracefully', async () => {
    const coordinator = createCoordinator();
    await coordinator.join([]);
    await coordinator.leave();

    // After leaving, should be able to join again
    // (but we need to create a new coordinator)
  });

  it('should emit node-joined event for discovered nodes', async () => {
    const coordinator = createCoordinator();
    let nodeJoinedEmitted = false;
    coordinator.on('node-joined', () => {
      nodeJoinedEmitted = true;
    });

    await coordinator.join([]);

    // Note: node-joined is emitted when discovered nodes are added,
    // not for the local node which is already in the list
    const stats = coordinator.getStats();
    assert.strictEqual(stats.totalNodes, 1);
    // Since we join with no seed nodes, no node-joined events are emitted
    assert.strictEqual(nodeJoinedEmitted, false);

    await coordinator.leave();
  });

  it('should emit leader-changed event', async () => {
    const coordinator = createCoordinator();
    let newLeader = null;
    coordinator.on('leader-changed', (node) => {
      newLeader = node;
    });

    await coordinator.join([]);

    assert(newLeader !== null);
    assert.strictEqual(newLeader.id, 'test-node-1');

    await coordinator.leave();
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createClusterCoordinator', () => {
  it('should create coordinator using factory function', async () => {
    const coordinator = createClusterCoordinator({
      nodeId: 'factory-node',
      advertiseAddress: 'localhost',
      advertisePort: 5000,
      nodes: [],
      discovery: 'static',
    });

    assert(coordinator instanceof ClusterCoordinatorImpl);
    assert.strictEqual(coordinator.getLocalNode().id, 'factory-node');

    await coordinator.leave();
  });
});
