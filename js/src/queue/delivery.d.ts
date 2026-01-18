/**
 * Delivery tracking module for links-queue.
 *
 * This module provides tracking for in-flight items including:
 * - Visibility timeout management
 * - Retry count tracking
 * - Automatic requeue on timeout
 *
 * @module queue/delivery
 */

import type { Link, LinkId } from '../index.d.ts';

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

/**
 * Manages delivery tracking for in-flight queue items.
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
