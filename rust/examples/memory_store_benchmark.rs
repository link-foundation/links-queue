//! Performance benchmark example for MemoryLinkStore.
//!
//! This example demonstrates and validates the O(1) lookup performance
//! of the in-memory link store implementation.
//!
//! Run with: `cargo run --example memory_store_benchmark --release`

#![allow(clippy::uninlined_format_args)]

use links_queue::{LinkPattern, LinkRef, LinkStore, MemoryLinkStore};
use std::time::Instant;

const SMALL_SIZE: usize = 1_000;
const MEDIUM_SIZE: usize = 10_000;
const LARGE_SIZE: usize = 100_000;

fn main() {
    println!("=== MemoryLinkStore Performance Benchmark ===\n");

    // Run benchmarks at different scales
    run_benchmark_suite(SMALL_SIZE);
    run_benchmark_suite(MEDIUM_SIZE);
    run_benchmark_suite(LARGE_SIZE);

    // Test deduplication performance
    benchmark_deduplication();

    // Test pattern matching performance
    benchmark_pattern_matching();

    println!("=== Benchmark Complete ===");
}

fn run_benchmark_suite(size: usize) {
    println!("--- Benchmark with {} links ---\n", size);

    // 1. Measure creation time
    let (mut store, create_time) = benchmark_create(size);
    println!(
        "Create {} links: {:?} ({:.2} links/sec)",
        size,
        create_time,
        size as f64 / create_time.as_secs_f64()
    );

    // 2. Measure get by ID (O(1) validation)
    let get_time = benchmark_get(&store, size);
    println!(
        "Get {} links by ID: {:?} ({:.2} ops/sec)",
        size,
        get_time,
        size as f64 / get_time.as_secs_f64()
    );

    // 3. Measure exists check
    let exists_time = benchmark_exists(&store, size);
    println!(
        "Exists check {} times: {:?} ({:.2} ops/sec)",
        size,
        exists_time,
        size as f64 / exists_time.as_secs_f64()
    );

    // 4. Measure update time
    let update_time = benchmark_update(&mut store, size);
    println!(
        "Update {} links: {:?} ({:.2} ops/sec)",
        size,
        update_time,
        size as f64 / update_time.as_secs_f64()
    );

    // 5. Measure delete time (recreate store for this test)
    let (store_for_delete, _) = benchmark_create(size);
    let delete_time = benchmark_delete(store_for_delete, size);
    println!(
        "Delete {} links: {:?} ({:.2} ops/sec)",
        size,
        delete_time,
        size as f64 / delete_time.as_secs_f64()
    );

    println!();
}

fn benchmark_create(count: usize) -> (MemoryLinkStore<u64>, std::time::Duration) {
    let mut store = MemoryLinkStore::<u64>::with_capacity(count);

    let start = Instant::now();
    for i in 0..count {
        let source = (i % 100) as u64 + 1;
        let target = (i % 50) as u64 + 1;
        // Create unique links by varying values
        store
            .create_with_values(
                LinkRef::Id(source),
                LinkRef::Id(target),
                vec![LinkRef::Id(i as u64 + 1000)],
            )
            .unwrap();
    }
    let elapsed = start.elapsed();

    (store, elapsed)
}

fn benchmark_get(store: &MemoryLinkStore<u64>, count: usize) -> std::time::Duration {
    let start = Instant::now();
    for i in 1..=count {
        let _ = store.get(i as u64);
    }
    start.elapsed()
}

fn benchmark_exists(store: &MemoryLinkStore<u64>, count: usize) -> std::time::Duration {
    let start = Instant::now();
    for i in 1..=count {
        let _ = store.exists(i as u64);
    }
    start.elapsed()
}

fn benchmark_update(store: &mut MemoryLinkStore<u64>, count: usize) -> std::time::Duration {
    let start = Instant::now();
    for i in 1..=count {
        let _ = store.update(i as u64, LinkRef::Id(999), LinkRef::Id(999));
    }
    start.elapsed()
}

fn benchmark_delete(mut store: MemoryLinkStore<u64>, count: usize) -> std::time::Duration {
    let start = Instant::now();
    for i in 1..=count {
        let _ = store.delete(i as u64);
    }
    start.elapsed()
}

fn benchmark_deduplication() {
    println!("--- Deduplication Performance ---\n");

    let mut store = MemoryLinkStore::<u64>::new();
    let iterations = 10_000;

    // Create one unique link
    store.create(LinkRef::Id(1), LinkRef::Id(2)).unwrap();

    // Measure time for deduplication checks (should be fast due to hash lookup)
    let start = Instant::now();
    for _ in 0..iterations {
        let _ = store.create(LinkRef::Id(1), LinkRef::Id(2));
    }
    let elapsed = start.elapsed();

    println!(
        "Deduplication check {} times: {:?} ({:.2} ops/sec)",
        iterations,
        elapsed,
        iterations as f64 / elapsed.as_secs_f64()
    );

    // Verify deduplication worked
    assert_eq!(store.total_count(), 1, "Deduplication should prevent duplicates");
    println!("Store count after {} creates: 1 (deduplication verified)\n", iterations);
}

fn benchmark_pattern_matching() {
    println!("--- Pattern Matching Performance ---\n");

    let mut store = MemoryLinkStore::<u64>::new();

    // Create links with varied sources and targets
    let link_count = 10_000;
    for i in 0..link_count {
        let source = (i % 100) as u64 + 1;
        let target = (i % 50) as u64 + 1;
        store
            .create_with_values(
                LinkRef::Id(source),
                LinkRef::Id(target),
                vec![LinkRef::Id(i as u64 + 1000)],
            )
            .unwrap();
    }

    // Benchmark find with source pattern
    let pattern = LinkPattern::with_source(LinkRef::Id(1u64));
    let iterations = 1000;

    let start = Instant::now();
    for _ in 0..iterations {
        let _ = store.find(&pattern);
    }
    let elapsed = start.elapsed();

    let results = store.find(&pattern);
    println!(
        "Find by source pattern {} times: {:?} ({:.2} ops/sec)",
        iterations,
        elapsed,
        iterations as f64 / elapsed.as_secs_f64()
    );
    println!("Pattern matched {} links out of {}\n", results.len(), link_count);

    // Benchmark count with pattern
    let start = Instant::now();
    for _ in 0..iterations {
        let _ = store.count(&pattern);
    }
    let elapsed = start.elapsed();

    println!(
        "Count by pattern {} times: {:?} ({:.2} ops/sec)",
        iterations,
        elapsed,
        iterations as f64 / elapsed.as_secs_f64()
    );
}
