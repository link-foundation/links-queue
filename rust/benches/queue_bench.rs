//! Benchmarks for queue operations.
//!
//! These benchmarks measure the performance of queue-related operations:
//! - Enqueue throughput
//! - Dequeue throughput
//! - Peek operations
//! - Queue depth queries
//!
//! Run with: `cargo bench --bench queue_bench`

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use links_queue::{Link, LinkRef, MemoryQueue, Queue, QueueOptions};

/// Helper to create a populated queue using a blocking runtime.
fn create_populated_queue(name: &str, count: usize) -> MemoryQueue<u64> {
    let queue = MemoryQueue::new(name, QueueOptions::default());
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();

    rt.block_on(async {
        for i in 0..count {
            let link = Link::new(i as u64, LinkRef::Id(i as u64), LinkRef::Id((i + 1) as u64));
            queue.enqueue(link).await.ok();
        }
    });

    queue
}

/// Benchmark enqueue operations using batched iteration.
fn bench_enqueue(c: &mut Criterion) {
    let mut group = c.benchmark_group("queue/enqueue");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();

    for size in [100, 1000] {
        group.throughput(Throughput::Elements(1));
        group.bench_with_input(
            BenchmarkId::new("memory_queue", size),
            &size,
            |b, &_size| {
                b.iter_batched(
                    || {
                        let queue = MemoryQueue::new("bench-queue", QueueOptions::default());
                        let counter = 0u64;
                        (queue, counter)
                    },
                    |(queue, mut counter)| {
                        counter += 1;
                        let link =
                            Link::new(counter, LinkRef::Id(counter), LinkRef::Id(counter + 1));
                        rt.block_on(async { queue.enqueue(black_box(link)).await })
                    },
                    criterion::BatchSize::SmallInput,
                );
            },
        );
    }

    group.finish();
}

/// Benchmark dequeue operations.
fn bench_dequeue(c: &mut Criterion) {
    let mut group = c.benchmark_group("queue/dequeue");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();

    for size in [100, 1000] {
        group.throughput(Throughput::Elements(1));
        group.bench_with_input(BenchmarkId::new("memory_queue", size), &size, |b, &size| {
            b.iter_batched(
                || create_populated_queue("bench-queue", size),
                |queue| rt.block_on(async { queue.dequeue().await }),
                criterion::BatchSize::SmallInput,
            );
        });
    }

    group.finish();
}

/// Benchmark peek operations.
fn bench_peek(c: &mut Criterion) {
    let mut group = c.benchmark_group("queue/peek");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();

    for size in [100, 1000] {
        group.throughput(Throughput::Elements(1));
        let queue = create_populated_queue("bench-queue", size);

        group.bench_with_input(
            BenchmarkId::new("memory_queue", size),
            &queue,
            |b, queue| {
                b.iter(|| rt.block_on(async { queue.peek().await }));
            },
        );
    }

    group.finish();
}

/// Benchmark depth query operations.
fn bench_depth(c: &mut Criterion) {
    let mut group = c.benchmark_group("queue/depth");

    for size in [100, 1000, 10000] {
        group.throughput(Throughput::Elements(1));
        let queue = create_populated_queue("bench-queue", size);

        group.bench_with_input(
            BenchmarkId::new("memory_queue", size),
            &queue,
            |b, queue| {
                b.iter(|| queue.depth());
            },
        );
    }

    group.finish();
}

/// Benchmark enqueue+dequeue cycle (round-trip).
fn bench_roundtrip(c: &mut Criterion) {
    let mut group = c.benchmark_group("queue/roundtrip");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();

    group.throughput(Throughput::Elements(2)); // One enqueue + one dequeue

    group.bench_function("enqueue_dequeue", |b| {
        b.iter_batched(
            || {
                let queue = MemoryQueue::new("bench-queue", QueueOptions::default());
                let counter = 0u64;
                (queue, counter)
            },
            |(queue, mut counter)| {
                counter += 1;
                let link = Link::new(counter, LinkRef::Id(counter), LinkRef::Id(counter + 1));
                rt.block_on(async {
                    queue.enqueue(black_box(link)).await.ok();
                    queue.dequeue().await
                })
            },
            criterion::BatchSize::SmallInput,
        );
    });

    group.finish();
}

/// Benchmark bulk enqueue operations.
fn bench_bulk_enqueue(c: &mut Criterion) {
    let mut group = c.benchmark_group("queue/bulk_enqueue");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();

    for batch_size in [10, 100] {
        group.throughput(Throughput::Elements(batch_size as u64));
        group.bench_with_input(
            BenchmarkId::new("memory_queue", batch_size),
            &batch_size,
            |b, &batch_size| {
                b.iter_batched(
                    || {
                        let queue = MemoryQueue::new("bench-queue", QueueOptions::default());
                        (queue, 0u64)
                    },
                    |(queue, mut counter)| {
                        rt.block_on(async {
                            for _ in 0..batch_size {
                                counter += 1;
                                let link = Link::new(
                                    counter,
                                    LinkRef::Id(counter),
                                    LinkRef::Id(counter + 1),
                                );
                                queue.enqueue(black_box(link)).await.ok();
                            }
                        })
                    },
                    criterion::BatchSize::SmallInput,
                );
            },
        );
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_enqueue,
    bench_dequeue,
    bench_peek,
    bench_depth,
    bench_roundtrip,
    bench_bulk_enqueue,
);

criterion_main!(benches);
