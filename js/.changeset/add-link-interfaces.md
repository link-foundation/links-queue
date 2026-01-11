---
'links-mq-js': minor
---

Add Link and LinkStore interfaces for Phase 1 API contract

- Add `Link` interface with `id`, `source`, `target`, and optional `values` properties
- Add `LinkRef` and `LinkId` types for flexible link referencing
- Add `LinkStore` interface with CRUD operations (create, get, find, update, delete, etc.)
- Add `LinkPattern` interface with `Any` wildcard for pattern matching
- Add utility functions: `isLink`, `isLinkId`, `isLinkRef`, `getLinkId`, `createLink`, `matchesPattern`
- Compatible with links-notation and doublets-rs patterns
