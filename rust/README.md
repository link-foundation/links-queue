# Links Queue (Rust)

Rust implementation of Links Queue - a universal queue system using links.

## Features

- **Cross-platform**: Works on Linux, macOS, and Windows
- **Async support**: Built with Tokio for async operations
- **Code quality**: Clippy with pedantic lints enabled
- **Automated releases**: Changelog fragments with automatic version bumping

## Quick Start

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

## API

### Functions

- `add(a: i64, b: i64) -> i64` - Add two numbers
- `multiply(a: i64, b: i64) -> i64` - Multiply two numbers
- `delay(seconds: f64)` - Async delay for specified seconds

### Constants

- `VERSION: &str` - Package version from Cargo.toml

## License

[Unlicense](../LICENSE) - Public Domain
