# Producer-Consumer Example (Rust)

This example demonstrates the classic producer-consumer pattern using Links Queue as a work queue. Multiple producers generate tasks, and multiple consumers process them concurrently using Tokio async runtime.

## Key Concepts

- **Work Queue**: A shared queue where producers enqueue work items for consumers
- **Competing Consumers**: Multiple consumers process items from the same queue
- **Acknowledgment**: Consumers confirm successful processing before items are removed
- **Load Balancing**: Work is naturally distributed among available consumers
- **Async Concurrency**: Uses Tokio for efficient concurrent processing

## Running the Example

```bash
cargo run --example 03-producer-consumer
```

## Expected Output

```
=== Links Queue: Producer-Consumer Pattern ===

Configuration:
  Producers: 2
  Consumers: 3
  Tasks per producer: 5
  Total tasks: 10

Producer 1: Starting, will create 5 tasks
Consumer 1: Starting
Consumer 2: Starting
Consumer 3: Starting
Producer 2: Starting, will create 5 tasks
Producer 1: Enqueued task 1000 at position 0
Consumer 1: Processing task 1000 (type: 1)
Producer 2: Enqueued task 2000 at position 0
Consumer 2: Processing task 2000 (type: 1)
...

[Monitor] Queue depth: 3, Enqueued: 8, Dequeued: 5, Acked: 3, In-flight: 2

...

--- All producers finished ---

...

=== Final Results ===
Total tasks enqueued: 10
Total tasks dequeued: 10
Total tasks acknowledged: 10
Tasks processed per consumer: [4, 3, 3]
Total processed: 10

=== Producer-Consumer Complete! ===
```

## What This Example Shows

1. **Multiple Producers**: Two producers creating tasks concurrently
2. **Multiple Consumers**: Three consumers processing tasks in parallel
3. **Fair Distribution**: Work is distributed among available consumers
4. **Monitoring**: Real-time queue statistics during processing
5. **Graceful Shutdown**: Waiting for queue to drain before stopping

## Pattern Details

### Task Structure

Tasks are represented as links:
- `id`: Unique task identifier
- `source`: Task type/category (1, 2, or 3)
- `target`: Task payload data

### Processing Flow

1. **Producer** creates a task link and enqueues it
2. **Consumer** dequeues a task (task becomes "in-flight")
3. Consumer processes the task (simulated work)
4. Consumer acknowledges the task (removes from in-flight tracking)
5. If acknowledgment fails, task can be requeued after visibility timeout

### Concurrency Model

- Uses `Arc<MemoryQueue>` for shared ownership across tasks
- `AtomicBool` for stop signal coordination
- `AtomicUsize` for thread-safe processed count
- Tokio tasks for async execution of producers and consumers

## Use Cases

- Background job processing
- Task distribution across workers
- Request buffering and load leveling
- Microservice communication
- Event processing pipelines
