//! Queue manager implementation for links-queue.
//!
//! This module provides [`MemoryQueueManager`], an in-memory implementation of the
//! [`QueueManager`] trait that manages the lifecycle of queues.
//!
//! # Features
//!
//! - **Queue lifecycle**: Create, delete, and retrieve queues by name
//! - **Queue listing**: Enumerate all managed queues with their info
//! - **Thread-safe**: Uses internal locking for concurrent access
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::{MemoryQueueManager, QueueManager, QueueOptions};
//!
//! let manager = MemoryQueueManager::<u64>::new();
//!
//! // Create queues
//! let dlq = manager.create_queue("tasks-dlq", QueueOptions::default()).await?;
//! let tasks = manager.create_queue(
//!     "tasks",
//!     QueueOptions::new()
//!         .with_retry_limit(3)
//!         .with_dead_letter_queue("tasks-dlq".to_string())
//! ).await?;
//!
//! // List all queues
//! for info in manager.list_queues().await? {
//!     println!("Queue: {} (depth: {})", info.name, info.depth);
//! }
//! ```

// Allow significant_drop_tightening as the mutex guards are intentionally held
// for the duration of the operations to ensure atomic updates.
#![allow(clippy::significant_drop_tightening)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::queue::memory_queue::MemoryQueueWithStorage;
use crate::queue::traits::{Queue, QueueError, QueueInfo, QueueManager, QueueOptions, QueueResult};
use crate::LinkType;

// =============================================================================
// Queue Entry (Internal)
// =============================================================================

/// Internal entry for a managed queue.
#[derive(Debug)]
struct QueueEntry<T: LinkType> {
    /// The queue instance.
    queue: MemoryQueueWithStorage<T>,

    /// Options the queue was created with.
    options: QueueOptions,
}

// =============================================================================
// Memory Queue Manager
// =============================================================================

/// In-memory queue manager that creates and manages `MemoryQueueWithStorage` instances.
///
/// This manager maintains a registry of queues and provides CRUD operations
/// for queue lifecycle management.
///
/// # Thread Safety
///
/// `MemoryQueueManager` uses internal locking (`Mutex`) for thread-safe operations.
/// It implements `Send + Sync` and can be safely shared between threads.
///
/// # Example
///
/// ```rust,ignore
/// use links_queue::{MemoryQueueManager, QueueManager, QueueOptions, Queue};
///
/// #[tokio::main]
/// async fn main() -> Result<(), Box<dyn std::error::Error>> {
///     let manager = MemoryQueueManager::<u64>::new();
///
///     // Create a queue
///     let queue = manager.create_queue("my-queue", QueueOptions::default()).await?;
///
///     // Use the queue
///     println!("Queue depth: {}", queue.stats().depth);
///
///     // List all queues
///     let queues = manager.list_queues().await?;
///     println!("Total queues: {}", queues.len());
///
///     Ok(())
/// }
/// ```
#[derive(Debug)]
pub struct MemoryQueueManager<T: LinkType> {
    /// Registry of managed queues.
    queues: Arc<Mutex<HashMap<String, QueueEntry<T>>>>,
}

impl<T: LinkType> Default for MemoryQueueManager<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: LinkType> Clone for MemoryQueueManager<T> {
    fn clone(&self) -> Self {
        Self {
            queues: Arc::clone(&self.queues),
        }
    }
}

impl<T: LinkType> MemoryQueueManager<T> {
    /// Creates a new, empty queue manager.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use links_queue::MemoryQueueManager;
    ///
    /// let manager = MemoryQueueManager::<u64>::new();
    /// ```
    #[must_use]
    pub fn new() -> Self {
        Self {
            queues: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns the number of managed queues.
    #[must_use]
    pub fn queue_count(&self) -> usize {
        let queues = self.queues.lock().expect("lock poisoned");
        queues.len()
    }

    /// Checks if a queue with the given name exists.
    #[must_use]
    pub fn has_queue(&self, name: &str) -> bool {
        let queues = self.queues.lock().expect("lock poisoned");
        queues.contains_key(name)
    }

    /// Processes expired messages in all queues.
    ///
    /// This method should be called periodically to handle visibility timeouts.
    /// Returns a map of queue names to the number of messages requeued.
    #[must_use]
    pub fn process_all_expired(&self) -> HashMap<String, usize> {
        let queues = self.queues.lock().expect("lock poisoned");
        let mut results = HashMap::new();

        for (name, entry) in queues.iter() {
            let count = entry.queue.process_expired();
            if count > 0 {
                results.insert(name.clone(), count);
            }
        }

        results
    }

    /// Moves dead letter items from source queues to their configured DLQs.
    ///
    /// Returns the number of items moved.
    pub async fn process_dead_letters(&self) -> usize {
        // First, collect all dead letter items
        let dead_letters: Vec<(String, Vec<crate::Link<T>>)> = {
            let queues = self.queues.lock().expect("lock poisoned");
            queues
                .iter()
                .filter_map(|(_, entry)| {
                    let dlq_name = entry.queue.dead_letter_queue_name()?;
                    let items = entry.queue.drain_dead_letters();
                    if items.is_empty() {
                        None
                    } else {
                        Some((dlq_name, items))
                    }
                })
                .collect()
        };

        let mut total_moved = 0;

        // Now enqueue to DLQs
        for (dlq_name, items) in dead_letters {
            if let Ok(Some(dlq)) = self.get_queue(&dlq_name).await {
                for item in items {
                    if dlq.enqueue(item).await.is_ok() {
                        total_moved += 1;
                    }
                }
            }
        }

        total_moved
    }
}

// =============================================================================
// QueueManager Trait Implementation
// =============================================================================

impl<T: LinkType> QueueManager<T, MemoryQueueWithStorage<T>> for MemoryQueueManager<T> {
    async fn create_queue(
        &self,
        name: &str,
        options: QueueOptions,
    ) -> QueueResult<MemoryQueueWithStorage<T>> {
        let mut queues = self.queues.lock().expect("lock poisoned");

        // Check if queue already exists
        if queues.contains_key(name) {
            return Err(QueueError::queue_already_exists(name));
        }

        // Create the queue
        let queue = MemoryQueueWithStorage::new(name, options.clone());

        // Store the entry
        let entry = QueueEntry {
            queue: queue.clone(),
            options,
        };
        queues.insert(name.to_string(), entry);

        Ok(queue)
    }

    async fn delete_queue(&self, name: &str) -> QueueResult<bool> {
        let mut queues = self.queues.lock().expect("lock poisoned");
        Ok(queues.remove(name).is_some())
    }

    async fn get_queue(&self, name: &str) -> QueueResult<Option<MemoryQueueWithStorage<T>>> {
        let queues = self.queues.lock().expect("lock poisoned");
        Ok(queues.get(name).map(|entry| entry.queue.clone()))
    }

    async fn list_queues(&self) -> QueueResult<Vec<QueueInfo>> {
        let queues = self.queues.lock().expect("lock poisoned");

        let infos = queues
            .iter()
            .map(|(name, entry)| {
                let stats = entry.queue.stats();
                QueueInfo::new(
                    name.clone(),
                    stats.depth,
                    entry.queue.created_at(),
                    entry.options.clone(),
                )
            })
            .collect();

        Ok(infos)
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Link, LinkRef};

    mod manager_tests {
        use super::*;

        #[tokio::test]
        async fn test_new_manager() {
            let manager = MemoryQueueManager::<u64>::new();
            assert_eq!(manager.queue_count(), 0);
        }

        #[tokio::test]
        async fn test_create_queue() {
            let manager = MemoryQueueManager::<u64>::new();

            let queue = manager
                .create_queue("test-queue", QueueOptions::default())
                .await
                .unwrap();

            assert_eq!(queue.name(), "test-queue");
            assert_eq!(manager.queue_count(), 1);
            assert!(manager.has_queue("test-queue"));
        }

        #[tokio::test]
        async fn test_create_duplicate_queue() {
            let manager = MemoryQueueManager::<u64>::new();

            manager
                .create_queue("test-queue", QueueOptions::default())
                .await
                .unwrap();

            // Second create should fail
            let result = manager
                .create_queue("test-queue", QueueOptions::default())
                .await;

            assert!(result.is_err());
        }

        #[tokio::test]
        async fn test_get_queue() {
            let manager = MemoryQueueManager::<u64>::new();

            // Get non-existent queue
            let result = manager.get_queue("non-existent").await.unwrap();
            assert!(result.is_none());

            // Create and get
            manager
                .create_queue("test-queue", QueueOptions::default())
                .await
                .unwrap();

            let queue = manager.get_queue("test-queue").await.unwrap();
            assert!(queue.is_some());
            assert_eq!(queue.unwrap().name(), "test-queue");
        }

        #[tokio::test]
        async fn test_delete_queue() {
            let manager = MemoryQueueManager::<u64>::new();

            manager
                .create_queue("test-queue", QueueOptions::default())
                .await
                .unwrap();

            assert!(manager.has_queue("test-queue"));

            let deleted = manager.delete_queue("test-queue").await.unwrap();
            assert!(deleted);
            assert!(!manager.has_queue("test-queue"));

            // Delete non-existent should return false
            let deleted = manager.delete_queue("test-queue").await.unwrap();
            assert!(!deleted);
        }

        #[tokio::test]
        async fn test_list_queues() {
            let manager = MemoryQueueManager::<u64>::new();

            // Empty list
            let queues = manager.list_queues().await.unwrap();
            assert!(queues.is_empty());

            // Create some queues
            manager
                .create_queue("queue-a", QueueOptions::default())
                .await
                .unwrap();
            manager
                .create_queue("queue-b", QueueOptions::new().with_max_size(100))
                .await
                .unwrap();

            let queues = manager.list_queues().await.unwrap();
            assert_eq!(queues.len(), 2);

            // Check queue info
            let names: Vec<&str> = queues.iter().map(|q| q.name.as_str()).collect();
            assert!(names.contains(&"queue-a"));
            assert!(names.contains(&"queue-b"));
        }

        #[tokio::test]
        async fn test_queue_shared_state() {
            let manager = MemoryQueueManager::<u64>::new();

            let queue1 = manager
                .create_queue("test-queue", QueueOptions::default())
                .await
                .unwrap();

            // Enqueue via queue1
            let link = Link::new(1, LinkRef::Id(2), LinkRef::Id(3));
            queue1.enqueue(link).await.unwrap();

            // Get same queue and verify state is shared
            let queue2 = manager.get_queue("test-queue").await.unwrap().unwrap();
            assert_eq!(queue2.stats().depth, 1);

            // Dequeue via queue2
            let item = queue2.dequeue().await.unwrap();
            assert!(item.is_some());

            // Verify queue1 sees the change
            assert_eq!(queue1.stats().depth, 0);
        }

        #[tokio::test]
        async fn test_clone_shares_state() {
            let manager1 = MemoryQueueManager::<u64>::new();
            let manager2 = manager1.clone();

            manager1
                .create_queue("test-queue", QueueOptions::default())
                .await
                .unwrap();

            // Both managers should see the queue
            assert!(manager1.has_queue("test-queue"));
            assert!(manager2.has_queue("test-queue"));

            assert_eq!(manager1.queue_count(), 1);
            assert_eq!(manager2.queue_count(), 1);
        }

        #[tokio::test]
        async fn test_queue_with_dlq() {
            let manager = MemoryQueueManager::<u64>::new();

            // Create DLQ first
            manager
                .create_queue("tasks-dlq", QueueOptions::default())
                .await
                .unwrap();

            // Create main queue with DLQ reference
            let options = QueueOptions::new()
                .with_retry_limit(2)
                .with_dead_letter_queue("tasks-dlq".to_string());

            let queue = manager.create_queue("tasks", options).await.unwrap();

            assert!(queue.inner.has_dead_letter_queue());
            assert_eq!(
                queue.inner.dead_letter_queue_name(),
                Some("tasks-dlq".to_string())
            );
        }

        #[tokio::test]
        async fn test_list_queues_with_depth() {
            let manager = MemoryQueueManager::<u64>::new();

            let queue = manager
                .create_queue("test-queue", QueueOptions::default())
                .await
                .unwrap();

            // Enqueue some items
            queue
                .enqueue(Link::new(1, LinkRef::Id(1), LinkRef::Id(1)))
                .await
                .unwrap();
            queue
                .enqueue(Link::new(2, LinkRef::Id(2), LinkRef::Id(2)))
                .await
                .unwrap();
            queue
                .enqueue(Link::new(3, LinkRef::Id(3), LinkRef::Id(3)))
                .await
                .unwrap();

            let queues = manager.list_queues().await.unwrap();
            assert_eq!(queues.len(), 1);
            assert_eq!(queues[0].depth, 3);
        }
    }
}
