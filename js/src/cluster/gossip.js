/**
 * Gossip protocol for links-queue cluster membership.
 *
 * This module provides the GossipProtocol class that handles
 * peer-to-peer communication and membership state propagation
 * using a gossip-style protocol.
 *
 * @module cluster/gossip
 *
 * @see ARCHITECTURE.md - Cluster Coordinator section
 * @see REQUIREMENTS.md - REQ-SCALE-001 through REQ-SCALE-003
 */

import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default gossip configuration.
 */
const DEFAULT_CONFIG = {
  gossipInterval: 1000,
  fanout: 3,
  messageTimeout: 5000,
};

// =============================================================================
// GossipProtocol Class
// =============================================================================

/**
 * Implements a gossip protocol for cluster membership management.
 *
 * Uses push-based gossip to propagate membership changes and state
 * updates across the cluster. Each gossip round, a node randomly
 * selects a subset of peers (fanout) to share state with.
 *
 * @extends EventEmitter
 *
 * @example
 * const gossip = new GossipProtocol({
 *   localNode: myNode,
 *   onMessage: (message, fromNode) => {
 *     console.log(`Received ${message.type} from ${fromNode.id}`);
 *   },
 * });
 *
 * await gossip.broadcast({ type: 'state-change', node: myNode.toJSON() });
 */
export class GossipProtocol extends EventEmitter {
  /**
   * Creates a new GossipProtocol instance.
   *
   * @param {Object} config - Gossip configuration
   * @param {import('./coordinator.js').ClusterNodeImpl} config.localNode - Local node
   * @param {Function} config.onMessage - Message handler callback
   * @param {number} [config.gossipInterval=1000] - Interval between gossip rounds
   * @param {number} [config.fanout=3] - Number of peers to gossip to per round
   */
  constructor(config) {
    super();

    /**
     * Local node reference.
     * @type {import('./coordinator.js').ClusterNodeImpl}
     * @private
     */
    this._localNode = config.localNode;

    /**
     * Message handler callback.
     * @type {Function}
     * @private
     */
    this._onMessage = config.onMessage;

    /**
     * Gossip interval in milliseconds.
     * @type {number}
     * @private
     */
    this._gossipInterval =
      config.gossipInterval ?? DEFAULT_CONFIG.gossipInterval;

    /**
     * Number of peers to gossip to per round.
     * @type {number}
     * @private
     */
    this._fanout = config.fanout ?? DEFAULT_CONFIG.fanout;

    /**
     * Known peers in the cluster.
     * @type {Map<string, import('./coordinator.js').ClusterNodeImpl>}
     * @private
     */
    this._peers = new Map();

    /**
     * Pending message callbacks.
     * @type {Map<string, {resolve: Function, reject: Function, timeout: NodeJS.Timeout}>}
     * @private
     */
    this._pendingMessages = new Map();

    /**
     * Gossip interval timer.
     * @type {NodeJS.Timeout|null}
     * @private
     */
    this._gossipTimer = null;

    /**
     * TCP server for receiving gossip messages.
     * @type {import('node:net').Server|null}
     * @private
     */
    this._server = null;

    /**
     * Whether the gossip protocol is running.
     * @type {boolean}
     * @private
     */
    this._running = false;

    /**
     * Message sequence counter.
     * @type {number}
     * @private
     */
    this._messageSeq = 0;
  }

  /**
   * Starts the gossip protocol.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this._running) {
      return;
    }

    this._running = true;

    // Start gossip timer
    this._gossipTimer = setInterval(
      () => this._performGossipRound(),
      this._gossipInterval
    );
  }

  /**
   * Stops the gossip protocol.
   *
   * @returns {Promise<void>}
   */
  async close() {
    this._running = false;

    if (this._gossipTimer) {
      clearInterval(this._gossipTimer);
      this._gossipTimer = null;
    }

    // Clear pending messages
    for (const [, pending] of this._pendingMessages) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Gossip protocol closed'));
    }
    this._pendingMessages.clear();

    // Close server if running
    if (this._server) {
      await new Promise((resolve) => {
        this._server.close(resolve);
      });
      this._server = null;
    }

    this._peers.clear();
  }

  /**
   * Adds a peer to the gossip network.
   *
   * @param {import('./coordinator.js').ClusterNodeImpl} node - Node to add
   */
  addPeer(node) {
    if (node.id !== this._localNode.id) {
      this._peers.set(node.id, node);
    }
  }

  /**
   * Removes a peer from the gossip network.
   *
   * @param {string} nodeId - ID of node to remove
   */
  removePeer(nodeId) {
    this._peers.delete(nodeId);
  }

  /**
   * Sends a ping to a node.
   *
   * @param {import('./coordinator.js').ClusterNodeImpl} node - Node to ping
   * @returns {Promise<void>}
   */
  async ping(node) {
    const message = {
      type: 'ping',
      from: this._localNode.id,
      seq: ++this._messageSeq,
      timestamp: Date.now(),
    };

    return this._sendMessage(node, message);
  }

  /**
   * Broadcasts a message to all peers.
   *
   * @param {Object} message - Message to broadcast
   * @returns {Promise<void>}
   */
  async broadcast(message) {
    const broadcastMessage = {
      ...message,
      from: this._localNode.id,
      seq: ++this._messageSeq,
    };

    const peers = Array.from(this._peers.values());
    const targets = this._selectGossipTargets(peers);

    const sendPromises = targets.map((node) =>
      this._sendMessage(node, broadcastMessage).catch(() => {
        // Ignore broadcast failures to individual nodes
      })
    );

    await Promise.all(sendPromises);
  }

  /**
   * Performs a gossip round.
   *
   * @private
   */
  _performGossipRound() {
    if (!this._running || this._peers.size === 0) {
      return;
    }

    // Select random peers to gossip with
    const peers = Array.from(this._peers.values());
    const targets = this._selectGossipTargets(peers);

    // Send state to selected peers
    const stateMessage = {
      type: 'state-sync',
      from: this._localNode.id,
      node: this._localNode.toJSON ? this._localNode.toJSON() : this._localNode,
      seq: ++this._messageSeq,
      timestamp: Date.now(),
    };

    for (const node of targets) {
      this._sendMessage(node, stateMessage).catch(() => {
        // Gossip failures are expected occasionally
      });
    }
  }

  /**
   * Selects peers to gossip with.
   *
   * @param {import('./coordinator.js').ClusterNodeImpl[]} peers - Available peers
   * @returns {import('./coordinator.js').ClusterNodeImpl[]} Selected peers
   * @private
   */
  _selectGossipTargets(peers) {
    if (peers.length <= this._fanout) {
      return peers;
    }

    // Fisher-Yates shuffle and take first `fanout` elements
    const shuffled = [...peers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, this._fanout);
  }

  /**
   * Sends a message to a node.
   *
   * @param {import('./coordinator.js').ClusterNodeImpl} node - Target node
   * @param {Object} message - Message to send
   * @returns {Promise<void>}
   * @private
   */
  async _sendMessage(node, message) {
    return new Promise((resolve, reject) => {
      const socket = createConnection(
        { host: node.address, port: node.port },
        () => {
          const data = JSON.stringify(message);
          socket.write(data);
          socket.end();
          resolve();
        }
      );

      socket.setTimeout(DEFAULT_CONFIG.messageTimeout);

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Message timeout'));
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on('data', (data) => {
        try {
          const response = JSON.parse(data.toString());
          this._handleMessage(response, node);
        } catch {
          // Ignore parse errors
        }
      });
    });
  }

  /**
   * Handles an incoming message.
   *
   * @param {Object} message - Received message
   * @param {import('./coordinator.js').ClusterNodeImpl} fromNode - Source node
   * @private
   */
  _handleMessage(message, fromNode) {
    switch (message.type) {
      case 'ping':
        // Respond to ping
        this._sendMessage(fromNode, {
          type: 'pong',
          from: this._localNode.id,
          seq: message.seq,
          timestamp: Date.now(),
        }).catch(() => {});
        break;

      case 'pong':
        // Ping response received
        break;

      case 'state-sync':
      case 'state-change':
      case 'join':
      case 'leave':
        // Forward to message handler
        if (this._onMessage) {
          this._onMessage(message, fromNode);
        }
        break;

      default:
        // Unknown message type - forward to handler anyway
        if (this._onMessage) {
          this._onMessage(message, fromNode);
        }
    }
  }
}
