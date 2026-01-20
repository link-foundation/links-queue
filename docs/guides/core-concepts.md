# Core Concepts

This guide explains the fundamental concepts behind Links Queue.

## What Are Links?

A **link** is the most fundamental unit of information in Links Queue. Unlike traditional message queues that work with arbitrary bytes, JSON blobs, or structured events, Links Queue works with links.

A link is an ordered pair connecting a **source** to a **target**:

```
(source, target)
```

In code, a link has three required properties:

```javascript
{
  id: 1,        // Unique identifier
  source: 2,    // Source reference
  target: 3     // Target reference
}
```

## Link Data Model

### Basic Links

The simplest link connects two IDs:

```javascript
import { createLink } from "links-queue-js";

// A link from ID 2 to ID 3
const link = createLink(1, 2, 3);
// { id: 1, source: 2, target: 3 }
```

### Nested Links

Links can reference other links, creating recursive structures:

```javascript
// Create base links
const personType = createLink(10, 0, 0); // Type definition
const nameProperty = createLink(11, 0, 0); // Property definition

// Create a nested link
const person = createLink(1, personType, nameProperty);
// { id: 1, source: { id: 10, ... }, target: { id: 11, ... } }
```

### Universal Links

For n-ary relationships, links can include additional values:

```javascript
// A relationship with multiple targets
const relation = createLink(
  100, // id
  1, // source (subject)
  2, // target (predicate)
  [3, 4, 5], // values (objects)
);
```

### Link ID Types

Link IDs can be:

- **Numbers**: `1`, `42`, `1000000`
- **BigInts**: `9007199254740993n` (for IDs beyond JavaScript's safe integer limit)
- **Strings**: `"uuid-123"`, `"user-456"` (for UUID-based systems)

```javascript
import { isLinkId } from "links-queue-js";

isLinkId(42); // true
isLinkId(1n); // true
isLinkId("uuid-123"); // true
isLinkId({}); // false
```

## Queue Semantics

### Queue Structure

A queue in Links Queue is a named collection of links waiting to be processed:

```
Queue: "tasks"
├── Link 1: (job, process-data)
├── Link 2: (job, send-email)
└── Link 3: (job, generate-report)
```

### Queue Operations

| Operation     | Description                            |
| ------------- | -------------------------------------- |
| `enqueue`     | Add a link to the end of the queue     |
| `dequeue`     | Remove and return the next link        |
| `peek`        | View the next link without removing it |
| `acknowledge` | Confirm successful processing          |
| `reject`      | Mark processing as failed              |

### Queue Ordering

By default, queues use **FIFO** (First-In-First-Out) ordering:

```javascript
await queue.enqueue(createLink(1, "first", "task"));
await queue.enqueue(createLink(2, "second", "task"));

const item = await queue.dequeue();
// Returns link 1 (first enqueued)
```

Priority queues can be configured for different ordering:

```javascript
const queue = await manager.createQueue("priority-tasks", {
  priority: true,
});
```

## Delivery Guarantees

### At-Least-Once Delivery

Links Queue guarantees that each link will be delivered **at least once**. This means:

1. Every enqueued link will be processed
2. If processing fails, the link will be redelivered
3. In rare cases (crashes, network issues), a link may be delivered more than once

**Important**: Design your consumers to be idempotent (safe to process the same link multiple times).

### Visibility Timeout

When a link is dequeued, it becomes "invisible" to other consumers for a configurable timeout:

```javascript
const queue = new MemoryQueue("tasks", {
  visibilityTimeout: 30000, // 30 seconds
});
```

If the consumer doesn't acknowledge within the timeout, the link becomes visible again for redelivery.

### Acknowledgment

After successfully processing a link, acknowledge it to remove it from the queue:

```javascript
const item = await queue.dequeue();
if (item) {
  try {
    await processLink(item);
    await queue.acknowledge(item.id);
  } catch (error) {
    await queue.reject(item.id, { requeue: true });
  }
}
```

### Dead Letter Queue

Links that fail processing too many times are moved to a dead letter queue:

```javascript
const queue = await manager.createQueue("tasks", {
  deadLetterQueue: "tasks-dlq",
  maxRetries: 3,
});
```

## Pattern Matching

Links Queue supports pattern-based queries to find links:

```javascript
import { Any, matchesPattern } from "links-queue-js";

const links = [
  createLink(1, 10, 20),
  createLink(2, 10, 30),
  createLink(3, 20, 30),
];

// Find links with source = 10
const pattern1 = { source: 10 };
links.filter((l) => matchesPattern(l, pattern1));
// Returns links 1 and 2

// Find links with any source, target = 30
const pattern2 = { source: Any, target: 30 };
links.filter((l) => matchesPattern(l, pattern2));
// Returns links 2 and 3
```

## Links Notation

Links Queue uses **Links Notation** for data exchange, a text-based format that's human-readable and version-control friendly:

```
((source target) (another_source another_target))
```

### Example Messages

Queue item in Links Notation:

```
((queue: "tasks"),
 ((id: "abc123"),
  ((payload: ((action: "process"), (data: "..."))),
   (metadata: ((priority: 1), (timestamp: 1234567890))))))
```

### Protocol Messages

Request to enqueue:

```
((type: "enqueue"),
 ((queue: "tasks"),
  ((payload: ((action: "process"), (data: "..."))))))
```

Response:

```
((status: "ok"),
 ((result: ((id: "abc123"), (position: 42)))))
```

## Link Store

The `LinkStore` interface provides persistence for links:

```javascript
import { MemoryLinkStore } from "links-queue-js";

const store = new MemoryLinkStore();

// Create a link
const link = await store.create(2, 3);
// { id: 1, source: 2, target: 3 }

// Read a link
const fetched = await store.get(1);

// Find links by pattern
const matches = await store.find({ source: 2 });

// Delete a link
await store.delete(1);
```

## Queue vs Link Store

| Concept        | Purpose                   | Ordering      | Persistence |
| -------------- | ------------------------- | ------------- | ----------- |
| **Queue**      | Processing items in order | FIFO/Priority | Optional    |
| **Link Store** | Persistent storage        | None          | Yes         |

Use queues for work distribution and event processing. Use link stores for data persistence and graph operations.

## Next Steps

- [Operating Modes](operating-modes.md) - Configure single vs multi-node operation
- [Storage Backends](storage-backends.md) - Choose memory or persistent storage
- [Server Mode](server-mode.md) - Run as a network service
