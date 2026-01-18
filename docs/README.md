# Links Queue Documentation

Welcome to the Links Queue documentation. Links Queue is a universal queue system that works with **links** instead of traditional messages, events, or tasks.

## Quick Navigation

### Getting Started

- [Getting Started Guide](guides/getting-started.md) - Installation, quick start, and basic configuration
- [Core Concepts](guides/core-concepts.md) - Understanding links, the data model, and queue semantics

### Guides

- [Operating Modes](guides/operating-modes.md) - Single-node vs multi-node, memory vs persistent storage
- [Storage Backends](guides/storage-backends.md) - Memory backend, link-cli backend, and custom backends
- [Server Mode](guides/server-mode.md) - Running Links Queue as a standalone TCP server
- [Clustering](guides/clustering.md) - Setting up distributed multi-node clusters
- [Best Practices](guides/best-practices.md) - Error handling, performance tuning, and monitoring

### API Reference

- [JavaScript API](api/js/README.md) - Complete API reference for the JavaScript/TypeScript implementation
- [Rust API](api/rust/README.md) - Complete API reference for the Rust implementation

## Project Resources

- [VISION.md](../VISION.md) - Project vision and goals
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture and design
- [ROADMAP.md](../ROADMAP.md) - Development phases and milestones
- [COMPARISON.md](../COMPARISON.md) - Comparison with other message brokers

## Language-Specific Documentation

Links Queue provides implementations in multiple languages:

| Language              | Package                                                        | Documentation                       |
| --------------------- | -------------------------------------------------------------- | ----------------------------------- |
| JavaScript/TypeScript | [links-queue-js](https://www.npmjs.com/package/links-queue-js) | [js/README.md](../js/README.md)     |
| Rust                  | [links-queue](https://crates.io/crates/links-queue)            | [rust/README.md](../rust/README.md) |

## Feature Status

| Feature               | JavaScript  | Rust        |
| --------------------- | ----------- | ----------- |
| Core Link Operations  | Implemented | Implemented |
| Memory Queue          | Implemented | Implemented |
| link-cli Backend      | Implemented | Implemented |
| TCP Server Mode       | Implemented | Implemented |
| Multi-node Clustering | Implemented | Implemented |
| Binary Protocol       | Planned     | Planned     |

## Support

- [GitHub Issues](https://github.com/link-foundation/links-queue/issues) - Report bugs and request features
- [GitHub Discussions](https://github.com/link-foundation/links-queue/discussions) - Ask questions and share ideas

## License

Links Queue is released under the [Unlicense](../LICENSE) (Public Domain).
