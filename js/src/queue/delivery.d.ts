/**
 * Delivery tracking for links-queue.
 *
 * This module provides tracking for in-flight messages, visibility timeouts,
 * retry counts, and dead letter queue support.
 *
 * @module queue/delivery
 */

import type { LinkId } from '../index.d.ts';

// =============================================================================
// Delivery State
// =============================================================================

/**
 * State of a delivered message.
 */
export declare const DeliveryState: Readonly<{
  /** Message is in-flight (dequeued but not yet acknowledged/rejected). */
  IN_FLIGHT: 'IN_FLIGHT';
  /** Message has been acknowledged and removed. */
  ACKNOWLEDGED: 'ACKNOWLEDGED';
  /** Message has been rejected and requeued. */
  REQUEUED: 'REQUEUED';
  /** Message has been rejected and dropped (no requeue). */
  DROPPED: 'DROPPED';
  /** Message exceeded retry limit and moved to dead letter queue. */
  DEAD_LETTERED: 'DEAD_LETTERED';
}>;

export type DeliveryStateValue = (typeof DeliveryState)[keyof typeof DeliveryState];

// =============================================================================
// Delivery Record
// =============================================================================

/**
 * Tracking record for a dequeued message.
 */
export declare class DeliveryRecord {
  /** The ID of the message (link). */
  readonly id: LinkId;

  /** Current delivery state. */
  state: DeliveryStateValue;

  /** Time when the message was dequeued (became in-flight). */
  deliveredAt: number;

  /** Visibility timeout duration in milliseconds. */
  readonly visibilityTimeoutMs: number;

  /** Number of times this message has been delivered. */
  deliveryCount: number;

  /** Maximum delivery attempts before dead-lettering. */
  readonly retryLimit: number;

  /**
   * Creates a new delivery record.
   */
  constructor(
    id: LinkId,
    visibilityTimeoutMs: number,
    retryLimit: number
  );

  /** Returns true if the visibility timeout has expired. */
  isExpired(): boolean;

  /** Returns the time remaining until visibility timeout expires in ms. */
  timeRemaining(): number;

  /** Returns true if this message has exceeded the retry limit. */
  exceededRetryLimit(): boolean;

  /** Increments the delivery count (for requeued messages). */
  incrementDeliveryCount(): void;

  /** Resets the delivery timestamp (for requeued messages). */
  resetDeliveryTime(): void;
}

// =============================================================================
// Delivery Tracker
// =============================================================================

/**
 * Result of a reject operation.
 */
export interface RejectResult {
  state: DeliveryStateValue;
  shouldRequeue: boolean;
}

/**
 * Manages in-flight deliveries for a queue.
 */
export declare class DeliveryTracker {
  /**
   * Creates a new delivery tracker with the specified defaults.
   */
  constructor(
    defaultVisibilityTimeoutMs?: number,
    defaultRetryLimit?: number
  );

  /**
   * Records a new delivery (message dequeued).
   */
  recordDelivery(id: LinkId): DeliveryRecord;

  /**
   * Records a new delivery with a specific delivery count (for requeued messages).
   */
  recordRedelivery(id: LinkId, previousDeliveryCount: number): DeliveryRecord;

  /**
   * Gets a delivery record by ID.
   */
  get(id: LinkId): DeliveryRecord | undefined;

  /**
   * Checks if a message is currently in-flight.
   */
  isInFlight(id: LinkId): boolean;

  /**
   * Acknowledges a delivery, removing it from tracking.
   */
  acknowledge(id: LinkId): boolean;

  /**
   * Rejects a delivery.
   */
  reject(id: LinkId, requeue: boolean): RejectResult | null;

  /**
   * Returns IDs of all expired in-flight messages.
   */
  findExpired(): LinkId[];

  /**
   * Returns the number of in-flight messages.
   */
  inFlightCount(): number;

  /**
   * Removes a delivery record (for cleanup after processing).
   */
  remove(id: LinkId): DeliveryRecord | undefined;

  /**
   * Gets the delivery count for a message.
   */
  getDeliveryCount(id: LinkId): number;

  /**
   * Clears all delivery records.
   */
  clear(): void;
}
