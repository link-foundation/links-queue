//! Queue and `QueueManager` trait definitions for links-queue.
//!
//! This module provides the interfaces for queue operations and queue management.
//! These traits establish the API contract that implementations must follow.
//!
//! # Design Goals
//!
//! - Build on top of `LinkStore`, adding queue-specific semantics
//! - Support multiple queue patterns (point-to-point, pub/sub, etc.)
//! - Provide reliability guarantees (at-least-once delivery, dead letter queues)
//! - Maintain API parity between JavaScript and Rust implementations
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::queue::{Queue, QueueManager, QueueOptions};
//! use links_queue::{Link, LinkRef};
//!
//! // Create a queue manager
//! let manager = MemoryQueueManager::new(link_store);
//!
//! // Create a queue with options
//! let options = QueueOptions::default()
//!     .with_max_size(10000)
//!     .with_visibility_timeout(30);
//! let queue = manager.create_queue("tasks", options).await?;
//!
//! // Enqueue an item
//! let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
//! let result = queue.enqueue(link).await?;
//! println!("Enqueued at position {}", result.position);
//!
//! // Dequeue and process
//! if let Some(item) = queue.dequeue().await? {
//!     // Process the item...
//!     queue.acknowledge(item.id).await?;
//! }
//! ```
//!
//! # References
//!
//! - [ARCHITECTURE.md](../../../ARCHITECTURE.md) - Queue Manager component
//! - [REQUIREMENTS.md](../../../REQUIREMENTS.md) - REQ-API-001 through REQ-API-022

use std::fmt::Debug;

use crate::{Link, LinkType};

// =============================================================================
// Queue Result Types
// =============================================================================

/// Result returned when a link is successfully enqueued.
///
/// # Examples
///
/// ```rust,ignore
/// let result = queue.enqueue(link).await?;
/// println!("Enqueued item {} at position {}", result.id, result.position);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnqueueResult<T: LinkType> {
    /// The unique identifier for this queue item.
    /// This ID is used for acknowledgment and rejection.
    pub id: T,

    /// The position in the queue (0-based).
    /// A position of 0 means this item is next to be dequeued.
    pub position: usize,
}

impl<T: LinkType> EnqueueResult<T> {
    /// Creates a new `EnqueueResult`.
    #[inline]
    pub const fn new(id: T, position: usize) -> Self {
        Self { id, position }
    }
}

/// Statistics and metrics for a queue.
///
/// Provides insight into queue health and processing status.
///
/// # Examples
///
/// ```rust,ignore
/// let stats = queue.stats();
/// println!("Queue depth: {}, In-flight: {}", stats.depth, stats.in_flight);
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct QueueStats {
    /// Current number of items in the queue (not including in-flight).
    pub depth: usize,

    /// Total number of items enqueued since queue creation.
    pub enqueued: usize,

    /// Total number of items dequeued since queue creation.
    pub dequeued: usize,

    /// Total number of items successfully acknowledged.
    pub acknowledged: usize,

    /// Total number of items rejected (regardless of requeue status).
    pub rejected: usize,

    /// Number of items currently in-flight (dequeued but not yet acknowledged).
    /// These items may be requeued if visibility timeout expires.
    pub in_flight: usize,
}

impl QueueStats {
    /// Creates a new `QueueStats` with all counters at zero.
    #[inline]
    #[must_use]
    pub const fn new() -> Self {
        Self {
            depth: 0,
            enqueued: 0,
            dequeued: 0,
            acknowledged: 0,
            rejected: 0,
            in_flight: 0,
        }
    }
}

// =============================================================================
// Queue Options
// =============================================================================

/// Options for creating a new queue.
///
/// # Examples
///
/// ```rust
/// use links_queue::queue::QueueOptions;
///
/// let options = QueueOptions::default()
///     .with_max_size(10000)
///     .with_visibility_timeout(30)
///     .with_retry_limit(3)
///     .with_dead_letter_queue("my-queue-dlq".to_string())
///     .with_priority(true);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueOptions {
    /// Maximum queue depth. Enqueue operations will fail if this limit is reached.
    /// Defaults to `usize::MAX` (unlimited).
    pub max_size: Option<usize>,

    /// Visibility timeout in seconds. After dequeue, the item becomes invisible
    /// to other consumers for this duration. If not acknowledged within this time,
    /// the item is automatically requeued.
    /// Defaults to 30 seconds.
    pub visibility_timeout: Option<u64>,

    /// Maximum number of delivery attempts before moving to dead letter queue.
    /// Defaults to 3.
    pub retry_limit: Option<u32>,

    /// Name of the dead letter queue for failed messages.
    /// If not specified, failed messages after retry_limit are dropped.
    pub dead_letter_queue: Option<String>,

    /// Enable priority ordering. When true, items with lower source ID values
    /// are dequeued first (using Link's source as priority indicator).
    /// Defaults to false (FIFO ordering).
    pub priority: Option<bool>,
}

impl Default for QueueOptions {
    fn default() -> Self {
        Self {
            max_size: None,
            visibility_timeout: None,
            retry_limit: None,
            dead_letter_queue: None,
            priority: None,
        }
    }
}

impl QueueOptions {
    /// Creates new `QueueOptions` with all defaults.
    #[inline]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the maximum queue size.
    #[inline]
    #[must_use]
    pub const fn with_max_size(mut self, max_size: usize) -> Self {
        self.max_size = Some(max_size);
        self
    }

    /// Sets the visibility timeout in seconds.
    #[inline]
    #[must_use]
    pub const fn with_visibility_timeout(mut self, timeout: u64) -> Self {
        self.visibility_timeout = Some(timeout);
        self
    }

    /// Sets the retry limit.
    #[inline]
    #[must_use]
    pub const fn with_retry_limit(mut self, limit: u32) -> Self {
        self.retry_limit = Some(limit);
        self
    }

    /// Sets the dead letter queue name.
    #[inline]
    #[must_use]
    pub fn with_dead_letter_queue(mut self, name: String) -> Self {
        self.dead_letter_queue = Some(name);
        self
    }

    /// Sets whether priority ordering is enabled.
    #[inline]
    #[must_use]
    pub const fn with_priority(mut self, enabled: bool) -> Self {
        self.priority = Some(enabled);
        self
    }

    /// Returns the max_size or the default value.
    #[inline]
    #[must_use]
    pub fn max_size_or_default(&self) -> usize {
        self.max_size.unwrap_or(usize::MAX)
    }

    /// Returns the visibility_timeout or the default value (30 seconds).
    #[inline]
    #[must_use]
    pub fn visibility_timeout_or_default(&self) -> u64 {
        self.visibility_timeout.unwrap_or(30)
    }

    /// Returns the retry_limit or the default value (3).
    #[inline]
    #[must_use]
    pub fn retry_limit_or_default(&self) -> u32 {
        self.retry_limit.unwrap_or(3)
    }

    /// Returns whether priority ordering is enabled (default: false).
    #[inline]
    #[must_use]
    pub fn priority_or_default(&self) -> bool {
        self.priority.unwrap_or(false)
    }
}

// =============================================================================
// Queue Error Types
// =============================================================================

/// Error codes for queue operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum QueueErrorCode {
    /// The queue is at maximum capacity.
    QueueFull,
    /// The specified queue was not found.
    QueueNotFound,
    /// A queue with this name already exists.
    QueueAlreadyExists,
    /// The specified item was not found.
    ItemNotFound,
    /// The item is not in the in-flight state.
    ItemNotInFlight,
    /// Invalid operation for the current state.
    InvalidOperation,
}

impl std::fmt::Display for QueueErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::QueueFull => write!(f, "QUEUE_FULL"),
            Self::QueueNotFound => write!(f, "QUEUE_NOT_FOUND"),
            Self::QueueAlreadyExists => write!(f, "QUEUE_ALREADY_EXISTS"),
            Self::ItemNotFound => write!(f, "ITEM_NOT_FOUND"),
            Self::ItemNotInFlight => write!(f, "ITEM_NOT_IN_FLIGHT"),
            Self::InvalidOperation => write!(f, "INVALID_OPERATION"),
        }
    }
}

/// Error returned by queue operations.
///
/// # Examples
///
/// ```rust,ignore
/// match queue.enqueue(link).await {
///     Ok(result) => println!("Enqueued at {}", result.position),
///     Err(QueueError { code: QueueErrorCode::QueueFull, .. }) => {
///         println!("Queue is at capacity");
///     }
///     Err(e) => return Err(e.into()),
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueError {
    /// The error code identifying the type of error.
    pub code: QueueErrorCode,
    /// Human-readable error message.
    pub message: String,
}

impl QueueError {
    /// Creates a new `QueueError`.
    #[inline]
    pub fn new(code: QueueErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Creates a "queue full" error.
    #[inline]
    #[must_use]
    pub fn queue_full(queue_name: &str) -> Self {
        Self::new(
            QueueErrorCode::QueueFull,
            format!("Queue '{}' is at maximum capacity", queue_name),
        )
    }

    /// Creates a "queue not found" error.
    #[inline]
    #[must_use]
    pub fn queue_not_found(queue_name: &str) -> Self {
        Self::new(
            QueueErrorCode::QueueNotFound,
            format!("Queue '{}' not found", queue_name),
        )
    }

    /// Creates a "queue already exists" error.
    #[inline]
    #[must_use]
    pub fn queue_already_exists(queue_name: &str) -> Self {
        Self::new(
            QueueErrorCode::QueueAlreadyExists,
            format!("Queue '{}' already exists", queue_name),
        )
    }

    /// Creates an "item not found" error.
    #[inline]
    #[must_use]
    pub fn item_not_found<T: Debug>(item_id: T) -> Self {
        Self::new(
            QueueErrorCode::ItemNotFound,
            format!("Item with ID {:?} not found", item_id),
        )
    }

    /// Creates an "item not in flight" error.
    #[inline]
    #[must_use]
    pub fn item_not_in_flight<T: Debug>(item_id: T) -> Self {
        Self::new(
            QueueErrorCode::ItemNotInFlight,
            format!("Item with ID {:?} is not in flight", item_id),
        )
    }
}

impl std::fmt::Display for QueueError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for QueueError {}

/// Result type for queue operations.
pub type QueueResult<T> = Result<T, QueueError>;

// =============================================================================
// Queue Trait
// =============================================================================

/// Trait for queue operations.
///
/// A Queue provides standard message queue operations built on top of the
/// Link data model. Each queue item is represented as a Link.
///
/// The design follows the message queue patterns established by systems like
/// RabbitMQ and SQS, adapted for the link-based data model.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::queue::{Queue, QueueResult};
/// use links_queue::{Link, LinkRef};
///
/// async fn process_items<T, Q>(queue: &Q) -> QueueResult<()>
/// where
///     T: LinkType,
///     Q: Queue<T>,
/// {
///     // Dequeue and process items
///     while let Some(item) = queue.dequeue().await? {
///         // Process the item...
///         queue.acknowledge(item.id).await?;
///     }
///     Ok(())
/// }
/// ```
pub trait Queue<T: LinkType>: Send + Sync {
    /// Returns the name of this queue.
    fn name(&self) -> &str;

    // -------------------------------------------------------------------------
    // Core Operations
    // -------------------------------------------------------------------------

    /// Adds a link to the queue.
    ///
    /// The link is added to the end of the queue (or according to priority
    /// if priority ordering is enabled).
    ///
    /// # Arguments
    ///
    /// * `link` - The link to enqueue
    ///
    /// # Returns
    ///
    /// The enqueue result with ID and position.
    ///
    /// # Errors
    ///
    /// Returns `QueueError` if the queue is at max capacity.
    fn enqueue(
        &self,
        link: Link<T>,
    ) -> impl std::future::Future<Output = QueueResult<EnqueueResult<T>>> + Send;

    /// Removes and returns the next link from the queue.
    ///
    /// The item becomes invisible to other consumers for the visibility timeout
    /// duration. It must be acknowledged or rejected before the timeout expires,
    /// otherwise it will be automatically requeued.
    ///
    /// # Returns
    ///
    /// The next Link, or None if the queue is empty.
    fn dequeue(&self) -> impl std::future::Future<Output = QueueResult<Option<Link<T>>>> + Send;

    /// Returns the next link without removing it from the queue.
    ///
    /// Unlike dequeue, this does not affect visibility timeout or delivery count.
    ///
    /// # Returns
    ///
    /// The next Link, or None if the queue is empty.
    fn peek(&self) -> impl std::future::Future<Output = QueueResult<Option<Link<T>>>> + Send;

    /// Acknowledges successful processing of a dequeued item.
    ///
    /// The item is permanently removed from the queue. This should be called
    /// after successfully processing a dequeued item.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID of the item to acknowledge
    ///
    /// # Errors
    ///
    /// Returns `QueueError` if the ID is not found or item is not in-flight.
    fn acknowledge(&self, id: T) -> impl std::future::Future<Output = QueueResult<()>> + Send;

    /// Rejects a dequeued item, optionally requeuing it.
    ///
    /// If requeue is true, the item is placed back in the queue for redelivery.
    /// The delivery count is incremented. If the delivery count exceeds retry_limit,
    /// the item is moved to the dead letter queue (if configured) or dropped.
    ///
    /// If requeue is false, the item is permanently removed.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID of the item to reject
    /// * `requeue` - Whether to requeue the item for redelivery
    ///
    /// # Errors
    ///
    /// Returns `QueueError` if the ID is not found or item is not in-flight.
    fn reject(
        &self,
        id: T,
        requeue: bool,
    ) -> impl std::future::Future<Output = QueueResult<()>> + Send;

    // -------------------------------------------------------------------------
    // Status Operations
    // -------------------------------------------------------------------------

    /// Returns statistics for this queue.
    fn stats(&self) -> QueueStats;

    /// Returns the current queue depth (number of items waiting to be dequeued).
    ///
    /// This is a convenience method equivalent to `stats().depth`.
    fn depth(&self) -> usize {
        self.stats().depth
    }
}

// =============================================================================
// Queue Info
// =============================================================================

/// Information about a queue returned by `list_queues()`.
///
/// # Examples
///
/// ```rust,ignore
/// let queues = manager.list_queues().await?;
/// for info in queues {
///     println!("Queue {}: {} items", info.name, info.depth);
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueInfo {
    /// The name of the queue.
    pub name: String,

    /// Current queue depth.
    pub depth: usize,

    /// Timestamp when the queue was created (Unix timestamp in milliseconds).
    pub created_at: u64,

    /// The options the queue was created with.
    pub options: QueueOptions,
}

impl QueueInfo {
    /// Creates a new `QueueInfo`.
    #[inline]
    pub fn new(name: String, depth: usize, created_at: u64, options: QueueOptions) -> Self {
        Self {
            name,
            depth,
            created_at,
            options,
        }
    }
}

// =============================================================================
// QueueManager Trait
// =============================================================================

/// Trait for queue management operations.
///
/// `QueueManager` handles the lifecycle of queues - creating, deleting, and
/// retrieving queue instances. It acts as a registry for all queues in
/// the system.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
/// * `Q` - The concrete Queue type this manager creates
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::queue::{QueueManager, QueueOptions};
///
/// async fn setup_queues<T, Q, M>(manager: &M) -> Result<(), Box<dyn std::error::Error>>
/// where
///     T: LinkType,
///     Q: Queue<T>,
///     M: QueueManager<T, Q>,
/// {
///     // Create main queue and DLQ
///     let dlq_options = QueueOptions::new();
///     manager.create_queue("tasks-dlq", dlq_options).await?;
///
///     let options = QueueOptions::new()
///         .with_max_size(10000)
///         .with_retry_limit(3)
///         .with_dead_letter_queue("tasks-dlq".to_string());
///     manager.create_queue("tasks", options).await?;
///
///     Ok(())
/// }
/// ```
pub trait QueueManager<T: LinkType, Q: Queue<T>>: Send + Sync {
    /// Creates a new named queue with the specified options.
    ///
    /// If a queue with the same name already exists, an error is returned.
    ///
    /// # Arguments
    ///
    /// * `name` - Unique name for the queue
    /// * `options` - Queue configuration
    ///
    /// # Returns
    ///
    /// The created Queue.
    ///
    /// # Errors
    ///
    /// Returns `QueueError` if a queue with this name already exists.
    fn create_queue(
        &self,
        name: &str,
        options: QueueOptions,
    ) -> impl std::future::Future<Output = QueueResult<Q>> + Send;

    /// Deletes a queue and all its contents.
    ///
    /// Any in-flight items are lost. This operation is irreversible.
    ///
    /// # Arguments
    ///
    /// * `name` - Name of the queue to delete
    ///
    /// # Returns
    ///
    /// `true` if the queue was deleted, `false` if not found.
    fn delete_queue(
        &self,
        name: &str,
    ) -> impl std::future::Future<Output = QueueResult<bool>> + Send;

    /// Retrieves an existing queue by name.
    ///
    /// # Arguments
    ///
    /// * `name` - Name of the queue to retrieve
    ///
    /// # Returns
    ///
    /// The Queue, or None if not found.
    fn get_queue(
        &self,
        name: &str,
    ) -> impl std::future::Future<Output = QueueResult<Option<Q>>> + Send;

    /// Lists all queues managed by this manager.
    ///
    /// # Returns
    ///
    /// Vector of `QueueInfo` for all queues.
    fn list_queues(&self) -> impl std::future::Future<Output = QueueResult<Vec<QueueInfo>>> + Send;
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod enqueue_result_tests {
        use super::*;

        #[test]
        fn test_enqueue_result_new() {
            let result = EnqueueResult::new(42u64, 5);
            assert_eq!(result.id, 42);
            assert_eq!(result.position, 5);
        }
    }

    mod queue_stats_tests {
        use super::*;

        #[test]
        fn test_queue_stats_default() {
            let stats = QueueStats::default();
            assert_eq!(stats.depth, 0);
            assert_eq!(stats.enqueued, 0);
            assert_eq!(stats.dequeued, 0);
            assert_eq!(stats.acknowledged, 0);
            assert_eq!(stats.rejected, 0);
            assert_eq!(stats.in_flight, 0);
        }

        #[test]
        fn test_queue_stats_new() {
            let stats = QueueStats::new();
            assert_eq!(stats.depth, 0);
        }
    }

    mod queue_options_tests {
        use super::*;

        #[test]
        fn test_queue_options_default() {
            let options = QueueOptions::default();
            assert!(options.max_size.is_none());
            assert!(options.visibility_timeout.is_none());
            assert!(options.retry_limit.is_none());
            assert!(options.dead_letter_queue.is_none());
            assert!(options.priority.is_none());
        }

        #[test]
        fn test_queue_options_builder() {
            let options = QueueOptions::new()
                .with_max_size(1000)
                .with_visibility_timeout(60)
                .with_retry_limit(5)
                .with_dead_letter_queue("dlq".to_string())
                .with_priority(true);

            assert_eq!(options.max_size, Some(1000));
            assert_eq!(options.visibility_timeout, Some(60));
            assert_eq!(options.retry_limit, Some(5));
            assert_eq!(options.dead_letter_queue, Some("dlq".to_string()));
            assert_eq!(options.priority, Some(true));
        }

        #[test]
        fn test_queue_options_defaults() {
            let options = QueueOptions::new();
            assert_eq!(options.max_size_or_default(), usize::MAX);
            assert_eq!(options.visibility_timeout_or_default(), 30);
            assert_eq!(options.retry_limit_or_default(), 3);
            assert!(!options.priority_or_default());
        }
    }

    mod queue_error_tests {
        use super::*;

        #[test]
        fn test_queue_error_code_display() {
            assert_eq!(format!("{}", QueueErrorCode::QueueFull), "QUEUE_FULL");
            assert_eq!(
                format!("{}", QueueErrorCode::QueueNotFound),
                "QUEUE_NOT_FOUND"
            );
            assert_eq!(
                format!("{}", QueueErrorCode::QueueAlreadyExists),
                "QUEUE_ALREADY_EXISTS"
            );
            assert_eq!(
                format!("{}", QueueErrorCode::ItemNotFound),
                "ITEM_NOT_FOUND"
            );
            assert_eq!(
                format!("{}", QueueErrorCode::ItemNotInFlight),
                "ITEM_NOT_IN_FLIGHT"
            );
            assert_eq!(
                format!("{}", QueueErrorCode::InvalidOperation),
                "INVALID_OPERATION"
            );
        }

        #[test]
        fn test_queue_error_factories() {
            let err = QueueError::queue_full("test-queue");
            assert_eq!(err.code, QueueErrorCode::QueueFull);
            assert!(err.message.contains("test-queue"));

            let err = QueueError::queue_not_found("test-queue");
            assert_eq!(err.code, QueueErrorCode::QueueNotFound);

            let err = QueueError::queue_already_exists("test-queue");
            assert_eq!(err.code, QueueErrorCode::QueueAlreadyExists);

            let err = QueueError::item_not_found(42u64);
            assert_eq!(err.code, QueueErrorCode::ItemNotFound);

            let err = QueueError::item_not_in_flight(42u64);
            assert_eq!(err.code, QueueErrorCode::ItemNotInFlight);
        }

        #[test]
        fn test_queue_error_display() {
            let err = QueueError::queue_full("my-queue");
            let display = format!("{}", err);
            assert!(display.contains("QUEUE_FULL"));
            assert!(display.contains("my-queue"));
        }
    }

    mod queue_info_tests {
        use super::*;

        #[test]
        fn test_queue_info_new() {
            let info = QueueInfo::new(
                "test-queue".to_string(),
                100,
                1704067200000,
                QueueOptions::new().with_max_size(1000),
            );
            assert_eq!(info.name, "test-queue");
            assert_eq!(info.depth, 100);
            assert_eq!(info.created_at, 1704067200000);
            assert_eq!(info.options.max_size, Some(1000));
        }
    }
}
