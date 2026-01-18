/**
 * Cluster error types for links-queue multi-node operation.
 *
 * @module cluster/types
 */

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for cluster operations.
 *
 * @typedef {'NOT_CONNECTED' | 'ALREADY_JOINED' | 'NODE_NOT_FOUND' | 'NO_LEADER' | 'REPLICATION_FAILED' | 'CONSISTENCY_ERROR' | 'PARTITION_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT'} ClusterErrorCode
 */

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
   * Creates a new ClusterError.
   *
   * @param {ClusterErrorCode} code - Error code
   * @param {string} message - Human-readable error message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ClusterError';
    /** @type {ClusterErrorCode} */
    this.code = code;
  }
}
