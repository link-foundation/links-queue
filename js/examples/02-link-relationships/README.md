# Link Relationships Example

This example demonstrates nested links and graph structures - the unique link-based data model that distinguishes Links Queue from traditional message queues.

## Key Concepts

- **Links as Relations**: Each link represents a directed relationship from source to target
- **Nested Links**: Source and target can themselves be links, enabling hierarchical data
- **Universal Links**: Links with additional values for n-ary relationships
- **Graph Structures**: Multiple links form a graph that can be traversed and queried

## Running the Example

```bash
# Node.js
node examples/02-link-relationships/index.js

# Bun
bun examples/02-link-relationships/index.js

# Deno
deno run examples/02-link-relationships/index.js
```

## Expected Output

```
=== Links Queue: Link Relationships ===

--- Part 1: Basic Links as Relations ---

Alice knows Bob: { id: 1, source: 'alice', target: 'bob' }
Alice person link: { id: 2, source: 100, target: 'alice' }
Alice name link: { id: 3, source: { id: 2, source: 100, target: 'alice' }, target: 'Alice Smith' }

--- Part 2: Nested Links (Recursive Structures) ---

Nested link (statement about relationship):
  Base: { id: 10, source: 'alice', target: 'bob' }
  Meta: { id: 11, source: { id: 10, source: 'alice', target: 'bob' }, target: 2024 }
  Established relationship: alice -> bob
  In year: 2024

--- Part 3: Universal Links (Multiple Values) ---

Universal link (n-ary relation): { id: 20, source: 'Earth', target: 'orbits', values: [ 'Sun', 0.999, 'astronomy' ] }
  Subject: Earth
  Predicate: orbits
  Additional values: [ 'Sun', 0.999, 'astronomy' ]

--- Part 4: Graph Structures ---

Social graph edges:
  alice -> bob
  bob -> charlie
  alice -> charlie
  charlie -> alice

Alice is connected to:
  bob
  charlie

Charlie receives connections from:
  bob
  alice

--- Part 5: Processing Graph Operations via Queue ---

Queued: add_edge node1->node2
Queued: add_edge node2->node3
Queued: query {"source":"node1","target":{}}
Queued: remove_edge node1->node2

Processing operations:
  ADD: node1 -> node2
  ADD: node2 -> node3
  QUERY: source=node1
  REMOVE: node1 -> node2

=== Link Relationships Complete! ===
```

## What This Example Shows

1. **Binary Relations**: Simple A -> B relationships (social connections, edges)
2. **Typed Links**: Using numeric IDs to represent types and properties
3. **Meta-Links**: Links about other links (provenance, timestamps)
4. **N-ary Relations**: Universal links with values array for complex relations
5. **Graph Building**: Constructing and querying graph structures
6. **Queue Integration**: Processing graph operations through a queue

## Use Cases

- Knowledge graphs and semantic data
- Social network relationships
- Provenance tracking (who said what, when)
- Complex event processing with metadata
- Graph database operations via message queue
