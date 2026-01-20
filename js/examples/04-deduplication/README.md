# Deduplication Example

This example demonstrates automatic link deduplication - one of the unique features of Links Queue. When you create links with identical source and target, the system automatically returns the existing link instead of creating duplicates.

## Key Concepts

- **Automatic Deduplication**: Links with identical source and target share the same ID
- **Content-Addressed Storage**: Link identity is based on content, not creation order
- **Type-Aware**: Different types (number, string, bigint) are tracked separately
- **Universal Links Exception**: Links with values are not deduplicated

## Running the Example

```bash
# Node.js
node examples/04-deduplication/index.js

# Bun
bun examples/04-deduplication/index.js

# Deno
deno run examples/04-deduplication/index.js
```

## Expected Output

```
=== Links Queue: Deduplication ===

--- Part 1: Basic Deduplication ---

Created link 1: { id: 1, source: 'hello', target: 'world' }
  ID: 1

Created link 2 (same source/target): { id: 1, source: 'hello', target: 'world' }
  ID: 1

Are they the same link? true
Total links in store: 1

Created link 3 (different target): { id: 2, source: 'hello', target: 'universe' }
  ID: 2
Total links after link3: 2

--- Part 2: Deduplication with Different Types ---

Number links deduplicated: true
String links deduplicated: true
BigInt links deduplicated: true
Number vs String (different): true
Total unique links: 5

--- Part 3: Nested Link Deduplication ---

Inner links are same: true
Outer links with same nested source are same: true
Total links (1 inner + 1 outer): 2

--- Part 4: Universal Links (No Deduplication) ---

Universal link 1: { id: 1, source: 'subject', target: 'predicate', values: ['object1'] }
Universal link 2: { id: 2, source: 'subject', target: 'predicate', values: ['object1'] }
Same ID? false
Total universal links: 2

--- Part 5: Practical Use Case - Event Deduplication ---

Processing events with deduplication:
  ENQUEUED: user_login - user123 (id: 1)
  SKIPPED (duplicate): user_login - user123
  ENQUEUED: user_logout - user123 (id: 2)
  ENQUEUED: user_login - user456 (id: 3)
  SKIPPED (duplicate): user_login - user123

Queue stats:
  Events in queue: 3
  Unique events: 3
  Duplicates filtered: 2

--- Part 6: Pattern-Based Duplicate Check ---

Existing API calls: 3
API call to /users already tracked (id: 1)

=== Deduplication Complete! ===
```

## What This Example Shows

1. **Basic Deduplication**: Same source+target = same link ID
2. **Type Awareness**: Number 1 vs String "1" are different values
3. **Nested Deduplication**: Deduplication works with nested links
4. **Universal Links**: Links with values are NOT deduplicated (by design)
5. **Event Deduplication**: Practical pattern for filtering duplicate events
6. **Existence Checking**: Using patterns to check before creating

## Benefits of Deduplication

### Memory Efficiency

- No duplicate data stored
- Constant-time lookup for existing links
- Natural data normalization

### Idempotent Operations

- Creating the same link twice is safe
- No need for external deduplication logic
- Simplifies retry logic

### Graph Consistency

- Edge relationships are unique
- Natural prevention of duplicate relationships
- Consistent graph structure

## Use Cases

- **Event Processing**: Automatically filter duplicate events
- **API Idempotency**: Ensure operations are safe to retry
- **Graph Building**: Prevent duplicate edges in a graph
- **Caching**: Content-addressed caching of relationships
- **Data Normalization**: Automatic structural sharing
