//! Core Link and `LinkStore` trait definitions for links-queue.
//!
//! This module provides the foundational traits for the Link data model
//! and `LinkStore` operations. These traits establish the API contract that
//! implementations must follow.
//!
//! # Design Goals
//!
//! - Compatible with [links-notation](https://github.com/link-foundation/links-notation) (supports nested/recursive structures)
//! - Compatible with [doublets-rs](https://github.com/linksplatform/doublets-rs) patterns (source/target model)
//! - Extensible for universal links with any number of references
//! - Generic over ID types for maximum flexibility
//!
//! # Example
//!
//! ```rust
//! use links_queue::{Link, LinkStore, LinkRef, LinkPattern, Any};
//!
//! // Create a simple link
//! let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
//!
//! // Pattern matching with wildcards
//! let pattern = LinkPattern::with_source(LinkRef::Id(2));
//! ```

use std::fmt::Debug;
use std::hash::Hash;

// =============================================================================
// ID Type Trait
// =============================================================================

/// Trait for types that can be used as link identifiers.
///
/// This trait defines the requirements for ID types, allowing the use of
/// various numeric types (u32, u64, usize, etc.) as link identifiers.
///
/// # Implementors
///
/// This trait is automatically implemented for common numeric types:
/// - `u8`, `u16`, `u32`, `u64`, `u128`, `usize`
/// - `i8`, `i16`, `i32`, `i64`, `i128`, `isize`
///
/// Custom types can also implement this trait for use as link IDs.
pub trait LinkType:
    Copy + Clone + Default + Debug + PartialEq + Eq + Hash + Send + Sync + 'static
{
    /// Returns the zero/default value for this type.
    fn zero() -> Self;

    /// Checks if this value represents "nothing" (typically zero).
    fn is_nothing(&self) -> bool;
}

// Implement LinkType for common numeric types
macro_rules! impl_link_type {
    ($($t:ty),*) => {
        $(
            impl LinkType for $t {
                #[inline]
                fn zero() -> Self {
                    0
                }

                #[inline]
                fn is_nothing(&self) -> bool {
                    *self == 0
                }
            }
        )*
    };
}

impl_link_type!(u8, u16, u32, u64, u128, usize);
impl_link_type!(i8, i16, i32, i64, i128, isize);

// =============================================================================
// Link Reference Enum
// =============================================================================

/// A reference to a link, which can be an ID or a nested Link.
///
/// This enum supports flexible link compositions and nested structures,
/// enabling arbitrary levels of recursion as required by links-notation.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Examples
///
/// ```rust
/// use links_queue::{Link, LinkRef};
///
/// // Direct reference by ID
/// let ref1: LinkRef<u64> = LinkRef::Id(42);
///
/// // Nested link reference
/// let inner = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
/// let ref2: LinkRef<u64> = LinkRef::Link(Box::new(inner));
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum LinkRef<T: LinkType> {
    /// Direct reference by link ID.
    Id(T),
    /// Nested link object (boxed to avoid infinite size).
    Link(Box<Link<T>>),
}

impl<T: LinkType> LinkRef<T> {
    /// Creates a new ID reference.
    #[inline]
    pub const fn id(id: T) -> Self {
        Self::Id(id)
    }

    /// Creates a new nested link reference.
    #[inline]
    pub fn link(link: Link<T>) -> Self {
        Self::Link(Box::new(link))
    }

    /// Returns the ID of this reference.
    ///
    /// If this is a nested link, returns the link's ID.
    pub fn get_id(&self) -> T {
        match self {
            Self::Id(id) => *id,
            Self::Link(link) => link.id,
        }
    }

    /// Returns true if this is an ID reference.
    #[inline]
    pub const fn is_id(&self) -> bool {
        matches!(self, Self::Id(_))
    }

    /// Returns true if this is a nested link reference.
    #[inline]
    pub const fn is_link(&self) -> bool {
        matches!(self, Self::Link(_))
    }

    /// Returns the ID if this is an ID reference, None otherwise.
    pub const fn as_id(&self) -> Option<T> {
        match self {
            Self::Id(id) => Some(*id),
            Self::Link(_) => None,
        }
    }

    /// Returns a reference to the nested link if this is a link reference, None otherwise.
    pub fn as_link(&self) -> Option<&Link<T>> {
        match self {
            Self::Id(_) => None,
            Self::Link(link) => Some(link),
        }
    }
}

impl<T: LinkType> From<T> for LinkRef<T> {
    fn from(id: T) -> Self {
        Self::Id(id)
    }
}

impl<T: LinkType> From<Link<T>> for LinkRef<T> {
    fn from(link: Link<T>) -> Self {
        Self::Link(Box::new(link))
    }
}

// =============================================================================
// Link Struct
// =============================================================================

/// Represents a link (associative data structure) connecting source to target.
///
/// A Link is the fundamental unit of data in links-queue. It represents
/// a directed relationship from a source to a target, identified by a unique ID.
///
/// For compatibility with links-notation's universal link model, additional
/// values can be provided beyond the basic source/target pair.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Examples
///
/// ```rust
/// use links_queue::{Link, LinkRef};
///
/// // Simple doublet-style link
/// let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
///
/// // Nested link structure
/// let inner = Link::new(2u64, LinkRef::Id(0), LinkRef::Id(0));
/// let nested = Link::new(1u64, LinkRef::link(inner), LinkRef::Id(5));
///
/// // Universal link with additional values
/// let universal = Link::with_values(
///     1u64,
///     LinkRef::Id(2),
///     LinkRef::Id(3),
///     vec![LinkRef::Id(4), LinkRef::Id(5)]
/// );
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Link<T: LinkType> {
    /// Unique identifier for this link.
    pub id: T,
    /// Reference to the source of this link.
    pub source: LinkRef<T>,
    /// Reference to the target of this link.
    pub target: LinkRef<T>,
    /// Optional additional values for universal links.
    pub values: Option<Vec<LinkRef<T>>>,
}

impl<T: LinkType> Link<T> {
    /// Creates a new link with the given ID, source, and target.
    ///
    /// # Arguments
    ///
    /// * `id` - The unique identifier for this link
    /// * `source` - Reference to the source
    /// * `target` - Reference to the target
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::{Link, LinkRef};
    ///
    /// let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
    /// assert_eq!(link.id, 1);
    /// ```
    #[inline]
    pub const fn new(id: T, source: LinkRef<T>, target: LinkRef<T>) -> Self {
        Self {
            id,
            source,
            target,
            values: None,
        }
    }

    /// Creates a new link with additional values (universal link).
    ///
    /// # Arguments
    ///
    /// * `id` - The unique identifier for this link
    /// * `source` - Reference to the source
    /// * `target` - Reference to the target
    /// * `values` - Additional value references
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::{Link, LinkRef};
    ///
    /// let link = Link::with_values(
    ///     1u64,
    ///     LinkRef::Id(2),
    ///     LinkRef::Id(3),
    ///     vec![LinkRef::Id(4), LinkRef::Id(5)]
    /// );
    /// assert!(link.values.is_some());
    /// ```
    #[inline]
    pub fn with_values(
        id: T,
        source: LinkRef<T>,
        target: LinkRef<T>,
        values: Vec<LinkRef<T>>,
    ) -> Self {
        Self {
            id,
            source,
            target,
            values: if values.is_empty() { None } else { Some(values) },
        }
    }

    /// Creates a "point" link where id == source == target.
    ///
    /// A point link represents a self-referential entity.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::Link;
    ///
    /// let point = Link::<u64>::point(42);
    /// assert_eq!(point.source.get_id(), 42);
    /// assert_eq!(point.target.get_id(), 42);
    /// ```
    #[inline]
    #[must_use]
    pub const fn point(id: T) -> Self {
        Self::new(id, LinkRef::Id(id), LinkRef::Id(id))
    }

    /// Creates a "null" link with all fields set to zero/default.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use links_queue::Link;
    ///
    /// let null_link = Link::<u64>::nothing();
    /// assert!(null_link.is_null());
    /// ```
    #[inline]
    #[must_use] 
    pub fn nothing() -> Self {
        let zero = T::zero();
        Self::new(zero, LinkRef::Id(zero), LinkRef::Id(zero))
    }

    /// Returns true if this link is a "point" (id == source == target).
    pub fn is_point(&self) -> bool {
        self.source.get_id() == self.id && self.target.get_id() == self.id
    }

    /// Returns true if this is a null link (all fields are zero/nothing).
    pub fn is_null(&self) -> bool {
        self.id.is_nothing()
            && self.source.get_id().is_nothing()
            && self.target.get_id().is_nothing()
    }

    /// Returns true if this link has additional values.
    pub fn has_values(&self) -> bool {
        self.values.as_ref().is_some_and(|v| !v.is_empty())
    }

    /// Returns the source ID.
    pub fn source_id(&self) -> T {
        self.source.get_id()
    }

    /// Returns the target ID.
    pub fn target_id(&self) -> T {
        self.target.get_id()
    }
}

impl<T: LinkType> Default for Link<T> {
    fn default() -> Self {
        Self::nothing()
    }
}

// =============================================================================
// Pattern Matching
// =============================================================================

/// Represents "any" value in pattern matching.
///
/// Use this in [`LinkPattern`] to match any value in that position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Any;

/// A pattern field that can match a specific value or any value.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[derive(Default)]
pub enum PatternField<T: LinkType> {
    /// Match any value.
    #[default]
    Any,
    /// Match a specific value.
    Value(LinkRef<T>),
}


impl<T: LinkType> PatternField<T> {
    /// Returns true if this field matches the given reference.
    pub fn matches(&self, reference: &LinkRef<T>) -> bool {
        match self {
            Self::Any => true,
            Self::Value(pattern_ref) => pattern_ref.get_id() == reference.get_id(),
        }
    }
}

impl<T: LinkType> From<LinkRef<T>> for PatternField<T> {
    fn from(reference: LinkRef<T>) -> Self {
        Self::Value(reference)
    }
}

impl<T: LinkType> From<T> for PatternField<T> {
    fn from(id: T) -> Self {
        Self::Value(LinkRef::Id(id))
    }
}

impl<T: LinkType> From<Any> for PatternField<T> {
    fn from(_: Any) -> Self {
        Self::Any
    }
}

/// Pattern for matching links in queries.
///
/// Each field can be set to match a specific value or use [`Any`] as a wildcard.
/// Fields set to [`PatternField::Any`] will match any value in that position.
///
/// # Examples
///
/// ```rust
/// use links_queue::{LinkPattern, LinkRef, Any};
///
/// // Match all links with source = 5
/// let pattern = LinkPattern::<u64>::with_source(LinkRef::Id(5));
///
/// // Match all links with any source and target = 10
/// let pattern2 = LinkPattern::<u64>::new()
///     .source(Any)
///     .target(10u64);
///
/// // Match all links (equivalent to no filter)
/// let pattern3 = LinkPattern::<u64>::all();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub struct LinkPattern<T: LinkType> {
    /// Match criteria for link ID.
    pub id: PatternField<T>,
    /// Match criteria for link source.
    pub source: PatternField<T>,
    /// Match criteria for link target.
    pub target: PatternField<T>,
}

impl<T: LinkType> LinkPattern<T> {
    /// Creates a new empty pattern (matches all links).
    #[inline]
    #[must_use] 
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a pattern that matches all links.
    #[inline]
    #[must_use] 
    pub fn all() -> Self {
        Self::default()
    }

    /// Creates a pattern that matches links with the given source.
    pub const fn with_source(source: LinkRef<T>) -> Self {
        Self {
            id: PatternField::Any,
            source: PatternField::Value(source),
            target: PatternField::Any,
        }
    }

    /// Creates a pattern that matches links with the given target.
    pub const fn with_target(target: LinkRef<T>) -> Self {
        Self {
            id: PatternField::Any,
            source: PatternField::Any,
            target: PatternField::Value(target),
        }
    }

    /// Creates a pattern that matches links with the given source and target.
    pub const fn with_source_target(source: LinkRef<T>, target: LinkRef<T>) -> Self {
        Self {
            id: PatternField::Any,
            source: PatternField::Value(source),
            target: PatternField::Value(target),
        }
    }

    /// Sets the ID pattern field (builder pattern).
    #[must_use]
    pub fn id(mut self, id: impl Into<PatternField<T>>) -> Self {
        self.id = id.into();
        self
    }

    /// Sets the source pattern field (builder pattern).
    #[must_use]
    pub fn source(mut self, source: impl Into<PatternField<T>>) -> Self {
        self.source = source.into();
        self
    }

    /// Sets the target pattern field (builder pattern).
    #[must_use]
    pub fn target(mut self, target: impl Into<PatternField<T>>) -> Self {
        self.target = target.into();
        self
    }

    /// Checks if this pattern matches the given link.
    pub fn matches(&self, link: &Link<T>) -> bool {
        self.id.matches(&LinkRef::Id(link.id))
            && self.source.matches(&link.source)
            && self.target.matches(&link.target)
    }
}

// =============================================================================
// Error Types
// =============================================================================

/// Errors that can occur during link store operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError<T: LinkType> {
    /// The requested link does not exist.
    NotFound(T),
    /// A link with this ID already exists.
    AlreadyExists(T),
    /// The link cannot be deleted because it has usages.
    HasUsages(Vec<Link<T>>),
    /// Storage limit has been reached.
    LimitReached,
    /// A custom error with a message.
    Other(String),
}

impl<T: LinkType> std::fmt::Display for LinkError<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Link with ID {id:?} not found"),
            Self::AlreadyExists(id) => write!(f, "Link with ID {id:?} already exists"),
            Self::HasUsages(links) => write!(f, "Link has {} usages", links.len()),
            Self::LimitReached => write!(f, "Storage limit reached"),
            Self::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl<T: LinkType> std::error::Error for LinkError<T> {}

/// Result type for link store operations.
pub type LinkResult<T, V> = Result<V, LinkError<T>>;

// =============================================================================
// LinkStore Trait
// =============================================================================

/// Trait for link storage operations.
///
/// Provides CRUD operations for managing links, plus query capabilities
/// with pattern matching support. This is the main trait that
/// implementations must satisfy.
///
/// The design follows the doublets-rs trait pattern while maintaining
/// Rust idioms and safety guarantees.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Example Implementation
///
/// ```rust,ignore
/// use links_queue::{LinkStore, Link, LinkRef, LinkPattern, LinkResult, LinkError};
///
/// struct InMemoryLinkStore<T: LinkType> {
///     links: std::collections::HashMap<T, Link<T>>,
///     next_id: T,
/// }
///
/// impl<T: LinkType> LinkStore<T> for InMemoryLinkStore<T> {
///     // ... implementation
/// }
/// ```
pub trait LinkStore<T: LinkType>: Send + Sync {
    // -------------------------------------------------------------------------
    // Create Operations
    // -------------------------------------------------------------------------

    /// Creates a new link from source to target.
    ///
    /// The implementation should auto-generate a unique ID for the link.
    ///
    /// # Arguments
    ///
    /// * `source` - The source reference for the new link
    /// * `target` - The target reference for the new link
    ///
    /// # Returns
    ///
    /// The newly created Link with its assigned ID.
    fn create(&mut self, source: LinkRef<T>, target: LinkRef<T>) -> LinkResult<T, Link<T>>;

    /// Creates a new link with additional values (universal link).
    ///
    /// # Arguments
    ///
    /// * `source` - The source reference for the new link
    /// * `target` - The target reference for the new link
    /// * `values` - Additional value references
    ///
    /// # Returns
    ///
    /// The newly created Link with its assigned ID.
    fn create_with_values(
        &mut self,
        source: LinkRef<T>,
        target: LinkRef<T>,
        values: Vec<LinkRef<T>>,
    ) -> LinkResult<T, Link<T>>;

    // -------------------------------------------------------------------------
    // Read Operations
    // -------------------------------------------------------------------------

    /// Retrieves a link by its ID.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID of the link to retrieve
    ///
    /// # Returns
    ///
    /// The Link if found, None otherwise.
    fn get(&self, id: T) -> Option<&Link<T>>;

    /// Checks if a link with the given ID exists.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID to check
    ///
    /// # Returns
    ///
    /// True if the link exists, false otherwise.
    fn exists(&self, id: T) -> bool {
        self.get(id).is_some()
    }

    /// Finds links matching the given pattern.
    ///
    /// Supports wildcards via the [`Any`] pattern for flexible querying.
    ///
    /// # Arguments
    ///
    /// * `pattern` - The pattern to match against
    ///
    /// # Returns
    ///
    /// Vector of references to matching links.
    fn find(&self, pattern: &LinkPattern<T>) -> Vec<&Link<T>>;

    /// Counts links matching the given pattern.
    ///
    /// # Arguments
    ///
    /// * `pattern` - The pattern to match against
    ///
    /// # Returns
    ///
    /// Count of matching links.
    fn count(&self, pattern: &LinkPattern<T>) -> usize {
        self.find(pattern).len()
    }

    /// Returns the total number of links in the store.
    fn total_count(&self) -> usize {
        self.count(&LinkPattern::all())
    }

    // -------------------------------------------------------------------------
    // Update Operations
    // -------------------------------------------------------------------------

    /// Updates an existing link's source and/or target.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID of the link to update
    /// * `source` - New source reference
    /// * `target` - New target reference
    ///
    /// # Returns
    ///
    /// The updated Link, or an error if the link doesn't exist.
    fn update(
        &mut self,
        id: T,
        source: LinkRef<T>,
        target: LinkRef<T>,
    ) -> LinkResult<T, Link<T>>;

    // -------------------------------------------------------------------------
    // Delete Operations
    // -------------------------------------------------------------------------

    /// Deletes a link by its ID.
    ///
    /// # Arguments
    ///
    /// * `id` - The ID of the link to delete
    ///
    /// # Returns
    ///
    /// True if the link was deleted, false if it didn't exist.
    fn delete(&mut self, id: T) -> bool;

    /// Deletes all links matching the given pattern.
    ///
    /// # Arguments
    ///
    /// * `pattern` - The pattern to match for deletion
    ///
    /// # Returns
    ///
    /// Count of deleted links.
    fn delete_matching(&mut self, pattern: &LinkPattern<T>) -> usize;

    // -------------------------------------------------------------------------
    // Iteration Operations
    // -------------------------------------------------------------------------

    /// Returns an iterator over all links matching the given pattern.
    ///
    /// # Arguments
    ///
    /// * `pattern` - The pattern to filter links
    ///
    /// # Returns
    ///
    /// Iterator of references to matching links.
    fn iter(&self, pattern: &LinkPattern<T>) -> Box<dyn Iterator<Item = &Link<T>> + '_>;

    /// Returns an iterator over all links.
    fn iter_all(&self) -> Box<dyn Iterator<Item = &Link<T>> + '_> {
        self.iter(&LinkPattern::all())
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
#[allow(clippy::redundant_clone)]
mod tests {
    use super::*;

    mod link_type_tests {
        use super::*;

        #[test]
        fn test_link_type_zero() {
            assert_eq!(u64::zero(), 0u64);
            assert_eq!(i32::zero(), 0i32);
        }

        #[test]
        fn test_link_type_is_nothing() {
            assert!(0u64.is_nothing());
            assert!(!1u64.is_nothing());
            assert!(0i32.is_nothing());
            assert!(!(-1i32).is_nothing());
        }
    }

    mod link_ref_tests {
        use super::*;

        #[test]
        fn test_link_ref_id() {
            let ref_id: LinkRef<u64> = LinkRef::Id(42);
            assert!(ref_id.is_id());
            assert!(!ref_id.is_link());
            assert_eq!(ref_id.get_id(), 42);
            assert_eq!(ref_id.as_id(), Some(42));
            assert!(ref_id.as_link().is_none());
        }

        #[test]
        fn test_link_ref_link() {
            let inner = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let ref_link: LinkRef<u64> = LinkRef::link(inner.clone());
            assert!(!ref_link.is_id());
            assert!(ref_link.is_link());
            assert_eq!(ref_link.get_id(), 1);
            assert!(ref_link.as_id().is_none());
            assert!(ref_link.as_link().is_some());
        }

        #[test]
        fn test_link_ref_from_id() {
            let ref_id: LinkRef<u64> = 42u64.into();
            assert_eq!(ref_id.get_id(), 42);
        }

        #[test]
        fn test_link_ref_from_link() {
            let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let ref_link: LinkRef<u64> = link.into();
            assert_eq!(ref_link.get_id(), 1);
        }
    }

    mod link_tests {
        use super::*;

        #[test]
        fn test_link_new() {
            let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            assert_eq!(link.id, 1);
            assert_eq!(link.source_id(), 2);
            assert_eq!(link.target_id(), 3);
            assert!(!link.has_values());
        }

        #[test]
        fn test_link_with_values() {
            let link = Link::with_values(
                1u64,
                LinkRef::Id(2),
                LinkRef::Id(3),
                vec![LinkRef::Id(4), LinkRef::Id(5)],
            );
            assert!(link.has_values());
            assert_eq!(link.values.as_ref().unwrap().len(), 2);
        }

        #[test]
        fn test_link_point() {
            let point = Link::<u64>::point(42);
            assert!(point.is_point());
            assert_eq!(point.id, 42);
            assert_eq!(point.source_id(), 42);
            assert_eq!(point.target_id(), 42);
        }

        #[test]
        fn test_link_nothing() {
            let null_link = Link::<u64>::nothing();
            assert!(null_link.is_null());
            assert_eq!(null_link.id, 0);
        }

        #[test]
        fn test_link_nested() {
            let inner = Link::new(2u64, LinkRef::Id(3), LinkRef::Id(4));
            let outer = Link::new(1u64, LinkRef::link(inner.clone()), LinkRef::Id(5));
            assert_eq!(outer.source_id(), 2);
            assert_eq!(outer.target_id(), 5);
        }
    }

    mod pattern_tests {
        use super::*;

        #[test]
        fn test_pattern_matches_all() {
            let pattern = LinkPattern::<u64>::all();
            let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            assert!(pattern.matches(&link));
        }

        #[test]
        fn test_pattern_with_source() {
            let pattern = LinkPattern::with_source(LinkRef::Id(2u64));
            let link1 = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let link2 = Link::new(1u64, LinkRef::Id(5), LinkRef::Id(3));
            assert!(pattern.matches(&link1));
            assert!(!pattern.matches(&link2));
        }

        #[test]
        fn test_pattern_with_target() {
            let pattern = LinkPattern::with_target(LinkRef::Id(3u64));
            let link1 = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let link2 = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(5));
            assert!(pattern.matches(&link1));
            assert!(!pattern.matches(&link2));
        }

        #[test]
        fn test_pattern_builder() {
            let pattern = LinkPattern::<u64>::new()
                .source(2u64)
                .target(Any);
            let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            assert!(pattern.matches(&link));
        }

        #[test]
        fn test_pattern_with_source_target() {
            let pattern = LinkPattern::with_source_target(
                LinkRef::Id(2u64),
                LinkRef::Id(3u64),
            );
            let link1 = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let link2 = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(5));
            assert!(pattern.matches(&link1));
            assert!(!pattern.matches(&link2));
        }
    }

    mod error_tests {
        use super::*;

        #[test]
        fn test_error_display() {
            let err: LinkError<u64> = LinkError::NotFound(42);
            assert!(err.to_string().contains("42"));

            let err2: LinkError<u64> = LinkError::AlreadyExists(1);
            assert!(err2.to_string().contains("already exists"));
        }
    }
}
