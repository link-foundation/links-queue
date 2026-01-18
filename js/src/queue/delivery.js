/**
 * Delivery tracking module for links-queue.
 *
 * This module provides tracking for in-flight items including:
 * - Visibility timeout management
 * - Retry count tracking
 * - Automatic requeue on timeout
 *
 * @module queue/delivery
 *
 * @see REQUIREMENTS.md - REQ-REL-001 through REQ-REL-013
 */

/**
 * Represents an in-flight queue item being processed.
 *
 * @typedef {Object} InFlightItem
 * @property {import('../index.d.ts').Link} link - The dequeued link
 * @property {number} deliveryCount - Number of delivery attempts
 * @property {number} dequeuedAt - Timestamp when dequeued (ms since epoch)
 * @property {number} visibilityTimeout - Timeout in milliseconds
 * @property {NodeJS.Timeout|null} timeoutHandle - Timer handle for auto-requeue
 */

/**
 * Manages delivery tracking for in-flight queue items.
 *
 * Handles visibility timeouts, retry counting, and automatic requeue
 * when items are not acknowledged within the timeout period.
 *
 * @example
 * const tracker = new DeliveryTracker({
 *   visibilityTimeout: 30000,  // 30 seconds
 *   retryLimit: 3,
 *   onTimeout: async (item) => {
 *     // Requeue the item
 *     await queue.requeue(item.link, item.deliveryCount);
 *   }
 * });
 *
 * // Track a dequeued item
 * tracker.track(linkId, link);
 *
 * // Mark as acknowledged
 * tracker.acknowledge(linkId);
 *
 * // Or reject and requeue
 * tracker.reject(linkId, true);
 */
export class DeliveryTracker {
  /**
   * Creates a new DeliveryTracker.
   *
   * @param {Object} options - Tracker options
   * @param {number} [options.visibilityTimeout=30000] - Default visibility timeout in ms
   * @param {number} [options.retryLimit=3] - Maximum delivery attempts
   * @param {(item: InFlightItem) => Promise<void>} [options.onTimeout] - Callback when timeout expires
   * @param {(item: InFlightItem) => Promise<void>} [options.onDeadLetter] - Callback when retry limit exceeded
   */
  constructor(options = {}) {
    /**
     * Default visibility timeout in milliseconds.
     * @type {number}
     * @private
     */
    this._visibilityTimeout = options.visibilityTimeout ?? 30000;

    /**
     * Maximum number of delivery attempts.
     * @type {number}
     * @private
     */
    this._retryLimit = options.retryLimit ?? 3;

    /**
     * Callback when visibility timeout expires.
     * @type {(item: InFlightItem) => Promise<void>}
     * @private
     */
    this._onTimeout = options.onTimeout ?? (async () => {});

    /**
     * Callback when retry limit is exceeded.
     * @type {(item: InFlightItem) => Promise<void>}
     * @private
     */
    this._onDeadLetter = options.onDeadLetter ?? (async () => {});

    /**
     * Map of in-flight items by link ID.
     * @type {Map<import('../index.d.ts').LinkId, InFlightItem>}
     * @private
     */
    this._inFlight = new Map();

    /**
     * Track delivery counts for items (persists across requeues).
     * @type {Map<import('../index.d.ts').LinkId, number>}
     * @private
     */
    this._deliveryCounts = new Map();
  }

  /**
   * Gets the number of currently in-flight items.
   *
   * @returns {number} Number of in-flight items
   */
  get inFlightCount() {
    return this._inFlight.size;
  }

  /**
   * Gets the retry limit.
   *
   * @returns {number} Maximum delivery attempts
   */
  get retryLimit() {
    return this._retryLimit;
  }

  /**
   * Gets the default visibility timeout.
   *
   * @returns {number} Visibility timeout in milliseconds
   */
  get visibilityTimeout() {
    return this._visibilityTimeout;
  }

  /**
   * Tracks a dequeued item for delivery.
   *
   * Starts a visibility timeout timer. If the item is not acknowledged
   * or rejected within the timeout, the onTimeout callback is invoked.
   *
   * @param {import('../index.d.ts').LinkId} id - The link ID
   * @param {import('../index.d.ts').Link} link - The dequeued link
   * @param {number} [visibilityTimeout] - Override timeout for this item
   * @returns {InFlightItem} The tracked item
   */
  track(id, link, visibilityTimeout = this._visibilityTimeout) {
    // Get or initialize delivery count
    const currentCount = this._deliveryCounts.get(id) ?? 0;
    const deliveryCount = currentCount + 1;
    this._deliveryCounts.set(id, deliveryCount);

    const item = {
      link,
      deliveryCount,
      dequeuedAt: Date.now(),
      visibilityTimeout,
      timeoutHandle: null,
    };

    // Set up visibility timeout
    item.timeoutHandle = globalThis.setTimeout(async () => {
      // Only trigger if still in-flight
      if (this._inFlight.has(id)) {
        this._inFlight.delete(id);

        // Check if retry limit exceeded
        if (deliveryCount >= this._retryLimit) {
          await this._onDeadLetter(item);
        } else {
          await this._onTimeout(item);
        }
      }
    }, visibilityTimeout);

    this._inFlight.set(id, item);
    return item;
  }

  /**
   * Acknowledges successful processing of an in-flight item.
   *
   * The item is removed from tracking and its delivery count is cleared.
   *
   * @param {import('../index.d.ts').LinkId} id - The link ID to acknowledge
   * @returns {InFlightItem|null} The acknowledged item, or null if not found
   * @throws {import('./types.js').QueueError} If item is not in-flight
   */
  acknowledge(id) {
    const item = this._inFlight.get(id);
    if (!item) {
      return null;
    }

    // Clear the timeout
    if (item.timeoutHandle) {
      globalThis.clearTimeout(item.timeoutHandle);
    }

    // Remove from tracking
    this._inFlight.delete(id);
    this._deliveryCounts.delete(id);

    return item;
  }

  /**
   * Rejects an in-flight item.
   *
   * If requeue is true and retry limit not exceeded, the onTimeout callback
   * will be invoked to requeue the item. Otherwise, the item is discarded
   * or moved to dead letter queue.
   *
   * @param {import('../index.d.ts').LinkId} id - The link ID to reject
   * @param {boolean} [requeue=false] - Whether to requeue the item
   * @returns {InFlightItem|null} The rejected item, or null if not found
   */
  reject(id, requeue = false) {
    const item = this._inFlight.get(id);
    if (!item) {
      return null;
    }

    // Clear the timeout
    if (item.timeoutHandle) {
      globalThis.clearTimeout(item.timeoutHandle);
    }

    // Remove from in-flight
    this._inFlight.delete(id);

    if (!requeue) {
      // Not requeuing - clear delivery count
      this._deliveryCounts.delete(id);
      return item;
    }

    // Check if retry limit exceeded
    if (item.deliveryCount >= this._retryLimit) {
      // Will be moved to DLQ - don't clear delivery count yet
      return item;
    }

    // Keep delivery count for requeue
    return item;
  }

  /**
   * Gets the delivery count for an item.
   *
   * @param {import('../index.d.ts').LinkId} id - The link ID
   * @returns {number} The delivery count (0 if never delivered)
   */
  getDeliveryCount(id) {
    return this._deliveryCounts.get(id) ?? 0;
  }

  /**
   * Checks if an item is currently in-flight.
   *
   * @param {import('../index.d.ts').LinkId} id - The link ID
   * @returns {boolean} True if item is in-flight
   */
  isInFlight(id) {
    return this._inFlight.has(id);
  }

  /**
   * Gets an in-flight item by ID.
   *
   * @param {import('../index.d.ts').LinkId} id - The link ID
   * @returns {InFlightItem|undefined} The in-flight item, or undefined
   */
  getInFlight(id) {
    return this._inFlight.get(id);
  }

  /**
   * Clears delivery count for an item (after successful dead letter).
   *
   * @param {import('../index.d.ts').LinkId} id - The link ID
   */
  clearDeliveryCount(id) {
    this._deliveryCounts.delete(id);
  }

  /**
   * Clears all tracking data and cancels all timeouts.
   */
  clear() {
    // Cancel all timeouts
    for (const item of this._inFlight.values()) {
      if (item.timeoutHandle) {
        globalThis.clearTimeout(item.timeoutHandle);
      }
    }

    this._inFlight.clear();
    this._deliveryCounts.clear();
  }

  /**
   * Returns a snapshot of all in-flight items.
   *
   * @returns {Array<{id: import('../index.d.ts').LinkId, item: InFlightItem}>}
   */
  getSnapshot() {
    return Array.from(this._inFlight.entries()).map(([id, item]) => ({
      id,
      item: { ...item, timeoutHandle: null }, // Don't expose timer
    }));
  }
}
