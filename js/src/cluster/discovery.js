/**
 * Node discovery for links-queue multi-node clustering.
 *
 * This module provides the NodeDiscovery class that handles finding
 * and connecting to cluster nodes using various discovery methods.
 *
 * @module cluster/discovery
 *
 * @see ARCHITECTURE.md - Cluster Coordinator section
 * @see REQUIREMENTS.md - REQ-SCALE-001 through REQ-SCALE-003
 */

import { createConnection } from 'node:net';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default discovery configuration.
 */
const DEFAULT_CONFIG = {
  connectionTimeout: 5000,
  maxRetries: 3,
  retryDelay: 1000,
};

// =============================================================================
// NodeDiscovery Class
// =============================================================================

/**
 * Handles node discovery for cluster membership.
 *
 * Supports static node list and DNS-based discovery.
 *
 * @example
 * const discovery = new NodeDiscovery({
 *   discovery: 'static',
 *   nodes: ['node1:5000', 'node2:5000'],
 * });
 *
 * const nodes = await discovery.discover(['node1:5000', 'node2:5000']);
 * console.log(`Discovered ${nodes.length} nodes`);
 */
export class NodeDiscovery {
  /**
   * Creates a new NodeDiscovery instance.
   *
   * @param {import('./types.ts').ClusterConfig} config - Cluster configuration
   */
  constructor(config) {
    /**
     * Configuration.
     * @type {import('./types.ts').ClusterConfig}
     * @private
     */
    this._config = config;

    /**
     * Connection timeout in milliseconds.
     * @type {number}
     * @private
     */
    this._connectionTimeout =
      config.healthCheckTimeout ?? DEFAULT_CONFIG.connectionTimeout;
  }

  /**
   * Discovers nodes from the seed list.
   *
   * @param {string[]} seedNodes - List of seed node addresses (format: "host:port")
   * @returns {Promise<Array<{id?: string, address: string, port: number}>>} Discovered node info
   */
  async discover(seedNodes) {
    const discoveryMethod = this._config.discovery || 'static';

    switch (discoveryMethod) {
      case 'static':
        return this._discoverStatic(seedNodes);
      case 'dns':
        return this._discoverDns(seedNodes);
      default:
        return this._discoverStatic(seedNodes);
    }
  }

  /**
   * Discovers nodes using static configuration.
   *
   * @param {string[]} seedNodes - List of seed node addresses
   * @returns {Promise<Array<{id?: string, address: string, port: number}>>} Node info array
   * @private
   */
  async _discoverStatic(seedNodes) {
    const nodes = [];

    for (const nodeAddress of seedNodes) {
      const parsed = this._parseAddress(nodeAddress);
      if (!parsed) {
        continue;
      }

      const { address, port } = parsed;

      // Try to probe the node
      const isReachable = await this._probeNode(address, port);
      if (isReachable) {
        nodes.push({ address, port });
      }
    }

    return nodes;
  }

  /**
   * Discovers nodes using DNS SRV records.
   *
   * @param {string[]} seedNodes - List of seed node addresses
   * @returns {Promise<Array<{id?: string, address: string, port: number}>>} Node info array
   * @private
   */
  async _discoverDns(seedNodes) {
    // DNS-based discovery would require looking up SRV records
    // For now, fall back to static discovery
    // TODO: Implement DNS SRV record lookup
    return this._discoverStatic(seedNodes);
  }

  /**
   * Parses a node address string.
   *
   * @param {string} nodeAddress - Address in "host:port" format
   * @returns {{address: string, port: number}|null} Parsed address or null
   * @private
   */
  _parseAddress(nodeAddress) {
    if (!nodeAddress || typeof nodeAddress !== 'string') {
      return null;
    }

    const parts = nodeAddress.split(':');
    if (parts.length !== 2) {
      return null;
    }

    const [address, portStr] = parts;
    const port = parseInt(portStr, 10);

    if (isNaN(port) || port <= 0 || port > 65535) {
      return null;
    }

    return { address, port };
  }

  /**
   * Probes a node to check if it's reachable.
   *
   * @param {string} address - Node address
   * @param {number} port - Node port
   * @returns {Promise<boolean>} True if node is reachable
   * @private
   */
  async _probeNode(address, port) {
    return new Promise((resolve) => {
      const socket = createConnection({ host: address, port }, () => {
        socket.end();
        resolve(true);
      });

      socket.setTimeout(this._connectionTimeout);

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Refreshes the node list by re-running discovery.
   *
   * @returns {Promise<Array<{id?: string, address: string, port: number}>>} Updated node info
   */
  async refresh() {
    return this.discover(this._config.nodes || []);
  }
}
