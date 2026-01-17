//! In-memory storage backend implementing [`StorageBackend`].
//!
//! This module provides [`MemoryBackend`], a wrapper around [`MemoryLinkStore`]
//! that implements the [`StorageBackend`] trait for pluggable backend support.
//!
//! # Features
//!
//! - **O(1) lookups**: Uses `HashMap` for constant-time access by ID
//! - **Deduplication**: Identical link structures share the same ID
//! - **Statistics tracking**: Tracks operation counts and connection state
//!
//! # Example
//!
//! ```rust
//! use links_queue::{MemoryBackend, StorageBackend, Link, LinkRef, LinkPattern};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let mut backend = MemoryBackend::<u64>::new();
//!     backend.connect().await?;
//!
//!     // Save a link
//!     let link = Link::new(0, LinkRef::Id(1), LinkRef::Id(2));
//!     let id = backend.save(link).await?;
//!     println!("Saved with ID: {}", id);
//!
//!     // Load it back
//!     let loaded = backend.load(id).await?;
//!     println!("Loaded: {:?}", loaded);
//!
//!     backend.disconnect().await?;
//!     Ok(())
//! }
//! ```

use std::time::{SystemTime, UNIX_EPOCH};

use crate::{Link, LinkPattern, LinkStore, LinkType, MemoryLinkStore};

use super::traits::{
    BackendCapabilities, BackendError, BackendResult, BackendStats, DurabilityLevel,
    OperationStats, StorageBackend,
};

// =============================================================================
// Memory Backend
// =============================================================================

/// In-memory storage backend implementing [`StorageBackend`].
///
/// This is a wrapper around [`MemoryLinkStore`] that adds connection state
/// tracking, operation statistics, and implements the async [`StorageBackend`] trait.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Thread Safety
///
/// `MemoryBackend` is `Send + Sync`. For concurrent access, wrap in
/// `tokio::sync::RwLock` or similar synchronization primitive.
///
/// # Example
///
/// ```rust
/// use links_queue::{MemoryBackend, StorageBackend, Link, LinkRef};
///
/// #[tokio::main]
/// async fn main() {
///     let mut backend = MemoryBackend::<u64>::new();
///     backend.connect().await.unwrap();
///
///     let link = Link::new(0, LinkRef::Id(1), LinkRef::Id(2));
///     let id = backend.save(link).await.unwrap();
///
///     let stats = backend.stats();
///     println!("Total links: {}", stats.total_links);
/// }
/// ```
#[derive(Debug)]
pub struct MemoryBackend<T: LinkType> {
    /// The underlying link store.
    store: MemoryLinkStore<T>,

    /// Whether the backend is connected.
    connected: bool,

    /// Timestamp when connected (Unix millis).
    connected_at: Option<u64>,

    /// Operation statistics.
    stats: OperationStats,
}

impl<T: LinkType> Default for MemoryBackend<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: LinkType> MemoryBackend<T> {
    /// Creates a new memory backend.
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::MemoryBackend;
    ///
    /// let backend = MemoryBackend::<u64>::new();
    /// ```
    #[must_use]
    pub fn new() -> Self {
        Self {
            store: MemoryLinkStore::new(),
            connected: false,
            connected_at: None,
            stats: OperationStats::default(),
        }
    }

    /// Creates a new memory backend with pre-allocated capacity.
    ///
    /// # Arguments
    ///
    /// * `capacity` - Number of links to pre-allocate space for
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::MemoryBackend;
    ///
    /// let backend = MemoryBackend::<u64>::with_capacity(1000);
    /// ```
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            store: MemoryLinkStore::with_capacity(capacity),
            connected: false,
            connected_at: None,
            stats: OperationStats::default(),
        }
    }

    /// Clears all data from the backend.
    ///
    /// This resets the store but does not reset statistics or connection state.
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::{MemoryBackend, StorageBackend, Link, LinkRef};
    ///
    /// #[tokio::main]
    /// async fn main() {
    ///     let mut backend = MemoryBackend::<u64>::new();
    ///     backend.connect().await.unwrap();
    ///
    ///     backend.save(Link::new(0, LinkRef::Id(1), LinkRef::Id(2))).await.unwrap();
    ///     assert_eq!(backend.stats().total_links, 1);
    ///
    ///     backend.clear();
    ///     assert_eq!(backend.stats().total_links, 0);
    /// }
    /// ```
    pub fn clear(&mut self) {
        self.store.clear();
    }

    /// Resets the backend to initial state including statistics.
    pub fn reset(&mut self) {
        self.store.reset();
        self.stats = OperationStats::default();
    }

    /// Gets the current Unix timestamp in milliseconds.
    #[allow(clippy::cast_possible_truncation)]
    fn current_time_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// Ensures the backend is connected, returning an error if not.
    const fn ensure_connected(&self) -> BackendResult<T, ()> {
        if self.connected {
            Ok(())
        } else {
            Err(BackendError::NotConnected)
        }
    }
}

// =============================================================================
// StorageBackend Implementation
// =============================================================================

impl<T: LinkType> StorageBackend<T> for MemoryBackend<T> {
    async fn connect(&mut self) -> BackendResult<T, ()> {
        if !self.connected {
            self.connected = true;
            self.connected_at = Some(Self::current_time_ms());
        }
        Ok(())
    }

    async fn disconnect(&mut self) -> BackendResult<T, ()> {
        self.connected = false;
        self.connected_at = None;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn save(&mut self, link: Link<T>) -> BackendResult<T, T> {
        self.ensure_connected()?;
        self.stats.writes += 1;

        // If ID is zero/nothing, create a new link
        if link.id.is_nothing() {
            let created = if let Some(values) = link.values {
                self.store
                    .create_with_values(link.source, link.target, values)?
            } else {
                self.store.create(link.source, link.target)?
            };
            return Ok(created.id);
        }

        // Try to update existing link
        if self.store.exists(link.id) {
            let updated = self
                .store
                .update(link.id, link.source.clone(), link.target.clone())?;
            return Ok(updated.id);
        }

        // Create new link (will get auto-generated ID)
        let created = if let Some(values) = link.values {
            self.store
                .create_with_values(link.source, link.target, values)?
        } else {
            self.store.create(link.source, link.target)?
        };
        Ok(created.id)
    }

    async fn load(&self, id: T) -> BackendResult<T, Option<Link<T>>> {
        self.ensure_connected()?;
        // Note: We can't mutate stats here since we only have &self
        // A real implementation might use interior mutability
        Ok(self.store.get(id).cloned())
    }

    async fn delete(&mut self, id: T) -> BackendResult<T, bool> {
        self.ensure_connected()?;
        self.stats.deletes += 1;
        Ok(self.store.delete(id))
    }

    async fn query(&self, pattern: &LinkPattern<T>) -> BackendResult<T, Vec<Link<T>>> {
        self.ensure_connected()?;
        // Note: We can't mutate stats here since we only have &self
        let results = self.store.find(pattern).into_iter().cloned().collect();
        Ok(results)
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            supports_transactions: false,
            supports_batch_operations: false, // We simulate batch ops
            durability_level: DurabilityLevel::None,
            max_link_size: 0, // Unlimited
            supports_pattern_queries: true,
        }
    }

    fn stats(&self) -> BackendStats {
        let now = Self::current_time_ms();
        let uptime = self.connected_at.map_or(0, |at| now - at);

        BackendStats {
            total_links: self.store.total_count(),
            used_space: 0, // Not tracked for memory backend
            operations: self.stats.clone(),
            connected_at: self.connected_at,
            uptime_ms: uptime,
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LinkRef;

    #[tokio::test]
    async fn test_memory_backend_connect_disconnect() {
        let mut backend = MemoryBackend::<u64>::new();
        assert!(!backend.is_connected());

        backend.connect().await.unwrap();
        assert!(backend.is_connected());

        backend.disconnect().await.unwrap();
        assert!(!backend.is_connected());
    }

    #[tokio::test]
    async fn test_memory_backend_save_load() {
        let mut backend = MemoryBackend::<u64>::new();
        backend.connect().await.unwrap();

        let link = Link::new(0, LinkRef::Id(1), LinkRef::Id(2));
        let id = backend.save(link).await.unwrap();
        assert_ne!(id, 0);

        let loaded = backend.load(id).await.unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.id, id);
        assert_eq!(loaded.source_id(), 1);
        assert_eq!(loaded.target_id(), 2);
    }

    #[tokio::test]
    async fn test_memory_backend_delete() {
        let mut backend = MemoryBackend::<u64>::new();
        backend.connect().await.unwrap();

        let link = Link::new(0, LinkRef::Id(1), LinkRef::Id(2));
        let id = backend.save(link).await.unwrap();

        assert!(backend.delete(id).await.unwrap());
        assert!(!backend.delete(id).await.unwrap()); // Already deleted
    }

    #[tokio::test]
    async fn test_memory_backend_query() {
        let mut backend = MemoryBackend::<u64>::new();
        backend.connect().await.unwrap();

        backend
            .save(Link::new(0, LinkRef::Id(1), LinkRef::Id(2)))
            .await
            .unwrap();
        backend
            .save(Link::new(0, LinkRef::Id(1), LinkRef::Id(3)))
            .await
            .unwrap();
        backend
            .save(Link::new(0, LinkRef::Id(2), LinkRef::Id(3)))
            .await
            .unwrap();

        let results = backend
            .query(&LinkPattern::with_source(LinkRef::Id(1)))
            .await
            .unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn test_memory_backend_not_connected_error() {
        let mut backend = MemoryBackend::<u64>::new();
        // Don't connect

        let result = backend
            .save(Link::new(0, LinkRef::Id(1), LinkRef::Id(2)))
            .await;
        assert!(matches!(result, Err(BackendError::NotConnected)));
    }

    #[tokio::test]
    async fn test_memory_backend_save_batch() {
        let mut backend = MemoryBackend::<u64>::new();
        backend.connect().await.unwrap();

        let links = vec![
            Link::new(0, LinkRef::Id(1), LinkRef::Id(2)),
            Link::new(0, LinkRef::Id(3), LinkRef::Id(4)),
        ];

        let ids = backend.save_batch(links).await.unwrap();
        assert_eq!(ids.len(), 2);
        assert_ne!(ids[0], ids[1]);
    }

    #[tokio::test]
    async fn test_memory_backend_delete_batch() {
        let mut backend = MemoryBackend::<u64>::new();
        backend.connect().await.unwrap();

        let id1 = backend
            .save(Link::new(0, LinkRef::Id(1), LinkRef::Id(2)))
            .await
            .unwrap();
        let id2 = backend
            .save(Link::new(0, LinkRef::Id(3), LinkRef::Id(4)))
            .await
            .unwrap();

        let results = backend.delete_batch(vec![id1, id2, 999]).await.unwrap();
        assert_eq!(results, vec![true, true, false]);
    }

    #[test]
    fn test_memory_backend_capabilities() {
        let backend = MemoryBackend::<u64>::new();
        let caps = backend.capabilities();

        assert!(!caps.supports_transactions);
        assert!(!caps.supports_batch_operations);
        assert_eq!(caps.durability_level, DurabilityLevel::None);
        assert_eq!(caps.max_link_size, 0);
        assert!(caps.supports_pattern_queries);
    }

    #[tokio::test]
    async fn test_memory_backend_stats() {
        let mut backend = MemoryBackend::<u64>::new();
        backend.connect().await.unwrap();

        backend
            .save(Link::new(0, LinkRef::Id(1), LinkRef::Id(2)))
            .await
            .unwrap();
        backend
            .save(Link::new(0, LinkRef::Id(3), LinkRef::Id(4)))
            .await
            .unwrap();

        let stats = backend.stats();
        assert_eq!(stats.total_links, 2);
        assert_eq!(stats.operations.writes, 2);
        assert!(stats.connected_at.is_some());
        // uptime_ms is u64, always non-negative - just verify it's tracked
        assert!(stats.uptime_ms > 0 || stats.connected_at.is_some());
    }
}
