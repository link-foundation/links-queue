---
'links-queue-js': minor
---

Implement link-cli storage backend for persistent storage

- Add `LinkCliBackend` class implementing StorageBackend interface
- Add `LinkCliProcess` for managing link-cli child processes
- Support CRUD operations via Links Notation protocol
- Register link-cli backend in BackendRegistry
- Full TypeScript type definitions for all new exports
- Comprehensive unit tests with mocked link-cli
