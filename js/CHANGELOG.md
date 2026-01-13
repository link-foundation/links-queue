# links-queue-js

## 0.2.0

### Minor Changes

- 24b0184: Add Link and LinkStore interfaces for Phase 1 API contract
  - Add `Link` interface with `id`, `source`, `target`, and optional `values` properties
  - Add `LinkRef` and `LinkId` types for flexible link referencing
  - Add `LinkStore` interface with CRUD operations (create, get, find, update, delete, etc.)
  - Add `LinkPattern` interface with `Any` wildcard for pattern matching
  - Add utility functions: `isLink`, `isLinkId`, `isLinkRef`, `getLinkId`, `createLink`, `matchesPattern`
  - Compatible with links-notation and doublets-rs patterns

## 0.1.6

### Patch Changes

- 7b20214: Rename project from links-mq to links-queue and add planning documentation
  - Renamed all package references from links-mq to links-queue
  - Added VISION.md with project goals and universal queue vision
  - Added REQUIREMENTS.md with detailed functional/non-functional requirements
  - Added ARCHITECTURE.md with system architecture and operating modes
  - Added ROADMAP.md with 10-phase development plan
  - Updated COMPARISON.md with new naming and roadmap references

## 0.1.5

### Patch Changes

- 3a49cca: Move JS implementation to separate folder for multi-language support
  - Restructured repository to support both JavaScript and Rust implementations
  - Moved all JS-related files to the `js/` folder
  - Updated CI/CD workflow for folder-based path filtering
  - No functional changes to the library

## 0.1.4

### Patch Changes

- Reorganized codebase structure with separate js folder
