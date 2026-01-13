//! In-memory storage backend for links-queue.
//!
//! This module provides [`MemoryLinkStore`], an in-memory implementation of the
//! [`LinkStore`] trait. It offers O(1) lookups by ID and supports link deduplication,
//! pattern matching, and thread-safe operations.
//!
//! # Features
//!
//! - **O(1) lookups**: Uses `HashMap` for constant-time access by ID.
//! - **Deduplication**: Identical link structures (same source/target) share the same ID.
//! - **Pattern matching**: Supports wildcard queries via [`LinkPattern`].
//! - **Thread-safe**: Implements `Send + Sync` for concurrent access.
//!
//! # Design
//!
//! This implementation follows patterns from [doublets-rs](https://github.com/linksplatform/doublets-rs)
//! while adapting to Rust idioms and the links-queue API contract.
//!
//! # Example
//!
//! ```rust
//! use links_queue::{MemoryLinkStore, LinkStore, LinkRef, LinkPattern, Any};
//!
//! let mut store = MemoryLinkStore::<u64>::new();
//!
//! // Create a link
//! let link = store.create(LinkRef::Id(2), LinkRef::Id(3)).unwrap();
//! assert_eq!(link.id, 1); // Auto-generated ID
//!
//! // Deduplication: same source/target returns existing link
//! let duplicate = store.create(LinkRef::Id(2), LinkRef::Id(3)).unwrap();
//! assert_eq!(duplicate.id, link.id);
//!
//! // Find by pattern
//! let results = store.find(&LinkPattern::with_source(LinkRef::Id(2)));
//! assert_eq!(results.len(), 1);
//!
//! // Update a link
//! let updated = store.update(link.id, LinkRef::Id(4), LinkRef::Id(5)).unwrap();
//! assert_eq!(updated.source_id(), 4);
//!
//! // Delete a link
//! assert!(store.delete(link.id));
//! assert!(!store.exists(link.id));
//! ```

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use crate::{Link, LinkError, LinkPattern, LinkRef, LinkResult, LinkStore, LinkType};

// =============================================================================
// Helper Types for Deduplication
// =============================================================================

/// A key for deduplicating links based on their structure (source/target/values).
///
/// This is used internally to detect when a link with the same structure
/// already exists, allowing us to return the existing ID instead of creating
/// a duplicate.
#[derive(Debug, Clone)]
struct LinkKey<T: LinkType> {
    source_id: T,
    target_id: T,
    values: Option<Vec<T>>,
}

impl<T: LinkType> LinkKey<T> {
    fn from_refs(
        source: &LinkRef<T>,
        target: &LinkRef<T>,
        values: Option<&Vec<LinkRef<T>>>,
    ) -> Self {
        Self {
            source_id: source.get_id(),
            target_id: target.get_id(),
            values: values.map(|v| v.iter().map(LinkRef::get_id).collect()),
        }
    }
}

impl<T: LinkType> PartialEq for LinkKey<T> {
    fn eq(&self, other: &Self) -> bool {
        self.source_id == other.source_id
            && self.target_id == other.target_id
            && self.values == other.values
    }
}

impl<T: LinkType> Eq for LinkKey<T> {}

impl<T: LinkType> Hash for LinkKey<T> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.source_id.hash(state);
        self.target_id.hash(state);
        self.values.hash(state);
    }
}

// =============================================================================
// MemoryLinkStore Implementation
// =============================================================================

/// In-memory storage backend implementing the [`LinkStore`] trait.
///
/// Provides O(1) access by ID using a `HashMap`, automatic ID generation,
/// and link deduplication (identical structures share the same ID).
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Thread Safety
///
/// `MemoryLinkStore` is `Send + Sync`, making it safe to share between threads.
/// However, it does not provide internal synchronization - callers must handle
/// concurrent access (e.g., using `Mutex` or `RwLock`) if needed.
///
/// # Examples
///
/// ## Basic Usage
///
/// ```rust
/// use links_queue::{MemoryLinkStore, LinkStore, LinkRef};
///
/// let mut store = MemoryLinkStore::<u64>::new();
///
/// // Create links
/// let link1 = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
/// let link2 = store.create(LinkRef::Id(20), LinkRef::Id(30)).unwrap();
///
/// // Retrieve by ID
/// let retrieved = store.get(link1.id).unwrap();
/// assert_eq!(retrieved.source_id(), 10);
///
/// // Count total links
/// assert_eq!(store.total_count(), 2);
/// ```
///
/// ## Deduplication
///
/// ```rust
/// use links_queue::{MemoryLinkStore, LinkStore, LinkRef};
///
/// let mut store = MemoryLinkStore::<u64>::new();
///
/// let link1 = store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
/// let link2 = store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
///
/// // Same structure returns same ID
/// assert_eq!(link1.id, link2.id);
/// assert_eq!(store.total_count(), 1);
/// ```
#[derive(Debug)]
pub struct MemoryLinkStore<T: LinkType> {
    /// Primary storage: maps link IDs to link data.
    links: HashMap<T, Link<T>>,

    /// Reverse index: maps link structure (source/target) to ID for deduplication.
    dedup_index: HashMap<LinkKey<T>, T>,

    /// Counter for generating unique IDs.
    next_id: T,
}

impl<T: LinkType> Default for MemoryLinkStore<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: LinkType> MemoryLinkStore<T> {
    /// Creates a new, empty in-memory link store.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::{MemoryLinkStore, LinkStore};
    ///
    /// let store = MemoryLinkStore::<u64>::new();
    /// assert_eq!(store.total_count(), 0);
    /// ```
    #[must_use]
    pub fn new() -> Self {
        Self {
            links: HashMap::new(),
            dedup_index: HashMap::new(),
            next_id: T::zero(),
        }
    }

    /// Creates a new link store with pre-allocated capacity.
    ///
    /// Use this when you know approximately how many links will be stored
    /// to avoid reallocations.
    ///
    /// # Arguments
    ///
    /// * `capacity` - The number of links to pre-allocate space for
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::MemoryLinkStore;
    ///
    /// let store = MemoryLinkStore::<u64>::with_capacity(1000);
    /// ```
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            links: HashMap::with_capacity(capacity),
            dedup_index: HashMap::with_capacity(capacity),
            next_id: T::zero(),
        }
    }

    /// Removes all links from the store.
    ///
    /// This clears both the primary storage and the deduplication index,
    /// but does NOT reset the ID counter. New links will continue with
    /// the next available ID.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::{MemoryLinkStore, LinkStore, LinkRef};
    ///
    /// let mut store = MemoryLinkStore::<u64>::new();
    /// store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
    /// store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();
    /// assert_eq!(store.total_count(), 2);
    ///
    /// store.clear();
    /// assert_eq!(store.total_count(), 0);
    ///
    /// // ID counter continues from where it left off
    /// let new_link = store.create(LinkRef::Id(5), LinkRef::Id(6)).unwrap();
    /// assert_eq!(new_link.id, 3); // Not 1
    /// ```
    pub fn clear(&mut self) {
        self.links.clear();
        self.dedup_index.clear();
    }

    /// Resets the store to its initial state, including the ID counter.
    ///
    /// Unlike [`clear()`], this also resets the ID counter to zero.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::{MemoryLinkStore, LinkStore, LinkRef};
    ///
    /// let mut store = MemoryLinkStore::<u64>::new();
    /// store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
    ///
    /// store.reset();
    ///
    /// let new_link = store.create(LinkRef::Id(5), LinkRef::Id(6)).unwrap();
    /// assert_eq!(new_link.id, 1); // Starts from 1 again
    /// ```
    pub fn reset(&mut self) {
        self.links.clear();
        self.dedup_index.clear();
        self.next_id = T::zero();
    }

    /// Returns the capacity of the underlying storage.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::MemoryLinkStore;
    ///
    /// let store = MemoryLinkStore::<u64>::with_capacity(100);
    /// assert!(store.capacity() >= 100);
    /// ```
    #[must_use]
    pub fn capacity(&self) -> usize {
        self.links.capacity()
    }

    /// Generates the next unique ID.
    ///
    /// IDs start at 1 (not 0) to allow 0 to represent "nothing" or "null".
    fn generate_id(&mut self) -> T {
        // Increment first to start from 1, not 0
        self.next_id = self.next_id.increment();
        self.next_id
    }

    /// Creates a link and adds it to storage.
    fn create_link_internal(
        &mut self,
        source: LinkRef<T>,
        target: LinkRef<T>,
        values: Option<Vec<LinkRef<T>>>,
    ) -> Link<T> {
        let key = LinkKey::from_refs(&source, &target, values.as_ref());

        // Check for existing link with same structure (deduplication)
        if let Some(&existing_id) = self.dedup_index.get(&key) {
            if let Some(existing_link) = self.links.get(&existing_id) {
                return existing_link.clone();
            }
        }

        // Generate new ID and create link
        let id = self.generate_id();
        let link = if let Some(vals) = values {
            Link::with_values(id, source, target, vals)
        } else {
            Link::new(id, source, target)
        };

        // Store link and update dedup index
        self.links.insert(id, link.clone());
        self.dedup_index.insert(key, id);

        link
    }
}

// =============================================================================
// LinkStore Trait Implementation
// =============================================================================

impl<T: LinkType> LinkStore<T> for MemoryLinkStore<T> {
    fn create(&mut self, source: LinkRef<T>, target: LinkRef<T>) -> LinkResult<T, Link<T>> {
        Ok(self.create_link_internal(source, target, None))
    }

    fn create_with_values(
        &mut self,
        source: LinkRef<T>,
        target: LinkRef<T>,
        values: Vec<LinkRef<T>>,
    ) -> LinkResult<T, Link<T>> {
        let values_opt = if values.is_empty() {
            None
        } else {
            Some(values)
        };
        Ok(self.create_link_internal(source, target, values_opt))
    }

    fn get(&self, id: T) -> Option<&Link<T>> {
        self.links.get(&id)
    }

    fn find(&self, pattern: &LinkPattern<T>) -> Vec<&Link<T>> {
        self.links
            .values()
            .filter(|link| pattern.matches(link))
            .collect()
    }

    fn update(&mut self, id: T, source: LinkRef<T>, target: LinkRef<T>) -> LinkResult<T, Link<T>> {
        // Check if link exists
        let old_link = self.links.get(&id).ok_or(LinkError::NotFound(id))?.clone();

        // Remove old dedup entry
        let old_key =
            LinkKey::from_refs(&old_link.source, &old_link.target, old_link.values.as_ref());
        self.dedup_index.remove(&old_key);

        // Check if new structure already exists (would create duplicate)
        let new_key = LinkKey::from_refs(&source, &target, old_link.values.as_ref());
        if let Some(&existing_id) = self.dedup_index.get(&new_key) {
            if existing_id != id {
                // Restore old dedup entry before returning error
                self.dedup_index.insert(old_key, id);
                return Err(LinkError::AlreadyExists(existing_id));
            }
        }

        // Update the link
        let updated_link = if let Some(vals) = old_link.values {
            Link::with_values(id, source, target, vals)
        } else {
            Link::new(id, source, target)
        };

        self.links.insert(id, updated_link.clone());
        self.dedup_index.insert(new_key, id);

        Ok(updated_link)
    }

    fn delete(&mut self, id: T) -> bool {
        if let Some(link) = self.links.remove(&id) {
            let key = LinkKey::from_refs(&link.source, &link.target, link.values.as_ref());
            self.dedup_index.remove(&key);
            true
        } else {
            false
        }
    }

    fn delete_matching(&mut self, pattern: &LinkPattern<T>) -> usize {
        // Collect IDs to delete (to avoid borrowing issues)
        let ids_to_delete: Vec<T> = self
            .links
            .iter()
            .filter(|(_, link)| pattern.matches(link))
            .map(|(&id, _)| id)
            .collect();

        let count = ids_to_delete.len();
        for id in ids_to_delete {
            self.delete(id);
        }
        count
    }

    fn iter<'a>(
        &'a self,
        pattern: &'a LinkPattern<T>,
    ) -> Box<dyn Iterator<Item = &'a Link<T>> + 'a> {
        Box::new(
            self.links
                .values()
                .filter(move |link| pattern.matches(link)),
        )
    }

    fn iter_all(&self) -> Box<dyn Iterator<Item = &Link<T>> + '_> {
        Box::new(self.links.values())
    }
}
