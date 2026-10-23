# Links Queue (Rust)

Rust implementation of Links Queue - a universal queue system using links.

## Features

- **Cross-platform**: Works on Linux, macOS, and Windows
- **Async support**: Built with Tokio for async operations
- **Code quality**: Clippy with pedantic lints enabled
- **Automated releases**: Changelog fragments with automatic version bumping

## Quick Start

### Installation

The crate is published to [crates.io](https://crates.io/crates/links-queue):

```bash
cargo add links-queue

# Or install the command-line binary
cargo install links-queue
```

### Development

```bash
cd rust

# Build the project
cargo build

# Run tests
cargo test

# Run with verbose output
cargo test --verbose

# Run clippy lints
cargo clippy --all-targets --all-features

# Format code
cargo fmt

# Run the example
cargo run --example basic_usage
```

## Project Structure

```
rust/
├── changelog.d/          # Changelog fragments
├── examples/             # Usage examples
│   └── basic_usage.rs    # Basic usage example
├── scripts/              # Build and release scripts
├── src/                  # Source code
│   ├── lib.rs            # Library entry point
│   └── main.rs           # Binary entry point
├── tests/                # Integration tests
│   └── integration_test.rs
├── Cargo.toml            # Rust package manifest
└── CHANGELOG.md          # Release history
```

## Releasing

Merging changelog fragments to `main` (or running the workflow manually)
bumps the version, publishes the crate to crates.io and creates a GitHub
release. Publishing tries **trusted publishing (OIDC)** first and falls back
to the `CARGO_REGISTRY_TOKEN` or `CARGO_TOKEN` repository secret, so no
long-lived token is needed once the trusted publisher is registered.

crates.io registers trusted publishers only for existing crates, so the first
version needs a one-time setup by a maintainer:

```bash
package-registry-manager setup --repository . --registry crates-io --execute
```

It publishes the first version with a short-lived crate-scoped token and
registers the trusted publisher. To do it by hand instead, publish once with a
token, then open <https://crates.io/crates/links-queue/settings> and add the
GitHub trusted publisher: owner `link-foundation`, repository `links-queue`,
workflow `rust.yml`, no environment. If neither credential works, the release
job fails with these instructions.

A version that was tagged but never reached crates.io is published by the next
run on `main`, or by re-running the failed run.

## API

### Functions

- `add(a: i64, b: i64) -> i64` - Add two numbers
- `multiply(a: i64, b: i64) -> i64` - Multiply two numbers
- `delay(seconds: f64)` - Async delay for specified seconds

### Constants

- `VERSION: &str` - Package version from Cargo.toml

## License

[Unlicense](../LICENSE) - Public Domain
