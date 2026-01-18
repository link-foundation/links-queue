/**
 * Delivery tracking module for links-queue.
 *
 * This module provides tracking for in-flight items including:
 * - Visibility timeout management
 * - Retry count tracking
 * - Automatic requeue on timeout
 * - Dead letter queue support
 *
 * The module provides two delivery tracking approaches:
 * - DeliveryTracker: Timer-based tracking with automatic callbacks (for LinksQueue)
 * - PollableDeliveryTracker: Poll-based tracking with manual expiry checking (for MemoryQueue)
 *
 * @module queue/delivery
 *
 * @see REQUIREMENTS.md - REQ-REL-001 through REQ-REL-013
 */

// =============================================================================
// Delivery State
// =============================================================================

/**
 * State of a delivered message.
 * @readonly
 * @enum {string}
 */
export const DeliveryState = Object.freeze({
  /** Message is in-flight (dequeued but not yet acknowledged/rejected). */
  IN_FLIGHT: 'IN_FLIGHT',
  /** Message has been acknowledged and removed. */
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  /** Message has been rejected and requeued. */
  REQUEUED: 'REQUEUED',
  /** Message has been rejected and dropped (no requeue). */
  DROPPED: 'DROPPED',
  /** Message exceeded retry limit and moved to dead letter queue. */
  DEAD_LETTERED: 'DEAD_LETTERED',
});

// =============================================================================
// Delivery Record
// =============================================================================

/**
 * Tracking record for a dequeued message.
 *
 * This record tracks the state of a message after it has been dequeued,
 * including when it was delivered and how many times it has been delivered.
 */
export class DeliveryRecord {
  /**
   * Creates a new delivery record.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the message (link)
   * @param {number} visibilityTimeoutMs - Visibility timeout in milliseconds
   * @param {number} retryLimit - Maximum delivery attempts before dead-lettering
   */
  constructor(id, visibilityTimeoutMs, retryLimit) {
    /** @type {import('../index.d.ts').LinkId} The ID of the message (link). */
    this.id = id;

    /** @type {string} Current delivery state. */
    this.state = DeliveryState.IN_FLIGHT;

    /** @type {number} Time when the message was dequeued (became in-flight). */
    this.deliveredAt = Date.now();

    /** @type {number} Visibility timeout duration in milliseconds. */
    this.visibilityTimeoutMs = visibilityTimeoutMs;

    /**
     * Number of times this message has been delivered.
     * Incremented each time the message is dequeued.
     * @type {number}
     */
    this.deliveryCount = 1;

    /** @type {number} Maximum delivery attempts before dead-lettering. */
    this.retryLimit = retryLimit;
  }

  /**
   * Returns true if the visibility timeout has expired.
   * @returns {boolean}
   */
  isExpired() {
    return Date.now() - this.deliveredAt >= this.visibilityTimeoutMs;
  }

  /**
   * Returns the time remaining until visibility timeout expires in ms.
   * Returns 0 if already expired.
   * @returns {number}
   */
  timeRemaining() {
    const elapsed = Date.now() - this.deliveredAt;
    if (elapsed >= this.visibilityTimeoutMs) {
      return 0;
    }
    return this.visibilityTimeoutMs - elapsed;
  }

  /**
   * Returns true if this message has exceeded the retry limit.
   * @returns {boolean}
   */
  exceededRetryLimit() {
    return this.deliveryCount > this.retryLimit;
  }

  /**
   * Increments the delivery count (for requeued messages).
   */
  incrementDeliveryCount() {
    this.deliveryCount++;
  }

  /**
   * Resets the delivery timestamp (for requeued messages).
   */
  resetDeliveryTime() {
    this.deliveredAt = Date.now();
  }
}

// =============================================================================
// In-Flight Item (Timer-based tracking)
// =============================================================================

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

// =============================================================================
// DeliveryTracker (Timer-based - for LinksQueue)
// =============================================================================

/**
 * Manages delivery tracking for in-flight queue items with timer-based timeouts.
 *
 * Handles visibility timeouts, retry counting, and automatic requeue
 * when items are not acknowledged within the timeout period.
 *
 * This tracker uses JavaScript timers to automatically trigger callbacks
 * when visibility timeouts expire.
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

// =============================================================================
// PollableDeliveryTracker (Poll-based - for MemoryQueue)
// =============================================================================

/**
 * Manages in-flight deliveries for a queue using poll-based expiry checking.
 *
 * Tracks all messages that have been dequeued but not yet acknowledged,
 * handles visibility timeout expiration via manual polling, and supports
 * dead letter queue routing.
 *
 * This tracker does not use timers and requires manual calls to findExpired()
 * to check for timed-out messages.
 */
export class PollableDeliveryTracker {
  /**
   * Creates a new delivery tracker with the specified defaults.
   *
   * @param {number} [defaultVisibilityTimeoutMs=30000] - Default visibility timeout in ms
   * @param {number} [defaultRetryLimit=3] - Default retry limit
   */
  constructor(defaultVisibilityTimeoutMs = 30000, defaultRetryLimit = 3) {
    /**
     * In-flight deliveries, keyed by message ID.
     * @type {Map<import('../index.d.ts').LinkId, DeliveryRecord>}
     * @private
     */
    this._deliveries = new Map();

    /** @type {number} Default visibility timeout for new deliveries in ms. */
    this._defaultVisibilityTimeoutMs = defaultVisibilityTimeoutMs;

    /** @type {number} Default retry limit for new deliveries. */
    this._defaultRetryLimit = defaultRetryLimit;
  }

  /**
   * Records a new delivery (message dequeued).
   *
   * If the message was previously delivered (requeue), the delivery count
   * is incremented rather than creating a new record.
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @returns {DeliveryRecord} The delivery record
   */
  recordDelivery(id) {
    let record = this._deliveries.get(id);

    if (record) {
      // If re-delivering, update the record
      if (record.state === DeliveryState.REQUEUED) {
        record.state = DeliveryState.IN_FLIGHT;
        record.incrementDeliveryCount();
        record.resetDeliveryTime();
      }
    } else {
      record = new DeliveryRecord(
        id,
        this._defaultVisibilityTimeoutMs,
        this._defaultRetryLimit
      );
      this._deliveries.set(id, record);
    }

    return record;
  }

  /**
   * Records a new delivery with a specific delivery count (for requeued messages).
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @param {number} previousDeliveryCount - The previous delivery count
   * @returns {DeliveryRecord} The delivery record
   */
  recordRedelivery(id, previousDeliveryCount) {
    const record = new DeliveryRecord(
      id,
      this._defaultVisibilityTimeoutMs,
      this._defaultRetryLimit
    );
    record.deliveryCount = previousDeliveryCount + 1;
    this._deliveries.set(id, record);
    return record;
  }

  /**
   * Gets a delivery record by ID.
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @returns {DeliveryRecord | undefined}
   */
  get(id) {
    return this._deliveries.get(id);
  }

  /**
   * Checks if a message is currently in-flight.
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @returns {boolean}
   */
  isInFlight(id) {
    const record = this._deliveries.get(id);
    return record !== undefined && record.state === DeliveryState.IN_FLIGHT;
  }

  /**
   * Acknowledges a delivery, removing it from tracking.
   *
   * Returns true if the message was in-flight and is now acknowledged.
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @returns {boolean}
   */
  acknowledge(id) {
    const record = this._deliveries.get(id);

    if (record && record.state === DeliveryState.IN_FLIGHT) {
      record.state = DeliveryState.ACKNOWLEDGED;
      this._deliveries.delete(id);
      return true;
    }

    return false;
  }

  /**
   * Rejects a delivery.
   *
   * If `requeue` is true and retry limit not exceeded, marks for requeue.
   * Otherwise, marks as dropped or dead-lettered.
   *
   * Returns the final state and whether the message should be requeued.
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @param {boolean} requeue - Whether to requeue the message
   * @returns {{ state: string, shouldRequeue: boolean } | null}
   */
  reject(id, requeue) {
    const record = this._deliveries.get(id);

    if (!record || record.state !== DeliveryState.IN_FLIGHT) {
      return null;
    }

    if (requeue) {
      if (record.exceededRetryLimit()) {
        record.state = DeliveryState.DEAD_LETTERED;
        return { state: DeliveryState.DEAD_LETTERED, shouldRequeue: false };
      }
      record.state = DeliveryState.REQUEUED;
      return { state: DeliveryState.REQUEUED, shouldRequeue: true };
    }

    record.state = DeliveryState.DROPPED;
    this._deliveries.delete(id);
    return { state: DeliveryState.DROPPED, shouldRequeue: false };
  }

  /**
   * Returns IDs of all expired in-flight messages.
   *
   * These messages should be requeued.
   *
   * @returns {import('../index.d.ts').LinkId[]}
   */
  findExpired() {
    const expired = [];

    for (const [id, record] of this._deliveries) {
      if (record.state === DeliveryState.IN_FLIGHT && record.isExpired()) {
        expired.push(id);
      }
    }

    return expired;
  }

  /**
   * Returns the number of in-flight messages.
   *
   * @returns {number}
   */
  inFlightCount() {
    let count = 0;
    for (const record of this._deliveries.values()) {
      if (record.state === DeliveryState.IN_FLIGHT) {
        count++;
      }
    }
    return count;
  }

  /**
   * Removes a delivery record (for cleanup after processing).
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @returns {DeliveryRecord | undefined}
   */
  remove(id) {
    const record = this._deliveries.get(id);
    this._deliveries.delete(id);
    return record;
  }

  /**
   * Gets the delivery count for a message.
   *
   * @param {import('../index.d.ts').LinkId} id - The message ID
   * @returns {number}
   */
  getDeliveryCount(id) {
    const record = this._deliveries.get(id);
    return record ? record.deliveryCount : 0;
  }

  /**
   * Clears all delivery records.
   */
  clear() {
    this._deliveries.clear();
  }
}
