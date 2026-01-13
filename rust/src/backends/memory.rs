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
        values: &Option<Vec<LinkRef<T>>>,
    ) -> Self {
        Self {
            source_id: source.get_id(),
            target_id: target.get_id(),
            values: values
                .as_ref()
                .map(|v| v.iter().map(LinkRef::get_id).collect()),
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
    ) -> LinkResult<T, Link<T>> {
        let key = LinkKey::from_refs(&source, &target, &values);

        // Check for existing link with same structure (deduplication)
        if let Some(&existing_id) = self.dedup_index.get(&key) {
            if let Some(existing_link) = self.links.get(&existing_id) {
                return Ok(existing_link.clone());
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

        Ok(link)
    }
}

// =============================================================================
// LinkStore Trait Implementation
// =============================================================================

impl<T: LinkType> LinkStore<T> for MemoryLinkStore<T> {
    fn create(&mut self, source: LinkRef<T>, target: LinkRef<T>) -> LinkResult<T, Link<T>> {
        self.create_link_internal(source, target, None)
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
        self.create_link_internal(source, target, values_opt)
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
        let old_key = LinkKey::from_refs(&old_link.source, &old_link.target, &old_link.values);
        self.dedup_index.remove(&old_key);

        // Check if new structure already exists (would create duplicate)
        let new_key = LinkKey::from_refs(&source, &target, &old_link.values);
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
            let key = LinkKey::from_refs(&link.source, &link.target, &link.values);
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

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
#[allow(clippy::redundant_clone)]
mod tests {
    use super::*;
    use crate::Any;

    // -------------------------------------------------------------------------
    // Construction Tests
    // -------------------------------------------------------------------------

    mod construction_tests {
        use super::*;

        #[test]
        fn test_new_creates_empty_store() {
            let store = MemoryLinkStore::<u64>::new();
            assert_eq!(store.total_count(), 0);
        }

        #[test]
        fn test_default_creates_empty_store() {
            let store = MemoryLinkStore::<u64>::default();
            assert_eq!(store.total_count(), 0);
        }

        #[test]
        fn test_with_capacity() {
            let store = MemoryLinkStore::<u64>::with_capacity(100);
            assert!(store.capacity() >= 100);
            assert_eq!(store.total_count(), 0);
        }
    }

    // -------------------------------------------------------------------------
    // Create Tests
    // -------------------------------------------------------------------------

    mod create_tests {
        use super::*;

        #[test]
        fn test_create_simple_link() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();

            assert_eq!(link.id, 1); // First ID is 1, not 0
            assert_eq!(link.source_id(), 10);
            assert_eq!(link.target_id(), 20);
        }

        #[test]
        fn test_create_multiple_links() {
            let mut store = MemoryLinkStore::<u64>::new();

            let link1 = store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            let link2 = store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();
            let link3 = store.create(LinkRef::Id(5), LinkRef::Id(6)).unwrap();

            assert_eq!(link1.id, 1);
            assert_eq!(link2.id, 2);
            assert_eq!(link3.id, 3);
            assert_eq!(store.total_count(), 3);
        }

        #[test]
        fn test_create_with_values() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store
                .create_with_values(
                    LinkRef::Id(1),
                    LinkRef::Id(2),
                    vec![LinkRef::Id(3), LinkRef::Id(4)],
                )
                .unwrap();

            assert!(link.has_values());
            assert_eq!(link.values.as_ref().unwrap().len(), 2);
        }

        #[test]
        fn test_create_with_empty_values() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store
                .create_with_values(LinkRef::Id(1), LinkRef::Id(2), vec![])
                .unwrap();

            assert!(!link.has_values());
        }

        #[test]
        fn test_create_with_nested_link_ref() {
            let mut store = MemoryLinkStore::<u64>::new();
            let inner = Link::new(100u64, LinkRef::Id(10), LinkRef::Id(20));
            let link = store.create(LinkRef::link(inner), LinkRef::Id(30)).unwrap();

            assert_eq!(link.source_id(), 100);
            assert_eq!(link.target_id(), 30);
        }

        #[test]
        fn test_create_with_u32_ids() {
            let mut store = MemoryLinkStore::<u32>::new();
            let link = store.create(LinkRef::Id(1u32), LinkRef::Id(2u32)).unwrap();

            assert_eq!(link.id, 1u32);
        }

        #[test]
        fn test_create_with_usize_ids() {
            let mut store = MemoryLinkStore::<usize>::new();
            let link = store
                .create(LinkRef::Id(1usize), LinkRef::Id(2usize))
                .unwrap();

            assert_eq!(link.id, 1usize);
        }
    }

    // -------------------------------------------------------------------------
    // Deduplication Tests
    // -------------------------------------------------------------------------

    mod deduplication_tests {
        use super::*;

        #[test]
        fn test_deduplication_returns_existing_link() {
            let mut store = MemoryLinkStore::<u64>::new();

            let link1 = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            let link2 = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();

            assert_eq!(link1.id, link2.id);
            assert_eq!(store.total_count(), 1);
        }

        #[test]
        fn test_different_structures_get_different_ids() {
            let mut store = MemoryLinkStore::<u64>::new();

            let link1 = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            let link2 = store.create(LinkRef::Id(10), LinkRef::Id(30)).unwrap();
            let link3 = store.create(LinkRef::Id(20), LinkRef::Id(20)).unwrap();

            assert_ne!(link1.id, link2.id);
            assert_ne!(link1.id, link3.id);
            assert_ne!(link2.id, link3.id);
        }

        #[test]
        fn test_deduplication_with_values() {
            let mut store = MemoryLinkStore::<u64>::new();

            let link1 = store
                .create_with_values(LinkRef::Id(1), LinkRef::Id(2), vec![LinkRef::Id(3)])
                .unwrap();
            let link2 = store
                .create_with_values(LinkRef::Id(1), LinkRef::Id(2), vec![LinkRef::Id(3)])
                .unwrap();

            assert_eq!(link1.id, link2.id);
            assert_eq!(store.total_count(), 1);
        }

        #[test]
        fn test_different_values_get_different_ids() {
            let mut store = MemoryLinkStore::<u64>::new();

            let link1 = store
                .create_with_values(LinkRef::Id(1), LinkRef::Id(2), vec![LinkRef::Id(3)])
                .unwrap();
            let link2 = store
                .create_with_values(LinkRef::Id(1), LinkRef::Id(2), vec![LinkRef::Id(4)])
                .unwrap();

            assert_ne!(link1.id, link2.id);
        }
    }

    // -------------------------------------------------------------------------
    // Get and Exists Tests
    // -------------------------------------------------------------------------

    mod get_tests {
        use super::*;

        #[test]
        fn test_get_existing_link() {
            let mut store = MemoryLinkStore::<u64>::new();
            let created = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();

            let retrieved = store.get(created.id).unwrap();
            assert_eq!(retrieved.id, created.id);
            assert_eq!(retrieved.source_id(), 10);
            assert_eq!(retrieved.target_id(), 20);
        }

        #[test]
        fn test_get_nonexistent_link() {
            let store = MemoryLinkStore::<u64>::new();
            assert!(store.get(999).is_none());
        }

        #[test]
        fn test_exists_true() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();

            assert!(store.exists(link.id));
        }

        #[test]
        fn test_exists_false() {
            let store = MemoryLinkStore::<u64>::new();
            assert!(!store.exists(999));
        }
    }

    // -------------------------------------------------------------------------
    // Find and Pattern Matching Tests
    // -------------------------------------------------------------------------

    mod find_tests {
        use super::*;

        #[test]
        fn test_find_all() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();
            store.create(LinkRef::Id(5), LinkRef::Id(6)).unwrap();

            let results = store.find(&LinkPattern::all());
            assert_eq!(results.len(), 3);
        }

        #[test]
        fn test_find_by_source() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            store.create(LinkRef::Id(10), LinkRef::Id(30)).unwrap();
            store.create(LinkRef::Id(20), LinkRef::Id(30)).unwrap();

            let pattern = LinkPattern::with_source(LinkRef::Id(10u64));
            let results = store.find(&pattern);

            assert_eq!(results.len(), 2);
            for link in results {
                assert_eq!(link.source_id(), 10);
            }
        }

        #[test]
        fn test_find_by_target() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(10), LinkRef::Id(30)).unwrap();
            store.create(LinkRef::Id(20), LinkRef::Id(30)).unwrap();
            store.create(LinkRef::Id(30), LinkRef::Id(40)).unwrap();

            let pattern = LinkPattern::with_target(LinkRef::Id(30u64));
            let results = store.find(&pattern);

            assert_eq!(results.len(), 2);
            for link in results {
                assert_eq!(link.target_id(), 30);
            }
        }

        #[test]
        fn test_find_by_source_and_target() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            store.create(LinkRef::Id(10), LinkRef::Id(30)).unwrap();
            store.create(LinkRef::Id(20), LinkRef::Id(20)).unwrap();

            let pattern = LinkPattern::with_source_target(LinkRef::Id(10u64), LinkRef::Id(20u64));
            let results = store.find(&pattern);

            assert_eq!(results.len(), 1);
            assert_eq!(results[0].source_id(), 10);
            assert_eq!(results[0].target_id(), 20);
        }

        #[test]
        fn test_find_with_any_wildcard() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            store.create(LinkRef::Id(30), LinkRef::Id(20)).unwrap();
            store.create(LinkRef::Id(10), LinkRef::Id(40)).unwrap();

            let pattern = LinkPattern::<u64>::new().source(Any).target(20u64);
            let results = store.find(&pattern);

            assert_eq!(results.len(), 2);
            for link in results {
                assert_eq!(link.target_id(), 20);
            }
        }

        #[test]
        fn test_find_with_id_pattern() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link1 = store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();

            let pattern = LinkPattern::<u64>::new().id(link1.id);
            let results = store.find(&pattern);

            assert_eq!(results.len(), 1);
            assert_eq!(results[0].id, link1.id);
        }

        #[test]
        fn test_find_no_matches() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();

            let pattern = LinkPattern::with_source(LinkRef::Id(999u64));
            let results = store.find(&pattern);

            assert!(results.is_empty());
        }
    }

    // -------------------------------------------------------------------------
    // Count Tests
    // -------------------------------------------------------------------------

    mod count_tests {
        use super::*;

        #[test]
        fn test_total_count() {
            let mut store = MemoryLinkStore::<u64>::new();
            assert_eq!(store.total_count(), 0);

            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            assert_eq!(store.total_count(), 1);

            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();
            assert_eq!(store.total_count(), 2);
        }

        #[test]
        fn test_count_with_pattern() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            store.create(LinkRef::Id(10), LinkRef::Id(30)).unwrap();
            store.create(LinkRef::Id(20), LinkRef::Id(30)).unwrap();

            let pattern = LinkPattern::with_source(LinkRef::Id(10u64));
            assert_eq!(store.count(&pattern), 2);
        }
    }

    // -------------------------------------------------------------------------
    // Update Tests
    // -------------------------------------------------------------------------

    mod update_tests {
        use super::*;

        #[test]
        fn test_update_existing_link() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();

            let updated = store
                .update(link.id, LinkRef::Id(30), LinkRef::Id(40))
                .unwrap();

            assert_eq!(updated.id, link.id);
            assert_eq!(updated.source_id(), 30);
            assert_eq!(updated.target_id(), 40);
        }

        #[test]
        fn test_update_nonexistent_link() {
            let mut store = MemoryLinkStore::<u64>::new();
            let result = store.update(999, LinkRef::Id(1), LinkRef::Id(2));

            assert!(matches!(result, Err(LinkError::NotFound(999))));
        }

        #[test]
        fn test_update_removes_old_dedup_entry() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();

            // Update the link
            store
                .update(link.id, LinkRef::Id(30), LinkRef::Id(40))
                .unwrap();

            // Creating with old values should create a new link
            let new_link = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            assert_ne!(new_link.id, link.id);
        }

        #[test]
        fn test_update_to_existing_structure_fails() {
            let mut store = MemoryLinkStore::<u64>::new();
            let _link1 = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            let link2 = store.create(LinkRef::Id(30), LinkRef::Id(40)).unwrap();

            // Try to update link2 to have same structure as link1
            let result = store.update(link2.id, LinkRef::Id(10), LinkRef::Id(20));

            assert!(matches!(result, Err(LinkError::AlreadyExists(_))));
        }

        #[test]
        fn test_update_to_same_structure_succeeds() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();

            // Update to same structure should succeed
            let updated = store
                .update(link.id, LinkRef::Id(10), LinkRef::Id(20))
                .unwrap();

            assert_eq!(updated.id, link.id);
        }
    }

    // -------------------------------------------------------------------------
    // Delete Tests
    // -------------------------------------------------------------------------

    mod delete_tests {
        use super::*;

        #[test]
        fn test_delete_existing_link() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();

            assert!(store.delete(link.id));
            assert!(!store.exists(link.id));
            assert_eq!(store.total_count(), 0);
        }

        #[test]
        fn test_delete_nonexistent_link() {
            let mut store = MemoryLinkStore::<u64>::new();
            assert!(!store.delete(999));
        }

        #[test]
        fn test_delete_removes_dedup_entry() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            let original_id = link.id;

            store.delete(original_id);

            // Creating with same values should get a new ID
            let new_link = store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            assert_ne!(new_link.id, original_id);
        }

        #[test]
        fn test_delete_matching() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            store.create(LinkRef::Id(10), LinkRef::Id(30)).unwrap();
            store.create(LinkRef::Id(20), LinkRef::Id(30)).unwrap();

            let pattern = LinkPattern::with_source(LinkRef::Id(10u64));
            let deleted = store.delete_matching(&pattern);

            assert_eq!(deleted, 2);
            assert_eq!(store.total_count(), 1);
        }

        #[test]
        fn test_delete_matching_all() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();

            let deleted = store.delete_matching(&LinkPattern::all());

            assert_eq!(deleted, 2);
            assert_eq!(store.total_count(), 0);
        }
    }

    // -------------------------------------------------------------------------
    // Clear and Reset Tests
    // -------------------------------------------------------------------------

    mod clear_tests {
        use super::*;

        #[test]
        fn test_clear() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();

            store.clear();

            assert_eq!(store.total_count(), 0);
        }

        #[test]
        fn test_clear_preserves_id_counter() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();

            store.clear();

            let new_link = store.create(LinkRef::Id(5), LinkRef::Id(6)).unwrap();
            assert_eq!(new_link.id, 3); // Continues from 3
        }

        #[test]
        fn test_reset() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();

            store.reset();

            assert_eq!(store.total_count(), 0);
            let new_link = store.create(LinkRef::Id(5), LinkRef::Id(6)).unwrap();
            assert_eq!(new_link.id, 1); // Starts from 1 again
        }
    }

    // -------------------------------------------------------------------------
    // Iterator Tests
    // -------------------------------------------------------------------------

    mod iterator_tests {
        use super::*;

        #[test]
        fn test_iter_all() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();
            store.create(LinkRef::Id(3), LinkRef::Id(4)).unwrap();
            store.create(LinkRef::Id(5), LinkRef::Id(6)).unwrap();

            let count = store.iter_all().count();
            assert_eq!(count, 3);
        }

        #[test]
        fn test_iter_with_pattern() {
            let mut store = MemoryLinkStore::<u64>::new();
            store.create(LinkRef::Id(10), LinkRef::Id(20)).unwrap();
            store.create(LinkRef::Id(10), LinkRef::Id(30)).unwrap();
            store.create(LinkRef::Id(20), LinkRef::Id(30)).unwrap();

            let pattern = LinkPattern::with_source(LinkRef::Id(10u64));
            let count = store.iter(&pattern).count();

            assert_eq!(count, 2);
        }

        #[test]
        fn test_iter_empty_store() {
            let store = MemoryLinkStore::<u64>::new();
            let count = store.iter_all().count();
            assert_eq!(count, 0);
        }
    }

    // -------------------------------------------------------------------------
    // Thread Safety Tests (compile-time checks)
    // -------------------------------------------------------------------------

    mod thread_safety_tests {
        use super::*;

        fn assert_send<T: Send>() {}
        fn assert_sync<T: Sync>() {}

        #[test]
        fn test_memory_link_store_is_send() {
            assert_send::<MemoryLinkStore<u64>>();
        }

        #[test]
        fn test_memory_link_store_is_sync() {
            assert_sync::<MemoryLinkStore<u64>>();
        }
    }

    // -------------------------------------------------------------------------
    // Edge Case Tests
    // -------------------------------------------------------------------------

    mod edge_case_tests {
        use super::*;

        #[test]
        fn test_zero_ids_in_links() {
            let mut store = MemoryLinkStore::<u64>::new();
            let link = store.create(LinkRef::Id(0), LinkRef::Id(0)).unwrap();

            assert_eq!(link.source_id(), 0);
            assert_eq!(link.target_id(), 0);
            assert!(store.exists(link.id));
        }

        #[test]
        fn test_self_referential_link() {
            let mut store = MemoryLinkStore::<u64>::new();
            // Create a link where source and target reference the same ID
            let link = store.create(LinkRef::Id(42), LinkRef::Id(42)).unwrap();

            assert_eq!(link.source_id(), 42);
            assert_eq!(link.target_id(), 42);
        }

        #[test]
        fn test_many_links() {
            let mut store = MemoryLinkStore::<u64>::new();

            for i in 0..1000u64 {
                store.create(LinkRef::Id(i), LinkRef::Id(i + 1)).unwrap();
            }

            assert_eq!(store.total_count(), 1000);
        }
    }

    // -------------------------------------------------------------------------
    // LinkType Increment Tests
    // -------------------------------------------------------------------------

    mod increment_tests {
        use crate::LinkType;

        #[test]
        fn test_increment_u64() {
            assert_eq!(0u64.increment(), 1u64);
            assert_eq!(99u64.increment(), 100u64);
        }

        #[test]
        fn test_increment_u32() {
            assert_eq!(0u32.increment(), 1u32);
        }

        #[test]
        fn test_increment_usize() {
            assert_eq!(0usize.increment(), 1usize);
        }

        #[test]
        fn test_increment_wrapping() {
            // Test that wrapping works (won't panic on overflow)
            assert_eq!(u8::MAX.increment(), 0u8);
        }
    }
}
