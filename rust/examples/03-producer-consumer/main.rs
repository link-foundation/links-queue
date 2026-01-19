//! Producer-Consumer Example for links-queue
//!
//! This example demonstrates the classic producer-consumer pattern using
//! Links Queue as a work queue. Multiple producers generate tasks and
//! multiple consumers process them concurrently.
//!
//! Run with: `cargo run --example 03-producer-consumer`

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

use links_queue::{Link, LinkRef, MemoryQueue, Queue, QueueOptions};

// Configuration constants (moved to module level to satisfy clippy)
const PRODUCER_COUNT: u32 = 2;
const CONSUMER_COUNT: u32 = 3;
const TASKS_PER_PRODUCER: u32 = 5;

/// Simulated processing time (50-200ms)
async fn simulate_work() {
    let delay_ms = 50 + rand_u64() % 150;
    sleep(Duration::from_millis(delay_ms)).await;
}

/// Simple pseudo-random number generator (for demo purposes)
#[allow(clippy::cast_possible_truncation)]
fn rand_u64() -> u64 {
    use std::time::SystemTime;
    // Note: truncation from u128 is intentional for randomness
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    // Simple LCG
    now.wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407)
        % 256
}

/// Producer: generates tasks and enqueues them
async fn producer(
    queue: Arc<MemoryQueue<u64>>,
    producer_id: u32,
    task_count: u32,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    println!("Producer {producer_id}: Starting, will create {task_count} tasks");

    for i in 0..task_count {
        // Create a task link
        // id = unique task ID
        // source = task type (1, 2, or 3)
        // target = task payload (producer_id * 1000 + task_number)
        let task_id = u64::from(producer_id) * 1000 + u64::from(i);
        let task_type = (i % 3) + 1; // task type 1, 2, or 3
        let payload = u64::from(producer_id) * 10000 + u64::from(i);

        let task_link = Link::new(
            task_id,
            LinkRef::Id(u64::from(task_type)),
            LinkRef::Id(payload),
        );

        let result = queue.enqueue(task_link).await?;
        println!(
            "Producer {}: Enqueued task {} at position {}",
            producer_id, task_id, result.position
        );

        // Small delay between producing tasks
        sleep(Duration::from_millis(10)).await;
    }

    println!("Producer {producer_id}: Finished producing");
    Ok(())
}

/// Consumer: processes tasks from the queue
async fn consumer(
    queue: Arc<MemoryQueue<u64>>,
    consumer_id: u32,
    stop_signal: Arc<AtomicBool>,
    processed_count: Arc<AtomicUsize>,
) -> u32 {
    println!("Consumer {consumer_id}: Starting");
    let mut processed = 0u32;

    while !stop_signal.load(Ordering::Relaxed) {
        match queue.dequeue().await {
            Ok(Some(task)) => {
                println!(
                    "Consumer {}: Processing task {} (type: {})",
                    consumer_id,
                    task.id,
                    task.source_id()
                );

                // Simulate processing work
                simulate_work().await;

                // Acknowledge successful processing
                if let Err(e) = queue.acknowledge(task.id).await {
                    eprintln!(
                        "Consumer {}: Failed to acknowledge task {}: {}",
                        consumer_id, task.id, e
                    );
                } else {
                    processed += 1;
                    processed_count.fetch_add(1, Ordering::Relaxed);
                    println!("Consumer {}: Completed task {}", consumer_id, task.id);
                }
            }
            Ok(None) => {
                // No tasks available, wait a bit
                sleep(Duration::from_millis(50)).await;
            }
            Err(e) => {
                eprintln!("Consumer {consumer_id}: Error dequeuing: {e}");
                sleep(Duration::from_millis(100)).await;
            }
        }
    }

    println!("Consumer {consumer_id}: Stopped after processing {processed} tasks");
    processed
}

/// Monitor: periodically reports queue status
async fn monitor(queue: Arc<MemoryQueue<u64>>, stop_signal: Arc<AtomicBool>) {
    while !stop_signal.load(Ordering::Relaxed) {
        let stats = queue.stats();
        println!(
            "\n[Monitor] Queue depth: {}, Enqueued: {}, Dequeued: {}, Acked: {}, In-flight: {}\n",
            stats.depth, stats.enqueued, stats.dequeued, stats.acknowledged, stats.in_flight
        );
        sleep(Duration::from_millis(500)).await;
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    println!("=== Links Queue: Producer-Consumer Pattern ===\n");

    // Create queue
    let queue = Arc::new(MemoryQueue::<u64>::new(
        "work-queue",
        QueueOptions::new()
            .with_visibility_timeout(60)
            .with_retry_limit(3),
    ));

    // Stop signal for consumers
    let stop_signal = Arc::new(AtomicBool::new(false));
    let total_processed = Arc::new(AtomicUsize::new(0));

    println!("Configuration:");
    println!("  Producers: {PRODUCER_COUNT}");
    println!("  Consumers: {CONSUMER_COUNT}");
    println!("  Tasks per producer: {TASKS_PER_PRODUCER}");
    println!("  Total tasks: {}\n", PRODUCER_COUNT * TASKS_PER_PRODUCER);

    // Start monitor
    let monitor_queue = Arc::clone(&queue);
    let monitor_stop = Arc::clone(&stop_signal);
    let monitor_handle = tokio::spawn(async move {
        monitor(monitor_queue, monitor_stop).await;
    });

    // Start consumers
    let mut consumer_handles = Vec::new();
    for i in 1..=CONSUMER_COUNT {
        let q = Arc::clone(&queue);
        let stop = Arc::clone(&stop_signal);
        let processed = Arc::clone(&total_processed);
        consumer_handles.push(tokio::spawn(async move {
            consumer(q, i, stop, processed).await
        }));
    }

    // Start producers
    let mut producer_handles = Vec::new();
    for i in 1..=PRODUCER_COUNT {
        let q = Arc::clone(&queue);
        producer_handles.push(tokio::spawn(async move {
            producer(q, i, TASKS_PER_PRODUCER).await
        }));
    }

    // Wait for all producers to finish
    for handle in producer_handles {
        handle.await??;
    }
    println!("\n--- All producers finished ---\n");

    // Wait for queue to drain
    let expected_total = (PRODUCER_COUNT * TASKS_PER_PRODUCER) as usize;
    while total_processed.load(Ordering::Relaxed) < expected_total {
        sleep(Duration::from_millis(100)).await;
    }

    // Stop consumers and monitor
    stop_signal.store(true, Ordering::Relaxed);
    sleep(Duration::from_millis(100)).await; // Allow consumers to exit

    // Wait for consumer handles
    let mut consumer_results = Vec::new();
    for handle in consumer_handles {
        consumer_results.push(handle.await?);
    }

    // Wait for monitor
    let _ = monitor_handle.await;

    // Final results
    let stats = queue.stats();
    println!("\n=== Final Results ===");
    println!("Total tasks enqueued: {}", stats.enqueued);
    println!("Total tasks dequeued: {}", stats.dequeued);
    println!("Total tasks acknowledged: {}", stats.acknowledged);
    println!("Tasks processed per consumer: {consumer_results:?}");
    println!(
        "Total processed: {}",
        consumer_results.iter().map(|&x| x as usize).sum::<usize>()
    );

    println!("\n=== Producer-Consumer Complete! ===");

    Ok(())
}
