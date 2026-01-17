//! Storage backend trait definitions for links-queue.
//!
//! This module defines the [`StorageBackend`] trait that enables pluggable
//! storage backends. Implementations can provide different tradeoffs between
//! performance, durability, and features.
//!
//! # Design Goals
//!
//! - **Async-first**: All operations are async for compatibility with various backends
//! - **Pluggable**: Backends can be swapped via configuration without code changes
//! - **Observable**: Backends expose capabilities and statistics for monitoring
//!
//! # Example
//!
//! ```rust
//! use links_queue::{
//!     StorageBackend, MemoryBackend, Link, LinkRef, LinkPattern, LinkType,
//!     BackendCapabilities, BackendStats, DurabilityLevel,
//! };
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Create and connect to backend
//!     let mut backend = MemoryBackend::<u64>::new();
//!     backend.connect().await?;
//!
//!     // Save a link
//!     let link = Link::new(0u64, LinkRef::Id(1), LinkRef::Id(2));
//!     let id = backend.save(link).await?;
//!
//!     // Load it back
//!     if let Some(loaded) = backend.load(id).await? {
//!         println!("Loaded: {:?}", loaded);
//!     }
//!
//!     // Query by pattern
//!     let links = backend.query(&LinkPattern::with_source(LinkRef::Id(1))).await?;
//!     println!("Found {} links", links.len());
//!
//!     // Disconnect
//!     backend.disconnect().await?;
//!     Ok(())
//! }
//! ```
//!
//! # See Also
//!
//! - [`MemoryBackend`](super::MemoryBackend) - In-memory storage backend implementation
//! - [`LinkStore`](crate::LinkStore) - Lower-level link store trait

use std::fmt::Debug;

use crate::{Link, LinkError, LinkPattern, LinkType};

// =============================================================================
// Durability Level
// =============================================================================

/// Durability level supported by a storage backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[derive(Default)]
pub enum DurabilityLevel {
    /// No durability guarantees (in-memory only).
    #[default]
    None,
    /// Data is synced to disk.
    Fsync,
    /// Data is replicated across multiple nodes.
    Replicated,
}


// =============================================================================
// Backend Capabilities
// =============================================================================

/// Describes the capabilities of a storage backend.
///
/// This allows the system to validate that a backend meets the requirements
/// for a given operating mode and to adapt behavior accordingly.
///
/// # Example
///
/// ```rust
/// use links_queue::{BackendCapabilities, DurabilityLevel};
///
/// let caps = BackendCapabilities {
///     supports_transactions: false,
///     supports_batch_operations: true,
///     durability_level: DurabilityLevel::None,
///     max_link_size: 0,
///     supports_pattern_queries: true,
/// };
///
/// if caps.durability_level == DurabilityLevel::None {
///     println!("Warning: Data will be lost on restart");
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendCapabilities {
    /// Whether the backend supports atomic transactions.
    pub supports_transactions: bool,

    /// Whether the backend supports batch operations natively.
    /// If false, batch operations are simulated with individual operations.
    pub supports_batch_operations: bool,

    /// The durability level provided by this backend.
    pub durability_level: DurabilityLevel,

    /// Maximum size of a single link in bytes (0 for unlimited).
    pub max_link_size: usize,

    /// Whether the backend supports pattern-based queries natively.
    /// If false, queries are performed by scanning all links.
    pub supports_pattern_queries: bool,
}

impl Default for BackendCapabilities {
    fn default() -> Self {
        Self {
            supports_transactions: false,
            supports_batch_operations: false,
            durability_level: DurabilityLevel::None,
            max_link_size: 0,
            supports_pattern_queries: true,
        }
    }
}

// =============================================================================
// Operation Statistics
// =============================================================================

/// Operation counters for backend statistics.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OperationStats {
    /// Number of read operations performed.
    pub reads: u64,

    /// Number of write operations performed (save/update).
    pub writes: u64,

    /// Number of delete operations performed.
    pub deletes: u64,

    /// Number of query operations performed.
    pub queries: u64,
}

// =============================================================================
// Backend Statistics
// =============================================================================

/// Statistics and metrics for a storage backend.
///
/// # Example
///
/// ```rust
/// use links_queue::BackendStats;
///
/// fn print_stats(stats: &BackendStats) {
///     println!("Total links: {}", stats.total_links);
///     println!("Used space: {} bytes", stats.used_space);
///     println!("Reads: {}", stats.operations.reads);
///     println!("Writes: {}", stats.operations.writes);
/// }
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BackendStats {
    /// Total number of links stored.
    pub total_links: usize,

    /// Approximate storage space used in bytes.
    pub used_space: usize,

    /// Operation counters.
    pub operations: OperationStats,

    /// Timestamp when the backend was connected (Unix timestamp in milliseconds).
    /// None if not connected.
    pub connected_at: Option<u64>,

    /// Uptime in milliseconds since connection.
    pub uptime_ms: u64,
}

// =============================================================================
// Backend Error
// =============================================================================

/// Errors that can occur during backend operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendError<T: LinkType> {
    /// The backend is not connected.
    NotConnected,

    /// Connection to the backend failed.
    ConnectionFailed(String),

    /// A link operation failed.
    LinkError(LinkError<T>),

    /// A generic error occurred.
    Other(String),
}

impl<T: LinkType> std::fmt::Display for BackendError<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotConnected => write!(f, "Backend is not connected"),
            Self::ConnectionFailed(msg) => write!(f, "Connection failed: {msg}"),
            Self::LinkError(err) => write!(f, "Link error: {err}"),
            Self::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl<T: LinkType> std::error::Error for BackendError<T> {}

impl<T: LinkType> From<LinkError<T>> for BackendError<T> {
    fn from(err: LinkError<T>) -> Self {
        Self::LinkError(err)
    }
}

/// Result type for backend operations.
pub type BackendResult<T, V> = Result<V, BackendError<T>>;

// =============================================================================
// Storage Backend Trait
// =============================================================================

/// Trait for pluggable storage backends.
///
/// This abstraction allows switching between memory, link-cli, and custom
/// backends via configuration without code changes.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Implementation Notes
///
/// - All methods are async for compatibility with various backend types
/// - Implementors should track connection state and reject operations when disconnected
/// - Batch operations have default implementations but can be overridden for efficiency
///
/// # Example Implementation
///
/// ```rust,ignore
/// use links_queue::{StorageBackend, Link, LinkRef, LinkPattern, LinkType, BackendResult};
///
/// struct MyBackend<T: LinkType> {
///     connected: bool,
///     // ... other fields
/// }
///
/// #[async_trait::async_trait]
/// impl<T: LinkType> StorageBackend<T> for MyBackend<T> {
///     async fn connect(&mut self) -> BackendResult<T, ()> {
///         self.connected = true;
///         Ok(())
///     }
///
///     async fn disconnect(&mut self) -> BackendResult<T, ()> {
///         self.connected = false;
///         Ok(())
///     }
///
///     fn is_connected(&self) -> bool {
///         self.connected
///     }
///
///     // ... implement other methods
/// }
/// ```
pub trait StorageBackend<T: LinkType>: Send + Sync {
    // -------------------------------------------------------------------------
    // Lifecycle Operations
    // -------------------------------------------------------------------------

    /// Establishes a connection to the storage backend.
    ///
    /// This should be called before any other operations. For in-memory backends,
    /// this may be a no-op but should still be called for consistency.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::ConnectionFailed`] if connection fails.
    fn connect(
        &mut self,
    ) -> impl std::future::Future<Output = BackendResult<T, ()>> + Send;

    /// Gracefully disconnects from the storage backend.
    ///
    /// This should flush any pending writes and release resources.
    fn disconnect(
        &mut self,
    ) -> impl std::future::Future<Output = BackendResult<T, ()>> + Send;

    /// Checks if the backend is currently connected.
    ///
    /// # Returns
    ///
    /// True if connected and ready for operations.
    fn is_connected(&self) -> bool;

    // -------------------------------------------------------------------------
    // Core Operations
    // -------------------------------------------------------------------------

    /// Saves a link to storage.
    ///
    /// If the link's ID is zero (nothing), a new ID will be assigned.
    /// If a link with the same structure exists (deduplication), the existing
    /// ID may be returned depending on the backend's deduplication strategy.
    ///
    /// # Arguments
    ///
    /// * `link` - The link to save
    ///
    /// # Returns
    ///
    /// The ID of the saved link (may be new or existing).
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::NotConnected`] if not connected.
    fn save(
        &mut self,
        link: Link<T>,
    ) -> impl std::future::Future<Output = BackendResult<T, T>> + Send;

    /// Loads a link by its ID.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID of the link to load
    ///
    /// # Returns
    ///
    /// The link if found, None otherwise.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::NotConnected`] if not connected.
    fn load(
        &self,
        id: T,
    ) -> impl std::future::Future<Output = BackendResult<T, Option<Link<T>>>> + Send;

    /// Deletes a link by its ID.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID of the link to delete
    ///
    /// # Returns
    ///
    /// True if the link was deleted, false if it didn't exist.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::NotConnected`] if not connected.
    fn delete(
        &mut self,
        id: T,
    ) -> impl std::future::Future<Output = BackendResult<T, bool>> + Send;

    /// Queries links matching a pattern.
    ///
    /// # Arguments
    ///
    /// * `pattern` - The pattern to match
    ///
    /// # Returns
    ///
    /// Vector of matching links.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::NotConnected`] if not connected.
    fn query(
        &self,
        pattern: &LinkPattern<T>,
    ) -> impl std::future::Future<Output = BackendResult<T, Vec<Link<T>>>> + Send;

    // -------------------------------------------------------------------------
    // Batch Operations (default implementations)
    // -------------------------------------------------------------------------

    /// Saves multiple links in a batch.
    ///
    /// For backends that support native batch operations, this can be overridden
    /// for better efficiency. The default implementation calls `save()` for each link.
    ///
    /// # Arguments
    ///
    /// * `links` - Vector of links to save
    ///
    /// # Returns
    ///
    /// Vector of IDs (in the same order as input).
    fn save_batch(
        &mut self,
        links: Vec<Link<T>>,
    ) -> impl std::future::Future<Output = BackendResult<T, Vec<T>>> + Send {
        async move {
            let mut ids = Vec::with_capacity(links.len());
            for link in links {
                ids.push(self.save(link).await?);
            }
            Ok(ids)
        }
    }

    /// Deletes multiple links by their IDs.
    ///
    /// The default implementation calls `delete()` for each ID.
    ///
    /// # Arguments
    ///
    /// * `ids` - Vector of IDs to delete
    ///
    /// # Returns
    ///
    /// Vector of booleans indicating success for each deletion (in order).
    fn delete_batch(
        &mut self,
        ids: Vec<T>,
    ) -> impl std::future::Future<Output = BackendResult<T, Vec<bool>>> + Send {
        async move {
            let mut results = Vec::with_capacity(ids.len());
            for id in ids {
                results.push(self.delete(id).await?);
            }
            Ok(results)
        }
    }

    // -------------------------------------------------------------------------
    // Metadata Operations
    // -------------------------------------------------------------------------

    /// Returns the capabilities of this backend.
    fn capabilities(&self) -> BackendCapabilities;

    /// Returns statistics about the backend.
    fn stats(&self) -> BackendStats;
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_durability_level_default() {
        assert_eq!(DurabilityLevel::default(), DurabilityLevel::None);
    }

    #[test]
    fn test_backend_capabilities_default() {
        let caps = BackendCapabilities::default();
        assert!(!caps.supports_transactions);
        assert!(!caps.supports_batch_operations);
        assert_eq!(caps.durability_level, DurabilityLevel::None);
        assert_eq!(caps.max_link_size, 0);
        assert!(caps.supports_pattern_queries);
    }

    #[test]
    fn test_operation_stats_default() {
        let stats = OperationStats::default();
        assert_eq!(stats.reads, 0);
        assert_eq!(stats.writes, 0);
        assert_eq!(stats.deletes, 0);
        assert_eq!(stats.queries, 0);
    }

    #[test]
    fn test_backend_stats_default() {
        let stats = BackendStats::default();
        assert_eq!(stats.total_links, 0);
        assert_eq!(stats.used_space, 0);
        assert!(stats.connected_at.is_none());
        assert_eq!(stats.uptime_ms, 0);
    }

    #[test]
    fn test_backend_error_display() {
        let err: BackendError<u64> = BackendError::NotConnected;
        assert!(err.to_string().contains("not connected"));

        let err2: BackendError<u64> = BackendError::ConnectionFailed("timeout".to_string());
        assert!(err2.to_string().contains("timeout"));
    }

    #[test]
    fn test_backend_error_from_link_error() {
        let link_err = LinkError::NotFound(42u64);
        let backend_err: BackendError<u64> = link_err.into();
        assert!(matches!(backend_err, BackendError::LinkError(_)));
    }
}
