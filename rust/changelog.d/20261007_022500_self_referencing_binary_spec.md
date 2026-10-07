---
bump: patch
---

### Fixed

- Correct the binary notation specification's self-referencing example to `0F 05 05` (3 bytes versus 8 text bytes, a 62.5% reduction). Clarify independent ID and source fields and verify the documented bytes against the Rust codec while preserving the version 1.0 wire format.
