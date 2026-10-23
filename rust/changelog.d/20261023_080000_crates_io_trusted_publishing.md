---
bump: patch
---

### Added

- Publish the crate to crates.io from the release jobs, trying trusted publishing (OIDC) first and falling back to the `CARGO_REGISTRY_TOKEN` / `CARGO_TOKEN` secret, then verify that crates.io serves the new version. Missing or rejected credentials fail the release with setup instructions.

### Fixed

- Run the Auto Release and Manual Release jobs again: a skipped job in their dependency chain had skipped them, so no Rust version was ever released.
- Publish a version that was tagged but never reached crates.io on the next run or a re-run, and check publishability with `cargo publish --dry-run` in CI.
- Point the installation docs at the current `links-queue = "0.3"` version.
