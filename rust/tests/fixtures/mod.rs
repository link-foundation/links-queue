//! Test fixtures for links-queue.
//!
//! This module provides standardized test data and helper functions
//! that can be used across unit tests, integration tests, and benchmarks.

use links_queue::backends::memory::MemoryLinkStore;
use links_queue::traits::{Link, LinkPattern};

// =============================================================================
// Sample Links - Pre-created test data
// =============================================================================

/// Create a simple link with numeric values.
pub fn simple_link() -> Link<u64> {
    Link::new(1, 10, 20)
}

/// Create a link with zero values.
pub fn zero_link() -> Link<u64> {
    Link::new(0, 0, 0)
}

/// Create a self-referential link (source == target).
pub fn self_referential_link() -> Link<u64> {
    Link::new(5, 5, 5)
}

/// Create a link with additional values.
pub fn link_with_values() -> Link<u64> {
    Link::with_values(1, 10, 20, vec![30, 40, 50])
}

/// Create a "nothing" link (0, 0, 0).
pub fn nothing_link() -> Link<u64> {
    Link::nothing()
}

/// Create a "point" link (id, id, id).
pub fn point_link(id: u64) -> Link<u64> {
    Link::point(id)
}

// =============================================================================
// Bulk Data Generators
// =============================================================================

/// Generate a sequence of links with sequential IDs.
///
/// # Arguments
/// * `count` - Number of links to generate
/// * `start_id` - Starting ID (default: 1)
pub fn generate_sequential_links(count: usize, start_id: u64) -> Vec<Link<u64>> {
    (0..count)
        .map(|i| {
            let id = start_id + i as u64;
            Link::new(id, id * 10, id * 10 + 1)
        })
        .collect()
}

/// Generate links with random source/target values using a simple LCG.
///
/// # Arguments
/// * `count` - Number of links to generate
/// * `max_value` - Maximum value for source/target
/// * `seed` - Random seed
pub fn generate_pseudo_random_links(count: usize, max_value: u64, seed: u64) -> Vec<Link<u64>> {
    let mut state = seed;
    (0..count)
        .map(|i| {
            // Simple LCG for reproducible pseudo-random values
            state = state.wrapping_mul(1103515245).wrapping_add(12345);
            let source = (state >> 16) % max_value;
            state = state.wrapping_mul(1103515245).wrapping_add(12345);
            let target = (state >> 16) % max_value;
            Link::new(i as u64 + 1, source, target)
        })
        .collect()
}

// =============================================================================
// Store Fixtures
// =============================================================================

/// Create a fresh empty MemoryLinkStore.
pub fn create_empty_store() -> MemoryLinkStore<u64> {
    MemoryLinkStore::new()
}

/// Create a MemoryLinkStore with some initial capacity.
pub fn create_store_with_capacity(capacity: usize) -> MemoryLinkStore<u64> {
    MemoryLinkStore::with_capacity(capacity)
}

/// Create a MemoryLinkStore pre-populated with test data.
///
/// Creates 4 links: (1, 10), (1, 20), (2, 10), (2, 20)
pub fn create_standard_populated_store() -> MemoryLinkStore<u64> {
    let mut store = MemoryLinkStore::new();
    store.create(1, 10);
    store.create(1, 20);
    store.create(2, 10);
    store.create(2, 20);
    store
}

/// Create a MemoryLinkStore with a specified number of links.
pub fn create_populated_store(count: usize) -> MemoryLinkStore<u64> {
    let mut store = MemoryLinkStore::with_capacity(count);
    for i in 0..count {
        let source = (i % 100) as u64;
        let target = ((i * 7) % 100) as u64;
        store.create(source, target);
    }
    store
}

// =============================================================================
// Pattern Fixtures
// =============================================================================

/// Pattern that matches any link (all fields None).
pub fn any_pattern() -> LinkPattern<u64> {
    LinkPattern::default()
}

/// Pattern that matches by source only.
pub fn source_pattern(source: u64) -> LinkPattern<u64> {
    LinkPattern {
        id: None,
        source: Some(source),
        target: None,
    }
}

/// Pattern that matches by target only.
pub fn target_pattern(target: u64) -> LinkPattern<u64> {
    LinkPattern {
        id: None,
        source: None,
        target: Some(target),
    }
}

/// Pattern that matches by source and target.
pub fn source_target_pattern(source: u64, target: u64) -> LinkPattern<u64> {
    LinkPattern {
        id: None,
        source: Some(source),
        target: Some(target),
    }
}

/// Pattern that matches by ID only.
pub fn id_pattern(id: u64) -> LinkPattern<u64> {
    LinkPattern {
        id: Some(id),
        source: None,
        target: None,
    }
}

// =============================================================================
// Test Helpers
// =============================================================================

/// Assert that two links are equal.
#[track_caller]
pub fn assert_link_eq<T: std::fmt::Debug + PartialEq>(actual: &Link<T>, expected: &Link<T>) {
    assert_eq!(actual.id(), expected.id(), "Link IDs differ");
    assert_eq!(actual.source(), expected.source(), "Link sources differ");
    assert_eq!(actual.target(), expected.target(), "Link targets differ");
}

/// Assert that a link matches a pattern.
#[track_caller]
pub fn assert_matches_pattern<T: PartialEq + std::fmt::Debug>(
    link: &Link<T>,
    pattern: &LinkPattern<T>,
) {
    if let Some(ref id) = pattern.id {
        assert_eq!(link.id(), id, "Link ID doesn't match pattern");
    }
    if let Some(ref source) = pattern.source {
        assert_eq!(link.source(), source, "Link source doesn't match pattern");
    }
    if let Some(ref target) = pattern.target {
        assert_eq!(link.target(), target, "Link target doesn't match pattern");
    }
}

/// Measure execution time of a synchronous operation.
pub fn measure_time<F, R>(f: F) -> (R, std::time::Duration)
where
    F: FnOnce() -> R,
{
    let start = std::time::Instant::now();
    let result = f();
    let duration = start.elapsed();
    (result, duration)
}

/// Measure execution time of an async operation.
pub async fn measure_async_time<F, Fut, R>(f: F) -> (R, std::time::Duration)
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = R>,
{
    let start = std::time::Instant::now();
    let result = f().await;
    let duration = start.elapsed();
    (result, duration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_link() {
        let link = simple_link();
        assert_eq!(*link.id(), 1);
        assert_eq!(*link.source(), 10);
        assert_eq!(*link.target(), 20);
    }

    #[test]
    fn test_generate_sequential_links() {
        let links = generate_sequential_links(5, 1);
        assert_eq!(links.len(), 5);
        assert_eq!(*links[0].id(), 1);
        assert_eq!(*links[4].id(), 5);
    }

    #[test]
    fn test_standard_populated_store() {
        let store = create_standard_populated_store();
        assert_eq!(store.count(&any_pattern()), 4);
    }

    #[test]
    fn test_source_pattern() {
        let store = create_standard_populated_store();
        let pattern = source_pattern(1);
        let matches = store.find(&pattern);
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn test_measure_time() {
        let (result, duration) = measure_time(|| 2 + 2);
        assert_eq!(result, 4);
        assert!(duration.as_nanos() > 0);
    }
}
