//! Benchmarks for MemoryLinkStore operations.
//!
//! These benchmarks measure the performance of core link operations:
//! - Link creation
//! - Link retrieval (by ID)
//! - Pattern matching queries
//! - Link updates
//! - Link deletion
//!
//! Run with: `cargo bench --bench memory_bench`

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use links_queue::{LinkPattern, LinkRef, LinkStore, MemoryLinkStore};

/// Create a pre-populated store with N links for benchmarking.
fn create_populated_store(count: usize) -> MemoryLinkStore<u64> {
    let mut store = MemoryLinkStore::new();
    for i in 0..count {
        let source = (i % 100) as u64;
        let target = ((i * 7) % 100) as u64;
        let _ = store.create(LinkRef::Id(source), LinkRef::Id(target));
    }
    store
}

/// Benchmark link creation operations.
fn bench_create(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/create");

    // Test different store sizes
    for size in [100, 1000, 10000] {
        group.throughput(Throughput::Elements(1));
        group.bench_with_input(BenchmarkId::new("unique", size), &size, |b, &size| {
            let mut store: MemoryLinkStore<u64> = create_populated_store(size);
            let mut counter = size as u64;
            b.iter(|| {
                counter += 1;
                store.create(
                    black_box(LinkRef::Id(counter)),
                    black_box(LinkRef::Id(counter + 1)),
                )
            });
        });

        group.bench_with_input(BenchmarkId::new("deduplicated", size), &size, |b, &size| {
            let mut store: MemoryLinkStore<u64> = create_populated_store(size);
            b.iter(|| store.create(black_box(LinkRef::Id(0u64)), black_box(LinkRef::Id(7u64))));
        });
    }

    group.finish();
}

/// Benchmark link retrieval by ID.
fn bench_get(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/get");

    for size in [100, 1000, 10000] {
        let store: MemoryLinkStore<u64> = create_populated_store(size);
        let ids: Vec<u64> = (1..=size as u64).collect();

        group.throughput(Throughput::Elements(1));
        group.bench_with_input(
            BenchmarkId::new("by_id", size),
            &(store, ids),
            |b, (store, ids)| {
                let mut idx = 0;
                b.iter(|| {
                    idx = (idx + 1) % ids.len();
                    store.get(black_box(ids[idx]))
                });
            },
        );
    }

    group.finish();
}

/// Benchmark exists check.
fn bench_exists(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/exists");

    for size in [100, 1000, 10000] {
        let store: MemoryLinkStore<u64> = create_populated_store(size);
        let ids: Vec<u64> = (1..=size as u64).collect();

        group.throughput(Throughput::Elements(1));
        group.bench_with_input(
            BenchmarkId::new("existing", size),
            &(store, ids),
            |b, (store, ids)| {
                let mut idx = 0;
                b.iter(|| {
                    idx = (idx + 1) % ids.len();
                    store.exists(black_box(ids[idx]))
                });
            },
        );
    }

    group.finish();
}

/// Benchmark pattern matching queries.
fn bench_find(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/find");

    for size in [100, 1000, 10000] {
        let store: MemoryLinkStore<u64> = create_populated_store(size);

        group.throughput(Throughput::Elements(1));

        // Find by source
        group.bench_with_input(BenchmarkId::new("by_source", size), &store, |b, store| {
            b.iter(|| store.find(&LinkPattern::with_source(LinkRef::Id(black_box(50u64)))));
        });

        // Find by source and target
        group.bench_with_input(
            BenchmarkId::new("by_source_target", size),
            &store,
            |b, store| {
                b.iter(|| {
                    store.find(
                        &LinkPattern::new()
                            .source(LinkRef::Id(black_box(50u64)))
                            .target(LinkRef::Id(black_box(50u64))),
                    )
                });
            },
        );

        // Find all (empty pattern)
        group.bench_with_input(BenchmarkId::new("all", size), &store, |b, store| {
            b.iter(|| store.find(&LinkPattern::default()));
        });
    }

    group.finish();
}

/// Benchmark count operations.
fn bench_count(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/count");

    for size in [100, 1000, 10000] {
        let store: MemoryLinkStore<u64> = create_populated_store(size);

        group.throughput(Throughput::Elements(1));

        // Count all
        group.bench_with_input(BenchmarkId::new("all", size), &store, |b, store| {
            b.iter(|| store.count(&LinkPattern::default()));
        });

        // Count with pattern
        group.bench_with_input(
            BenchmarkId::new("with_pattern", size),
            &store,
            |b, store| {
                b.iter(|| store.count(&LinkPattern::with_source(LinkRef::Id(black_box(50u64)))));
            },
        );
    }

    group.finish();
}

/// Benchmark update operations.
fn bench_update(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/update");

    for size in [100, 1000, 10000] {
        group.throughput(Throughput::Elements(1));
        group.bench_with_input(BenchmarkId::new("existing", size), &size, |b, &size| {
            let mut store: MemoryLinkStore<u64> = create_populated_store(size);
            let ids: Vec<u64> = (1..=size as u64).collect();
            let mut idx = 0;
            let mut counter = 1000u64;
            b.iter(|| {
                idx = (idx + 1) % ids.len();
                counter += 1;
                store.update(
                    black_box(ids[idx]),
                    black_box(LinkRef::Id(counter)),
                    black_box(LinkRef::Id(counter + 1)),
                )
            });
        });
    }

    group.finish();
}

/// Benchmark delete operations.
fn bench_delete(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/delete");

    for size in [100, 1000, 10000] {
        group.throughput(Throughput::Elements(1));
        group.bench_with_input(BenchmarkId::new("existing", size), &size, |b, &size| {
            b.iter_batched(
                || {
                    let store: MemoryLinkStore<u64> = create_populated_store(size);
                    let ids: Vec<u64> = (1..=size as u64).collect();
                    (store, ids, 0)
                },
                |(mut store, ids, mut idx)| {
                    idx = (idx + 1) % ids.len();
                    store.delete(black_box(ids[idx]))
                },
                criterion::BatchSize::SmallInput,
            );
        });
    }

    group.finish();
}

/// Benchmark clear operation.
fn bench_clear(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_store/clear");

    for size in [100, 1000, 10000] {
        group.throughput(Throughput::Elements(size as u64));
        group.bench_with_input(BenchmarkId::new("full_store", size), &size, |b, &size| {
            b.iter_batched(
                || create_populated_store(size),
                |mut store| store.clear(),
                criterion::BatchSize::SmallInput,
            );
        });
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_create,
    bench_get,
    bench_exists,
    bench_find,
    bench_count,
    bench_update,
    bench_delete,
    bench_clear,
);

criterion_main!(benches);
