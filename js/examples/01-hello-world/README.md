# Hello World Example

This example demonstrates the most basic usage of Links Queue: simple enqueue and dequeue operations.

## Key Concepts

- **Link**: The fundamental data unit with `id`, `source`, and `target` fields
- **LinksQueue**: A FIFO queue that holds links for processing
- **Enqueue/Dequeue**: Standard queue operations to add and remove items
- **Acknowledge**: Confirm that a dequeued item was processed successfully

## Running the Example

```bash
# Node.js
node examples/01-hello-world/index.js

# Bun
bun examples/01-hello-world/index.js

# Deno
deno run examples/01-hello-world/index.js
```

## Expected Output

```
=== Links Queue: Hello World ===

Created links:
  Greeting: { id: 1, source: 'hello', target: 'world' }
  Message: { id: 2, source: 'links', target: 'queue' }
  Data: { id: 3, source: 42, target: 100 }

--- Enqueuing links ---
Enqueued link 1 at position 0
Enqueued link 2 at position 1
Enqueued link 3 at position 2

Queue stats after enqueueing:
  Depth: 3
  Enqueued: 3

--- Dequeuing and processing ---
Processing: hello -> world
Acknowledged link 1
Processing: links -> queue
Acknowledged link 2
Processing: 42 -> 100
Acknowledged link 3

Final queue stats:
  Depth: 0
  Enqueued: 3
  Dequeued: 3
  Acknowledged: 3

Dequeue from empty queue: null

=== Hello World Complete! ===
```

## What This Example Shows

1. **Creating Links**: Links can have various types for source and target (strings, numbers)
2. **Queue Setup**: How to create a `LinksQueue` with a `MemoryLinkStore` backend
3. **FIFO Processing**: Items are processed in the order they were enqueued
4. **Acknowledgment Pattern**: The dequeue-process-acknowledge workflow for reliable processing
