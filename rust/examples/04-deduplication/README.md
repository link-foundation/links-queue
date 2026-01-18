# Deduplication Example (Rust)

This example demonstrates automatic link deduplication - one of the unique features of Links Queue. When you create links with identical source and target, the system automatically returns the existing link instead of creating duplicates.

## Key Concepts

- **Automatic Deduplication**: Links with identical source and target share the same ID
- **Content-Addressed Storage**: Link identity is based on content, not creation order
- **Type-Generic**: Works with any numeric type implementing `LinkType` (u32, u64, usize, etc.)
- **Universal Links**: Deduplication also considers values array for universal links

## Running the Example

```bash
cargo run --example 04-deduplication
```

## Expected Output

```
=== Links Queue: Deduplication ===

--- Part 1: Basic Deduplication ---

Created link 1: Link { id: 1, source: Id(100), target: Id(200), values: None }
  ID: 1

Created link 2 (same source/target): Link { id: 1, source: Id(100), target: Id(200), values: None }
  ID: 1

Are they the same link? true
Total links in store: 1

Created link 3 (different target): Link { id: 2, source: Id(100), target: Id(300), values: None }
  ID: 2
Total links after link3: 2

--- Part 2: Deduplication with Different ID Types ---

u32 links deduplicated: true
u64 links deduplicated: true
usize links deduplicated: true
Total unique links in each store: u32=1, u64=1, usize=1

--- Part 3: Nested Link Deduplication ---

Inner links are same: true
Outer links with same nested source are same: true
Total links (1 inner + 1 outer): 2

--- Part 4: Universal Links (Deduplication Includes Values) ---

Universal link 1: Link { id: 1, source: Id(100), target: Id(200), values: Some([Id(300), Id(400)]) }
Universal link 2: Link { id: 1, source: Id(100), target: Id(200), values: Some([Id(300), Id(400)]) }
Same ID (deduplication includes values): true

Universal link 3 (different values): Link { id: 2, source: Id(100), target: Id(200), values: Some([Id(300), Id(500)]) }
Different from link 1: true
Total universal links: 2

--- Part 5: Practical Use Case - Event Deduplication ---

Processing events with deduplication:
  ENQUEUED: LOGIN - user 123 (id: 1)
  SKIPPED (duplicate): LOGIN - user 123
  ENQUEUED: LOGOUT - user 123 (id: 2)
  ENQUEUED: LOGIN - user 456 (id: 3)
  SKIPPED (duplicate): LOGIN - user 123

Queue stats:
  Events in queue: 3
  Unique events: 3
  Duplicates filtered: 2

--- Part 6: Pattern-Based Duplicate Check ---

Existing API calls: 3
API call to endpoint 100 already tracked (id: 1)

=== Deduplication Complete! ===
```

## What This Example Shows

1. **Basic Deduplication**: Same source+target = same link ID
2. **Type Flexibility**: Works with u32, u64, usize, etc.
3. **Nested Deduplication**: Deduplication works with nested links
4. **Universal Links**: Values are included in deduplication comparison
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
