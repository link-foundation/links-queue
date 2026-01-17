/**
 * Queue and QueueManager type definitions for links-queue.
 *
 * This module provides the QueueError class and type definitions for queue
 * operations and queue management. These interfaces establish the API contract
 * that implementations must follow.
 *
 * @module queue/types
 *
 * Design goals:
 * - Build on top of LinkStore, adding queue-specific semantics
 * - Support multiple queue patterns (point-to-point, pub/sub, etc.)
 * - Provide reliability guarantees (at-least-once delivery, dead letter queues)
 * - Maintain API parity between JavaScript and Rust implementations
 *
 * @see https://github.com/link-foundation/links-queue
 * @see ARCHITECTURE.md - Queue Manager component
 * @see REQUIREMENTS.md - REQ-API-001 through REQ-API-022
 */

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown by queue operations.
 *
 * @example
 * try {
 *   await queue.enqueue(link);
 * } catch (error) {
 *   if (error instanceof QueueError && error.code === 'QUEUE_FULL') {
 *     console.log('Queue is at capacity');
 *   }
 * }
 */
export class QueueError extends Error {
  /**
   * Creates a new QueueError.
   *
   * @param {string} code - Error code identifying the type of error
   * @param {string} message - Human-readable error message
   */
  constructor(code, message) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
  }
}
