# links-mq

A lightweight, multi-language message queue implementation designed for simplicity and ease of use, supporting both JavaScript/TypeScript and Rust.

## Why links-mq?

See our [comprehensive comparison](COMPARISON.md) with existing message brokers (RabbitMQ, Celery, BullMQ, Kafka) to understand where links-mq fits in the messaging ecosystem.

## Project Structure

```
.
├── js/                   # JavaScript/TypeScript implementation
│   ├── .changeset/       # Changeset configuration
│   ├── .husky/           # Git hooks
│   ├── examples/         # Usage examples
│   ├── scripts/          # Build and release scripts
│   ├── src/              # Source code
│   ├── tests/            # Test files
│   ├── package.json      # Node.js package manifest
│   └── README.md         # JS-specific documentation
│
├── rust/                 # Rust implementation
│   ├── changelog.d/      # Changelog fragments
│   ├── examples/         # Usage examples
│   ├── scripts/          # Build and release scripts
│   ├── src/              # Source code
│   ├── tests/            # Integration tests
│   ├── Cargo.toml        # Rust package manifest
│   └── README.md         # Rust-specific documentation
│
├── .github/workflows/    # CI/CD workflows
│   ├── js.yml            # JavaScript CI/CD pipeline
│   └── rust.yml          # Rust CI/CD pipeline
│
└── LICENSE               # Unlicense (Public Domain)
```

## Language-Specific Documentation

- **JavaScript/TypeScript**: See [js/README.md](js/README.md)
- **Rust**: See [rust/README.md](rust/README.md)

## Features

### JavaScript

- Multi-runtime support (Node.js, Bun, Deno)
- Universal testing with [test-anywhere](https://github.com/link-foundation/test-anywhere)
- Automated releases via Changesets
- ESLint + Prettier with pre-commit hooks

### Rust

- Cross-platform support (Linux, macOS, Windows)
- Async support with Tokio
- Pedantic Clippy lints
- Changelog fragments for automated releases

## Development

### JavaScript

```bash
cd js
npm install
npm test
npm run lint
```

### Rust

```bash
cd rust
cargo build
cargo test
cargo clippy
```

## CI/CD

Each language has its own CI/CD workflow:

- **js.yml**: Handles JavaScript testing, linting, and npm publishing
- **rust.yml**: Handles Rust testing, linting, and GitHub releases

Changes to files in `js/` trigger the JS workflow, and changes to files in `rust/` trigger the Rust workflow.

## Release Process

### JavaScript

1. Create a changeset: `cd js && npm run changeset`
2. Commit and push to a branch
3. Open a PR and merge to main
4. The workflow will automatically version and publish to npm

### Rust

1. Add a changelog fragment in `rust/changelog.d/`
2. Commit and push to a branch
3. Open a PR and merge to main
4. The workflow will automatically bump version and create a GitHub release

## License

[Unlicense](LICENSE) - Public Domain
