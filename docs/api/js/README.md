# JavaScript API Reference

Complete API documentation for the Links Queue JavaScript/TypeScript implementation.

## Installation

```bash
npm install links-queue-js
```

## Quick Reference

| Module                                  | Description                        |
| --------------------------------------- | ---------------------------------- |
| [Core Types](#core-types)               | Link, LinkId, LinkRef, LinkPattern |
| [Utility Functions](#utility-functions) | createLink, isLink, matchesPattern |
| [LinkStore](#linkstore-interface)       | Link storage interface             |
| [MemoryLinkStore](#memorylinkstore)     | In-memory storage implementation   |
| [Queue](#queue-interface)               | Queue operations interface         |
| [LinksQueue](#linksqueue)               | Queue implementation               |
| [MemoryQueue](#memoryqueue)             | Simple in-memory queue             |
| [QueueManager](#queuemanager-interface) | Queue lifecycle management         |
| [Server](#linksqueueserver)             | TCP server                         |
| [Client](#linksqueueclient)             | TCP client                         |

---

## Core Types

### LinkId

A link identifier. Can be a number, bigint, or string.

```typescript
type LinkId = number | bigint | string;
```

### LinkRef

A reference to a link, which can be an ID or a nested Link object.

```typescript
type LinkRef = LinkId | Link;
```

### Link

Represents a link connecting source to target.

```typescript
interface Link {
  readonly id: LinkId;
  readonly source: LinkRef;
  readonly target: LinkRef;
  readonly values?: readonly LinkRef[];
}
```

### LinkPattern

Pattern for matching links in queries.

```typescript
interface LinkPattern {
  readonly id?: LinkId | typeof Any;
  readonly source?: LinkRef | typeof Any;
  readonly target?: LinkRef | typeof Any;
}
```

### Any

Special symbol for wildcard matching in patterns.

```typescript
import { Any } from "links-queue-js";

// Match any source, specific target
const pattern = { source: Any, target: 30 };
```

---

## Utility Functions

### createLink

Creates a frozen Link object.

```typescript
function createLink(
  id: LinkId,
  source: LinkRef,
  target: LinkRef,
  values?: LinkRef[],
): Link;
```

**Example:**

```javascript
import { createLink } from "links-queue-js";

const link = createLink(1, "task", "process-data");
// { id: 1, source: 'task', target: 'process-data' }

const universalLink = createLink(2, "relation", "type", ["a", "b", "c"]);
// { id: 2, source: 'relation', target: 'type', values: ['a', 'b', 'c'] }
```

### isLink

Checks if a value is a Link object.

```typescript
function isLink(value: unknown): value is Link;
```

### isLinkId

Checks if a value is a valid LinkId.

```typescript
function isLinkId(value: unknown): value is LinkId;
```

### isLinkRef

Checks if a value is a valid LinkRef.

```typescript
function isLinkRef(value: unknown): value is LinkRef;
```

### getLinkId

Extracts the LinkId from a LinkRef.

```typescript
function getLinkId(ref: LinkRef): LinkId;
```

### matchesPattern

Checks if a link matches a pattern.

```typescript
function matchesPattern(link: Link, pattern: LinkPattern): boolean;
```

**Example:**

```javascript
import { createLink, matchesPattern, Any } from "links-queue-js";

const link = createLink(1, 10, 20);

matchesPattern(link, { source: 10 }); // true
matchesPattern(link, { source: 99 }); // false
matchesPattern(link, { source: Any }); // true
matchesPattern(link, { source: 10, target: 20 }); // true
```

---

## LinkStore Interface

Interface for link storage operations.

```typescript
interface LinkStore {
  create(source: LinkRef, target: LinkRef): Promise<Link>;
  createWithValues(
    source: LinkRef,
    target: LinkRef,
    values: readonly LinkRef[],
  ): Promise<Link>;
  get(id: LinkId): Promise<Link | null>;
  exists(id: LinkId): Promise<boolean>;
  find(pattern: LinkPattern): Promise<Link[]>;
  count(pattern?: LinkPattern): Promise<number>;
  update(id: LinkId, source: LinkRef, target: LinkRef): Promise<Link>;
  delete(id: LinkId): Promise<boolean>;
  deleteMatching(pattern: LinkPattern): Promise<number>;
  iterate(pattern?: LinkPattern): AsyncIterable<Link>;
}
```

---

## MemoryLinkStore

In-memory implementation of LinkStore with automatic deduplication.

```typescript
class MemoryLinkStore implements LinkStore
```

**Constructor:**

```javascript
const store = new MemoryLinkStore();
```

**Methods:**

| Method                                     | Description                  | Returns                 |
| ------------------------------------------ | ---------------------------- | ----------------------- |
| `create(source, target)`                   | Create a link (deduplicates) | `Promise<Link>`         |
| `createWithValues(source, target, values)` | Create universal link        | `Promise<Link>`         |
| `get(id)`                                  | Get link by ID               | `Promise<Link \| null>` |
| `exists(id)`                               | Check if link exists         | `Promise<boolean>`      |
| `find(pattern)`                            | Find matching links          | `Promise<Link[]>`       |
| `count(pattern?)`                          | Count links                  | `Promise<number>`       |
| `update(id, source, target)`               | Update a link                | `Promise<Link>`         |
| `delete(id)`                               | Delete a link                | `Promise<boolean>`      |
| `deleteMatching(pattern)`                  | Delete matching links        | `Promise<number>`       |
| `iterate(pattern?)`                        | Iterate over links           | `AsyncIterable<Link>`   |
| `clear()`                                  | Remove all links             | `Promise<void>`         |

**Example:**

```javascript
import { MemoryLinkStore, Any } from "links-queue-js";

const store = new MemoryLinkStore();

// Create links
const link1 = await store.create("user", "john");
const link2 = await store.create("user", "jane");

// Deduplication - returns existing link
const duplicate = await store.create("user", "john");
console.log(duplicate.id === link1.id); // true

// Find by pattern
const users = await store.find({ source: "user", target: Any });
console.log(users.length); // 2

// Iterate
for await (const link of store.iterate()) {
  console.log(link);
}
```

---

## Queue Interface

Interface for queue operations.

```typescript
interface Queue {
  readonly name: string;

  enqueue(link: Link): Promise<EnqueueResult>;
  dequeue(): Promise<Link | null>;
  peek(): Promise<Link | null>;
  acknowledge(id: LinkId): Promise<void>;
  reject(id: LinkId, requeue?: boolean): Promise<void>;
  getStats(): QueueStats;
  getDepth(): number;
}
```

### EnqueueResult

```typescript
interface EnqueueResult {
  readonly id: LinkId; // Unique identifier for this queue item
  readonly position: number; // Position in queue (0 = next to dequeue)
}
```

### QueueStats

```typescript
interface QueueStats {
  readonly depth: number; // Items waiting
  readonly enqueued: number; // Total enqueued
  readonly dequeued: number; // Total dequeued
  readonly acknowledged: number; // Total acknowledged
  readonly rejected: number; // Total rejected
  readonly inFlight: number; // Currently processing
}
```

### QueueOptions

```typescript
interface QueueOptions {
  readonly maxSize?: number; // Max queue depth (default: unlimited)
  readonly visibilityTimeout?: number; // Seconds before requeue (default: 30)
  readonly retryLimit?: number; // Max delivery attempts (default: 3)
  readonly deadLetterQueue?: string; // DLQ name for failed items
  readonly priority?: boolean; // Enable priority ordering (default: false)
}
```

---

## LinksQueue

Full-featured queue implementation using LinkStore for storage.

```typescript
class LinksQueue implements Queue
```

**Constructor:**

```typescript
interface LinksQueueConfig {
  name: string;
  store: MemoryLinkStore;
  options?: QueueOptions;
  onDeadLetter?: (link: Link) => Promise<void>;
}

const queue = new LinksQueue(config);
```

**Example:**

```javascript
import { LinksQueue, MemoryLinkStore, createLink } from "links-queue-js";

const store = new MemoryLinkStore();
const queue = new LinksQueue({
  name: "tasks",
  store,
  options: {
    visibilityTimeout: 30,
    retryLimit: 3,
    deadLetterQueue: "tasks-dlq",
  },
});

// Enqueue
const link = createLink(1, "job", "process-data");
const result = await queue.enqueue(link);
console.log(`Position: ${result.position}`);

// Dequeue and process
const item = await queue.dequeue();
if (item) {
  try {
    await processItem(item);
    await queue.acknowledge(item.id);
  } catch (error) {
    await queue.reject(item.id, true); // requeue
  }
}

// Statistics
const stats = queue.getStats();
console.log(`Depth: ${stats.depth}, In-flight: ${stats.inFlight}`);
```

---

## MemoryQueue

Lightweight in-memory queue without LinkStore dependency.

```typescript
class MemoryQueue implements Queue
```

**Constructor:**

```javascript
const queue = new MemoryQueue(name, options?);
```

**Example:**

```javascript
import { MemoryQueue, createLink } from "links-queue-js";

const queue = new MemoryQueue("tasks");

await queue.enqueue(createLink(1, "task", "a"));
await queue.enqueue(createLink(2, "task", "b"));

const item = await queue.dequeue();
await queue.acknowledge(item.id);
```

---

## QueueManager Interface

Interface for managing multiple queues.

```typescript
interface QueueManager {
  createQueue(name: string, options?: QueueOptions): Promise<Queue>;
  deleteQueue(name: string): Promise<boolean>;
  getQueue(name: string): Promise<Queue | null>;
  listQueues(): Promise<QueueInfo[]>;
}
```

### QueueInfo

```typescript
interface QueueInfo {
  readonly name: string;
  readonly depth: number;
  readonly createdAt: number;
  readonly options: QueueOptions;
}
```

---

## MemoryQueueManager

In-memory queue manager.

```typescript
class MemoryQueueManager implements QueueManager
```

**Example:**

```javascript
import { MemoryQueueManager, MemoryLinkStore } from "links-queue-js";

const store = new MemoryLinkStore();
const manager = new MemoryQueueManager({ store });

// Create queues
const tasksQueue = await manager.createQueue("tasks");
const eventsQueue = await manager.createQueue("events", {
  maxSize: 10000,
});

// List queues
const queues = await manager.listQueues();
for (const info of queues) {
  console.log(`${info.name}: ${info.depth} items`);
}

// Get existing queue
const queue = await manager.getQueue("tasks");

// Delete queue
await manager.deleteQueue("events");
```

---

## LinksQueueServer

TCP server for remote queue access.

```typescript
import { LinksQueueServer } from "links-queue-js/server";
```

**Constructor Options:**

| Option           | Type     | Default     | Description            |
| ---------------- | -------- | ----------- | ---------------------- |
| `host`           | `string` | `'0.0.0.0'` | Bind address           |
| `port`           | `number` | `5000`      | Listen port            |
| `maxConnections` | `number` | `1000`      | Max concurrent clients |
| `timeout`        | `number` | `30000`     | Request timeout (ms)   |

**Methods:**

| Method           | Description                 | Returns         |
| ---------------- | --------------------------- | --------------- |
| `start()`        | Start the server            | `Promise<void>` |
| `stop()`         | Stop the server             | `Promise<void>` |
| `drain(timeout)` | Wait for in-flight requests | `Promise<void>` |

**Example:**

```javascript
import { LinksQueueServer } from "links-queue-js/server";

const server = new LinksQueueServer({
  port: 5000,
  host: "0.0.0.0",
});

await server.start();
console.log("Server listening on port 5000");

// Graceful shutdown
process.on("SIGTERM", async () => {
  await server.stop();
});
```

---

## LinksQueueClient

TCP client for connecting to Links Queue servers.

```typescript
import { LinksQueueClient } from "links-queue-js/client";
```

**Constructor:**

```javascript
const client = new LinksQueueClient(address, options?);
```

**Options:**

| Option       | Type      | Default | Description                  |
| ------------ | --------- | ------- | ---------------------------- |
| `reconnect`  | `boolean` | `true`  | Auto-reconnect on disconnect |
| `maxRetries` | `number`  | `3`     | Max reconnection attempts    |
| `timeout`    | `number`  | `5000`  | Connection timeout (ms)      |

**Methods:**

| Method                        | Description            | Returns                  |
| ----------------------------- | ---------------------- | ------------------------ |
| `connect()`                   | Connect to server      | `Promise<void>`          |
| `disconnect()`                | Disconnect from server | `Promise<void>`          |
| `ping()`                      | Health check           | `Promise<void>`          |
| `createQueue(name, options?)` | Create a queue         | `Promise<void>`          |
| `deleteQueue(name)`           | Delete a queue         | `Promise<boolean>`       |
| `listQueues()`                | List all queues        | `Promise<QueueInfo[]>`   |
| `getQueue(name)`              | Get queue info         | `Promise<QueueInfo>`     |
| `enqueue(queue, link)`        | Add item to queue      | `Promise<EnqueueResult>` |
| `dequeue(queue)`              | Get next item          | `Promise<Link \| null>`  |
| `peek(queue)`                 | View next item         | `Promise<Link \| null>`  |
| `acknowledge(queue, id)`      | Confirm processing     | `Promise<void>`          |
| `reject(queue, id, options?)` | Reject item            | `Promise<void>`          |
| `getStats(queue)`             | Get queue statistics   | `Promise<QueueStats>`    |

**Example:**

```javascript
import { LinksQueueClient } from "links-queue-js/client";
import { createLink } from "links-queue-js";

const client = new LinksQueueClient("localhost:5000");
await client.connect();

// Create queue
await client.createQueue("tasks");

// Enqueue
const result = await client.enqueue("tasks", createLink(0, "job", "data"));

// Dequeue
const item = await client.dequeue("tasks");
if (item) {
  await client.acknowledge("tasks", item.id);
}

// Statistics
const stats = await client.getStats("tasks");
console.log(`Queue depth: ${stats.depth}`);

await client.disconnect();
```

---

## Error Handling

### QueueError

Error thrown by queue operations.

```typescript
class QueueError extends Error {
  readonly code: QueueErrorCode;
}

type QueueErrorCode =
  | "QUEUE_FULL"
  | "QUEUE_NOT_FOUND"
  | "QUEUE_ALREADY_EXISTS"
  | "ITEM_NOT_FOUND"
  | "ITEM_NOT_IN_FLIGHT"
  | "INVALID_OPERATION";
```

**Example:**

```javascript
import { QueueError } from "links-queue-js";

try {
  await queue.enqueue(link);
} catch (error) {
  if (error instanceof QueueError) {
    switch (error.code) {
      case "QUEUE_FULL":
        console.log("Queue is at capacity");
        break;
      case "QUEUE_NOT_FOUND":
        console.log("Queue does not exist");
        break;
    }
  }
}
```

---

## Links Notation

Parser and serializer for the Links Notation protocol.

```typescript
import {
  LinksNotation,
  NotationParser,
  NotationStreamParser,
} from "links-queue-js";
```

### LinksNotation

```typescript
class LinksNotation {
  static parse(input: string, options?: ParseOptions): Link[];
  static stringify(links: Link[], options?: StringifyOptions): string;
}
```

**Example:**

```javascript
import { LinksNotation } from "links-queue-js";

// Parse Links Notation
const links = LinksNotation.parse("((1 2) (3 4))");
console.log(links); // [{ id: 0, source: 1, target: 2 }, ...]

// Stringify to Links Notation
const notation = LinksNotation.stringify([
  { id: 1, source: "hello", target: "world" },
]);
console.log(notation); // ((hello: world))
```

---

## Protocol Messages

Utilities for creating protocol messages.

```typescript
import {
  createEnqueueRequest,
  createDequeueRequest,
  createAckRequest,
  createOkResponse,
  createErrorResponse,
  RequestType,
  ResponseStatus,
  ErrorCode,
} from "links-queue-js";
```

---

## Exports Summary

### Main Module (`links-queue-js`)

```javascript
// Core
export {
  Any,
  createLink,
  isLink,
  isLinkId,
  isLinkRef,
  getLinkId,
  matchesPattern,
};

// Backends
export { MemoryLinkStore, BackendRegistry, LinkCliBackend, LinkCliProcess };

// Queue
export { LinksQueue, MemoryQueue, MemoryQueueWithStorage, QueueError };
export { DeliveryState, DeliveryTracker, PollableDeliveryTracker };
export { MemoryQueueManager, LinksQueueManager };

// Protocol
export { LinksNotation, NotationParser, NotationStreamParser };
export { Message, MessageBuilder, RequestType, ResponseStatus, ErrorCode };
```

### Server Module (`links-queue-js/server`)

```javascript
export { LinksQueueServer, ServerConnection, RequestRouter };
```

### Client Module (`links-queue-js/client`)

```javascript
export { LinksQueueClient, ClientConnection };
```

---

## See Also

- [Getting Started Guide](../../guides/getting-started.md)
- [Core Concepts](../../guides/core-concepts.md)
- [TypeScript Definitions](../../../js/src/index.d.ts)
