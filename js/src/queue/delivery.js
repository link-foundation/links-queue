/**
 * Delivery tracking for links-queue.
 *
 * This module provides tracking for in-flight messages, visibility timeouts,
 * retry counts, and dead letter queue support.
 *
 * @module queue/delivery
 *
 * Overview:
 * - DeliveryState - State of a delivered message (in-flight, acknowledged, etc.)
 * - DeliveryRecord - Tracking record for a dequeued message
 * - DeliveryTracker - Manages all in-flight deliveries for a queue
 *
 * Design:
 * When a message is dequeued, it becomes "in-flight" with a visibility timeout.
 * If the consumer doesn't acknowledge or reject within the timeout, the message
 * is automatically requeued. The delivery count is tracked for retry limits.
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
// Delivery Tracker
// =============================================================================

/**
 * Manages in-flight deliveries for a queue.
 *
 * Tracks all messages that have been dequeued but not yet acknowledged,
 * handles visibility timeout expiration, and supports dead letter queue
 * routing.
 */
export class DeliveryTracker {
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
