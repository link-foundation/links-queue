//! Hello World Example for links-queue
//!
//! This example demonstrates basic enqueue/dequeue operations using
//! the links-queue library. It shows how to:
//! - Create a queue
//! - Enqueue links (messages)
//! - Dequeue links
//! - Acknowledge processed items
//!
//! Run with: `cargo run --example 01-hello-world`

use links_queue::{Link, LinkRef, MemoryQueue, Queue, QueueOptions};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Links Queue: Hello World ===\n");

    // Create a queue with basic configuration
    let queue = MemoryQueue::<u64>::new(
        "hello-world",
        QueueOptions::new()
            .with_visibility_timeout(30)
            .with_retry_limit(3),
    );

    // Create some links to enqueue
    // Links are the fundamental data unit - they have id, source, and target
    let greeting_link = Link::new(1, LinkRef::Id(100), LinkRef::Id(200)); // "hello" -> "world" as IDs
    let message_link = Link::new(2, LinkRef::Id(300), LinkRef::Id(400)); // "links" -> "queue"
    let data_link = Link::new(3, LinkRef::Id(42), LinkRef::Id(100)); // numeric data

    println!("Created links:");
    println!("  Greeting: {greeting_link:?}");
    println!("  Message: {message_link:?}");
    println!("  Data: {data_link:?}");

    // Enqueue links
    println!("\n--- Enqueuing links ---");
    let result1 = queue.enqueue(greeting_link.clone()).await?;
    println!("Enqueued link 1 at position {}", result1.position);

    let result2 = queue.enqueue(message_link.clone()).await?;
    println!("Enqueued link 2 at position {}", result2.position);

    let result3 = queue.enqueue(data_link.clone()).await?;
    println!("Enqueued link 3 at position {}", result3.position);

    // Check queue stats
    let stats = queue.stats();
    println!("\nQueue stats after enqueueing:");
    println!("  Depth: {}", stats.depth);
    println!("  Enqueued: {}", stats.enqueued);

    // Dequeue and process links
    println!("\n--- Dequeuing and processing ---");

    // Dequeue first link
    if let Some(item) = queue.dequeue().await? {
        println!("Processing: {} -> {}", item.source_id(), item.target_id());
        // Acknowledge successful processing
        queue.acknowledge(item.id).await?;
        println!("Acknowledged link {}", item.id);
    }

    // Dequeue second link
    if let Some(item) = queue.dequeue().await? {
        println!("Processing: {} -> {}", item.source_id(), item.target_id());
        queue.acknowledge(item.id).await?;
        println!("Acknowledged link {}", item.id);
    }

    // Dequeue third link
    if let Some(item) = queue.dequeue().await? {
        println!("Processing: {} -> {}", item.source_id(), item.target_id());
        queue.acknowledge(item.id).await?;
        println!("Acknowledged link {}", item.id);
    }

    // Final stats
    let final_stats = queue.stats();
    println!("\nFinal queue stats:");
    println!("  Depth: {}", final_stats.depth);
    println!("  Enqueued: {}", final_stats.enqueued);
    println!("  Dequeued: {}", final_stats.dequeued);
    println!("  Acknowledged: {}", final_stats.acknowledged);

    // Try to dequeue from empty queue
    let empty = queue.dequeue().await?;
    println!(
        "\nDequeue from empty queue: {}",
        if empty.is_none() { "None" } else { "Some" }
    );

    println!("\n=== Hello World Complete! ===");

    Ok(())
}
