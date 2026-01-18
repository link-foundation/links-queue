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
 */

import type { Link, LinkId } from '../index.d.ts';

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

export type DeliveryStateValue =
  (typeof DeliveryState)[keyof typeof DeliveryState];

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
  constructor(id: LinkId, visibilityTimeoutMs: number, retryLimit: number);

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
// In-Flight Item (Timer-based tracking)
// =============================================================================

/**
 * Represents an in-flight queue item being processed.
 */
export interface InFlightItem {
  /**
   * The dequeued link.
   */
  readonly link: Link;

  /**
   * Number of delivery attempts for this item.
   */
  readonly deliveryCount: number;

  /**
   * Timestamp when the item was dequeued (ms since epoch).
   */
  readonly dequeuedAt: number;

  /**
   * Visibility timeout in milliseconds.
   */
  readonly visibilityTimeout: number;

  /**
   * Timer handle for auto-requeue (null in snapshots).
   */
  readonly timeoutHandle: ReturnType<typeof setTimeout> | null;
}

/**
 * Options for creating a DeliveryTracker.
 */
export interface DeliveryTrackerOptions {
  /**
   * Default visibility timeout in milliseconds.
   * @default 30000
   */
  visibilityTimeout?: number;

  /**
   * Maximum number of delivery attempts.
   * @default 3
   */
  retryLimit?: number;

  /**
   * Callback invoked when visibility timeout expires.
   */
  onTimeout?: (item: InFlightItem) => Promise<void>;

  /**
   * Callback invoked when retry limit is exceeded.
   */
  onDeadLetter?: (item: InFlightItem) => Promise<void>;
}

// =============================================================================
// DeliveryTracker (Timer-based - for LinksQueue)
// =============================================================================

/**
 * Manages delivery tracking for in-flight queue items with timer-based timeouts.
 *
 * Handles visibility timeouts, retry counting, and automatic requeue
 * when items are not acknowledged within the timeout period.
 */
export class DeliveryTracker {
  /**
   * Creates a new DeliveryTracker.
   *
   * @param options - Tracker options
   */
  constructor(options?: DeliveryTrackerOptions);

  /**
   * Gets the number of currently in-flight items.
   */
  readonly inFlightCount: number;

  /**
   * Gets the retry limit.
   */
  readonly retryLimit: number;

  /**
   * Gets the default visibility timeout in milliseconds.
   */
  readonly visibilityTimeout: number;

  /**
   * Tracks a dequeued item for delivery.
   *
   * @param id - The link ID
   * @param link - The dequeued link
   * @param visibilityTimeout - Override timeout for this item
   * @returns The tracked item
   */
  track(id: LinkId, link: Link, visibilityTimeout?: number): InFlightItem;

  /**
   * Acknowledges successful processing of an in-flight item.
   *
   * @param id - The link ID to acknowledge
   * @returns The acknowledged item, or null if not found
   */
  acknowledge(id: LinkId): InFlightItem | null;

  /**
   * Rejects an in-flight item.
   *
   * @param id - The link ID to reject
   * @param requeue - Whether to requeue the item
   * @returns The rejected item, or null if not found
   */
  reject(id: LinkId, requeue?: boolean): InFlightItem | null;

  /**
   * Gets the delivery count for an item.
   *
   * @param id - The link ID
   * @returns The delivery count (0 if never delivered)
   */
  getDeliveryCount(id: LinkId): number;

  /**
   * Checks if an item is currently in-flight.
   *
   * @param id - The link ID
   * @returns True if item is in-flight
   */
  isInFlight(id: LinkId): boolean;

  /**
   * Gets an in-flight item by ID.
   *
   * @param id - The link ID
   * @returns The in-flight item, or undefined
   */
  getInFlight(id: LinkId): InFlightItem | undefined;

  /**
   * Clears delivery count for an item.
   *
   * @param id - The link ID
   */
  clearDeliveryCount(id: LinkId): void;

  /**
   * Clears all tracking data and cancels all timeouts.
   */
  clear(): void;

  /**
   * Returns a snapshot of all in-flight items.
   *
   * @returns Array of in-flight item snapshots
   */
  getSnapshot(): Array<{ id: LinkId; item: InFlightItem }>;
}

// =============================================================================
// PollableDeliveryTracker (Poll-based - for MemoryQueue)
// =============================================================================

/**
 * Result of a reject operation.
 */
export interface RejectResult {
  state: DeliveryStateValue;
  shouldRequeue: boolean;
}

/**
 * Manages in-flight deliveries for a queue using poll-based expiry checking.
 */
export declare class PollableDeliveryTracker {
  /**
   * Creates a new delivery tracker with the specified defaults.
   */
  constructor(defaultVisibilityTimeoutMs?: number, defaultRetryLimit?: number);

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
