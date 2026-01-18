//! Delivery tracking for links-queue.
//!
//! This module provides tracking for in-flight messages, visibility timeouts,
//! retry counts, and dead letter queue support.
//!
//! # Overview
//!
//! - [`DeliveryState`] - State of a delivered message (in-flight, acknowledged, etc.)
//! - [`DeliveryRecord`] - Tracking record for a dequeued message
//! - [`DeliveryTracker`] - Manages all in-flight deliveries for a queue
//!
//! # Design
//!
//! When a message is dequeued, it becomes "in-flight" with a visibility timeout.
//! If the consumer doesn't acknowledge or reject within the timeout, the message
//! is automatically requeued. The delivery count is tracked for retry limits.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::LinkType;

// =============================================================================
// Delivery State
// =============================================================================

/// State of a delivered message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryState {
    /// Message is in-flight (dequeued but not yet acknowledged/rejected).
    InFlight,
    /// Message has been acknowledged and removed.
    Acknowledged,
    /// Message has been rejected and requeued.
    Requeued,
    /// Message has been rejected and dropped (no requeue).
    Dropped,
    /// Message exceeded retry limit and moved to dead letter queue.
    DeadLettered,
}

// =============================================================================
// Delivery Record
// =============================================================================

/// Tracking record for a dequeued message.
///
/// This record tracks the state of a message after it has been dequeued,
/// including when it was delivered and how many times it has been delivered.
#[derive(Debug, Clone)]
pub struct DeliveryRecord<T: LinkType> {
    /// The ID of the message (link).
    pub id: T,

    /// Current delivery state.
    pub state: DeliveryState,

    /// Time when the message was dequeued (became in-flight).
    pub delivered_at: Instant,

    /// Visibility timeout duration.
    pub visibility_timeout: Duration,

    /// Number of times this message has been delivered.
    /// Incremented each time the message is dequeued.
    pub delivery_count: u32,

    /// Maximum delivery attempts before dead-lettering.
    pub retry_limit: u32,
}

impl<T: LinkType> DeliveryRecord<T> {
    /// Creates a new delivery record.
    #[inline]
    pub fn new(id: T, visibility_timeout: Duration, retry_limit: u32) -> Self {
        Self {
            id,
            state: DeliveryState::InFlight,
            delivered_at: Instant::now(),
            visibility_timeout,
            delivery_count: 1,
            retry_limit,
        }
    }

    /// Returns true if the visibility timeout has expired.
    pub fn is_expired(&self) -> bool {
        self.delivered_at.elapsed() >= self.visibility_timeout
    }

    /// Returns the time remaining until visibility timeout expires.
    /// Returns `Duration::ZERO` if already expired.
    pub fn time_remaining(&self) -> Duration {
        let elapsed = self.delivered_at.elapsed();
        if elapsed >= self.visibility_timeout {
            Duration::ZERO
        } else {
            self.visibility_timeout.checked_sub(elapsed).unwrap()
        }
    }

    /// Returns true if this message has exceeded the retry limit.
    pub const fn exceeded_retry_limit(&self) -> bool {
        self.delivery_count > self.retry_limit
    }

    /// Increments the delivery count (for requeued messages).
    pub fn increment_delivery_count(&mut self) {
        self.delivery_count = self.delivery_count.saturating_add(1);
    }

    /// Resets the delivery timestamp (for requeued messages).
    pub fn reset_delivery_time(&mut self) {
        self.delivered_at = Instant::now();
    }
}

// =============================================================================
// Delivery Tracker
// =============================================================================

/// Manages in-flight deliveries for a queue.
///
/// Tracks all messages that have been dequeued but not yet acknowledged,
/// handles visibility timeout expiration, and supports dead letter queue
/// routing.
#[derive(Debug)]
pub struct DeliveryTracker<T: LinkType> {
    /// In-flight deliveries, keyed by message ID.
    deliveries: HashMap<T, DeliveryRecord<T>>,

    /// Default visibility timeout for new deliveries.
    default_visibility_timeout: Duration,

    /// Default retry limit for new deliveries.
    default_retry_limit: u32,
}

impl<T: LinkType> Default for DeliveryTracker<T> {
    fn default() -> Self {
        Self::new(Duration::from_secs(30), 3)
    }
}

impl<T: LinkType> DeliveryTracker<T> {
    /// Creates a new delivery tracker with the specified defaults.
    #[inline]
    #[must_use]
    pub fn new(default_visibility_timeout: Duration, default_retry_limit: u32) -> Self {
        Self {
            deliveries: HashMap::new(),
            default_visibility_timeout,
            default_retry_limit,
        }
    }

    /// Records a new delivery (message dequeued).
    ///
    /// If the message was previously delivered (requeue), the delivery count
    /// is incremented rather than creating a new record.
    pub fn record_delivery(&mut self, id: T) -> &DeliveryRecord<T> {
        let entry = self.deliveries.entry(id).or_insert_with(|| {
            DeliveryRecord::new(id, self.default_visibility_timeout, self.default_retry_limit)
        });

        // If re-delivering, update the record
        if entry.state == DeliveryState::Requeued {
            entry.state = DeliveryState::InFlight;
            entry.increment_delivery_count();
            entry.reset_delivery_time();
        }

        entry
    }

    /// Records a new delivery with a specific delivery count (for requeued messages).
    pub fn record_redelivery(&mut self, id: T, previous_delivery_count: u32) -> &DeliveryRecord<T> {
        let mut record =
            DeliveryRecord::new(id, self.default_visibility_timeout, self.default_retry_limit);
        record.delivery_count = previous_delivery_count + 1;
        self.deliveries.insert(id, record);
        self.deliveries.get(&id).expect("just inserted")
    }

    /// Gets a delivery record by ID.
    #[inline]
    pub fn get(&self, id: T) -> Option<&DeliveryRecord<T>> {
        self.deliveries.get(&id)
    }

    /// Gets a mutable delivery record by ID.
    #[inline]
    pub fn get_mut(&mut self, id: T) -> Option<&mut DeliveryRecord<T>> {
        self.deliveries.get_mut(&id)
    }

    /// Checks if a message is currently in-flight.
    pub fn is_in_flight(&self, id: T) -> bool {
        self.deliveries
            .get(&id)
            .is_some_and(|r| r.state == DeliveryState::InFlight)
    }

    /// Acknowledges a delivery, removing it from tracking.
    ///
    /// Returns true if the message was in-flight and is now acknowledged.
    pub fn acknowledge(&mut self, id: T) -> bool {
        if let Some(record) = self.deliveries.get_mut(&id) {
            if record.state == DeliveryState::InFlight {
                record.state = DeliveryState::Acknowledged;
                self.deliveries.remove(&id);
                return true;
            }
        }
        false
    }

    /// Rejects a delivery.
    ///
    /// If `requeue` is true and retry limit not exceeded, marks for requeue.
    /// Otherwise, marks as dropped or dead-lettered.
    ///
    /// Returns the final state and whether the message should be requeued.
    pub fn reject(&mut self, id: T, requeue: bool) -> Option<(DeliveryState, bool)> {
        let record = self.deliveries.get_mut(&id)?;

        if record.state != DeliveryState::InFlight {
            return None;
        }

        if requeue {
            if record.exceeded_retry_limit() {
                record.state = DeliveryState::DeadLettered;
                Some((DeliveryState::DeadLettered, false))
            } else {
                record.state = DeliveryState::Requeued;
                Some((DeliveryState::Requeued, true))
            }
        } else {
            record.state = DeliveryState::Dropped;
            self.deliveries.remove(&id);
            Some((DeliveryState::Dropped, false))
        }
    }

    /// Returns IDs of all expired in-flight messages.
    ///
    /// These messages should be requeued.
    #[must_use] 
    pub fn find_expired(&self) -> Vec<T> {
        self.deliveries
            .iter()
            .filter(|(_, record)| {
                record.state == DeliveryState::InFlight && record.is_expired()
            })
            .map(|(&id, _)| id)
            .collect()
    }

    /// Returns the number of in-flight messages.
    #[must_use] 
    pub fn in_flight_count(&self) -> usize {
        self.deliveries
            .values()
            .filter(|r| r.state == DeliveryState::InFlight)
            .count()
    }

    /// Removes a delivery record (for cleanup after processing).
    pub fn remove(&mut self, id: T) -> Option<DeliveryRecord<T>> {
        self.deliveries.remove(&id)
    }

    /// Gets the delivery count for a message.
    pub fn get_delivery_count(&self, id: T) -> u32 {
        self.deliveries
            .get(&id)
            .map_or(0, |r| r.delivery_count)
    }

    /// Clears all delivery records.
    pub fn clear(&mut self) {
        self.deliveries.clear();
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod delivery_record_tests {
        use super::*;

        #[test]
        fn test_new_delivery_record() {
            let record = DeliveryRecord::new(1u64, Duration::from_secs(30), 3);
            assert_eq!(record.id, 1);
            assert_eq!(record.state, DeliveryState::InFlight);
            assert_eq!(record.delivery_count, 1);
            assert_eq!(record.retry_limit, 3);
            assert!(!record.is_expired());
        }

        #[test]
        fn test_exceeded_retry_limit() {
            let mut record = DeliveryRecord::new(1u64, Duration::from_secs(30), 3);
            assert!(!record.exceeded_retry_limit()); // 1 <= 3

            record.delivery_count = 3;
            assert!(!record.exceeded_retry_limit()); // 3 <= 3

            record.delivery_count = 4;
            assert!(record.exceeded_retry_limit()); // 4 > 3
        }

        #[test]
        fn test_time_remaining() {
            let record = DeliveryRecord::new(1u64, Duration::from_secs(60), 3);
            let remaining = record.time_remaining();
            // Should be close to 60 seconds (allowing some tolerance)
            assert!(remaining.as_secs() >= 59);
        }

        #[test]
        fn test_increment_delivery_count() {
            let mut record = DeliveryRecord::new(1u64, Duration::from_secs(30), 3);
            assert_eq!(record.delivery_count, 1);

            record.increment_delivery_count();
            assert_eq!(record.delivery_count, 2);

            record.increment_delivery_count();
            assert_eq!(record.delivery_count, 3);
        }
    }

    mod delivery_tracker_tests {
        use super::*;

        #[test]
        fn test_new_tracker() {
            let tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);
            assert_eq!(tracker.in_flight_count(), 0);
        }

        #[test]
        fn test_default_tracker() {
            let tracker = DeliveryTracker::<u64>::default();
            assert_eq!(tracker.default_visibility_timeout, Duration::from_secs(30));
            assert_eq!(tracker.default_retry_limit, 3);
        }

        #[test]
        fn test_record_delivery() {
            let mut tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);

            let record = tracker.record_delivery(1);
            assert_eq!(record.id, 1);
            assert_eq!(record.state, DeliveryState::InFlight);
            assert_eq!(record.delivery_count, 1);

            assert_eq!(tracker.in_flight_count(), 1);
            assert!(tracker.is_in_flight(1));
        }

        #[test]
        fn test_acknowledge() {
            let mut tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);
            tracker.record_delivery(1);

            assert!(tracker.acknowledge(1));
            assert!(!tracker.is_in_flight(1));
            assert_eq!(tracker.in_flight_count(), 0);

            // Second ack should fail
            assert!(!tracker.acknowledge(1));
        }

        #[test]
        fn test_reject_with_requeue() {
            let mut tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);
            tracker.record_delivery(1);

            let result = tracker.reject(1, true);
            assert!(result.is_some());
            let (state, should_requeue) = result.unwrap();
            assert_eq!(state, DeliveryState::Requeued);
            assert!(should_requeue);
        }

        #[test]
        fn test_reject_without_requeue() {
            let mut tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);
            tracker.record_delivery(1);

            let result = tracker.reject(1, false);
            assert!(result.is_some());
            let (state, should_requeue) = result.unwrap();
            assert_eq!(state, DeliveryState::Dropped);
            assert!(!should_requeue);
        }

        #[test]
        fn test_reject_exceeds_retry_limit() {
            let mut tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);

            // Simulate message that has been delivered 4 times (exceeds limit of 3)
            tracker.record_redelivery(1, 3); // This makes delivery_count = 4

            let result = tracker.reject(1, true);
            assert!(result.is_some());
            let (state, should_requeue) = result.unwrap();
            assert_eq!(state, DeliveryState::DeadLettered);
            assert!(!should_requeue);
        }

        #[test]
        fn test_get_delivery_count() {
            let mut tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);

            assert_eq!(tracker.get_delivery_count(1), 0);

            tracker.record_delivery(1);
            assert_eq!(tracker.get_delivery_count(1), 1);

            // Simulate redelivery
            tracker.record_redelivery(1, 1);
            assert_eq!(tracker.get_delivery_count(1), 2);
        }

        #[test]
        fn test_clear() {
            let mut tracker = DeliveryTracker::<u64>::new(Duration::from_secs(30), 3);
            tracker.record_delivery(1);
            tracker.record_delivery(2);
            assert_eq!(tracker.in_flight_count(), 2);

            tracker.clear();
            assert_eq!(tracker.in_flight_count(), 0);
        }
    }
}
