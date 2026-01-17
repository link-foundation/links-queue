//! Queue module for links-queue.
//!
//! This module provides the Queue and `QueueManager` traits and related types
//! for message queue operations built on top of the Link data model.
//!
//! # Overview
//!
//! - [`Queue`] - Trait for queue operations (enqueue, dequeue, acknowledge, reject)
//! - [`QueueManager`] - Trait for managing queue lifecycle (create, delete, list)
//! - [`QueueOptions`] - Configuration options for creating queues
//! - [`QueueStats`] - Statistics and metrics for a queue
//! - [`QueueInfo`] - Information about a queue
//! - [`QueueError`] - Error type for queue operations
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::queue::{Queue, QueueManager, QueueOptions};
//! use links_queue::{Link, LinkRef};
//!
//! async fn example<T, Q, M>(manager: &M) -> Result<(), Box<dyn std::error::Error>>
//! where
//!     T: links_queue::LinkType,
//!     Q: Queue<T>,
//!     M: QueueManager<T, Q>,
//! {
//!     // Create a queue
//!     let options = QueueOptions::default()
//!         .with_max_size(1000)
//!         .with_visibility_timeout(30);
//!     let queue = manager.create_queue("tasks", options).await?;
//!
//!     // Enqueue a link
//!     let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
//!     let result = queue.enqueue(link).await?;
//!
//!     // Dequeue and process
//!     if let Some(item) = queue.dequeue().await? {
//!         // Process...
//!         queue.acknowledge(item.id).await?;
//!     }
//!
//!     Ok(())
//! }
//! ```

mod traits;

pub use traits::{
    EnqueueResult, Queue, QueueError, QueueErrorCode, QueueInfo, QueueManager, QueueOptions,
    QueueResult, QueueStats,
};
