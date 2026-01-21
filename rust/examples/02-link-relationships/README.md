# Link Relationships Example (Rust)

This example demonstrates nested links and graph structures - the unique link-based data model that distinguishes Links Queue from traditional message queues.

## Key Concepts

- **Links as Relations**: Each link represents a directed relationship from source to target
- **Nested Links**: Source and target can themselves be links, enabling hierarchical data
- **Universal Links**: Links with additional values for n-ary relationships
- **Graph Structures**: Multiple links form a graph that can be traversed and queried

## Running the Example

```bash
cargo run --example 02-link-relationships
```

## Expected Output

```
=== Links Queue: Link Relationships ===

--- Part 1: Basic Links as Relations ---

Alice knows Bob: Link { id: 100, source: Id(1), target: Id(2), values: None }
Alice person link: Link { id: 101, source: Id(1000), target: Id(1), values: None }
Alice name link: Link { id: 102, source: Link(...), target: Id(1001), values: None }

--- Part 2: Nested Links (Recursive Structures) ---

Nested link (statement about relationship):
  Base: Link { id: 10, source: Id(1), target: Id(2), values: None }
  Meta: Link { id: 11, source: Link(...), target: Id(2024), values: None }
  Established relationship: 1 -> 2
  In year: 2024

--- Part 3: Universal Links (Multiple Values) ---

Universal link (n-ary relation): Link { id: 200, source: Id(10), target: Id(20), values: Some([...]) }
  Subject: 10
  Predicate: 20
  Has values: true
  Values: [30, 99, 40]

--- Part 4: Graph Structures ---

Social graph edges:
  1 -> 2
  2 -> 3
  1 -> 3
  3 -> 1

Alice (1) is connected to:
  2
  3

Charlie (3) receives connections from:
  2
  1

--- Part 5: Processing Graph Operations via Queue ---

Queued: ADD_EDGE 100->200
Queued: ADD_EDGE 200->300
Queued: QUERY node 100
Queued: REMOVE_EDGE 100->200

Processing operations:
  ADD: 100 -> 200
  ADD: 200 -> 300
  QUERY: from node 100
  REMOVE: 100 -> 200

=== Link Relationships Complete! ===
```

## What This Example Shows

1. **Binary Relations**: Simple A -> B relationships (social connections, edges)
2. **Typed Links**: Using numeric IDs to represent types and properties
3. **Meta-Links**: Links about other links (provenance, timestamps)
4. **N-ary Relations**: Universal links with values for complex relations
5. **Graph Building**: Constructing and querying graph structures
6. **Queue Integration**: Processing graph operations through a queue

## Use Cases

- Knowledge graphs and semantic data
- Social network relationships
- Provenance tracking (who said what, when)
- Complex event processing with metadata
- Graph database operations via message queue
