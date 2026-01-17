---
'links-queue-js': minor
---

Add pluggable StorageBackend interface for switching between storage backends via configuration

- Add `StorageBackend` interface with lifecycle, CRUD, batch, and metadata operations
- Add `BackendCapabilities` and `BackendStats` types for backend introspection
- Add `MemoryBackendAdapter` wrapping `MemoryLinkStore` with `StorageBackend` interface
- Add `BackendRegistry` for registering and creating backends by configuration
- Add comprehensive tests for backend registry and adapter
