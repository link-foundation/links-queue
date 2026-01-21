# Hello World Example (Rust)

This example demonstrates the most basic usage of Links Queue: simple enqueue and dequeue operations.

## Key Concepts

- **Link**: The fundamental data unit with `id`, `source`, and `target` fields
- **MemoryQueue**: An in-memory FIFO queue that holds links for processing
- **Enqueue/Dequeue**: Standard queue operations to add and remove items
- **Acknowledge**: Confirm that a dequeued item was processed successfully

## Running the Example

```bash
cargo run --example 01-hello-world
```

## Expected Output

```
=== Links Queue: Hello World ===

Created links:
  Greeting: Link { id: 1, source: Id(100), target: Id(200), values: None }
  Message: Link { id: 2, source: Id(300), target: Id(400), values: None }
  Data: Link { id: 3, source: Id(42), target: Id(100), values: None }

--- Enqueuing links ---
Enqueued link 1 at position 0
Enqueued link 2 at position 1
Enqueued link 3 at position 2

Queue stats after enqueueing:
  Depth: 3
  Enqueued: 3

--- Dequeuing and processing ---
Processing: 100 -> 200
Acknowledged link 1
Processing: 300 -> 400
Acknowledged link 2
Processing: 42 -> 100
Acknowledged link 3

Final queue stats:
  Depth: 0
  Enqueued: 3
  Dequeued: 3
  Acknowledged: 3

Dequeue from empty queue: None

=== Hello World Complete! ===
```

## What This Example Shows

1. **Creating Links**: Links use numeric IDs for source and target in Rust
2. **Queue Setup**: How to create a `MemoryQueue` with `QueueOptions`
3. **FIFO Processing**: Items are processed in the order they were enqueued
4. **Acknowledgment Pattern**: The dequeue-process-acknowledge workflow for reliable processing
