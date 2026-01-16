---
'links-queue-js': minor
---

Add MemoryLinkStore - in-memory storage backend for JavaScript/TypeScript

Features:

- Implements LinkStore interface with full CRUD operations
- O(1) lookups by ID using JavaScript Map
- Link deduplication (identical source/target pairs share same ID)
- Pattern matching with wildcard queries via Any symbol
- Async API for consistency with other backends
- Support for universal links with additional values
- AsyncIterable iteration over matching links
- Clear method to reset the store

This backend is ideal for development, testing, and scenarios where persistence is not required.
