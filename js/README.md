# links-mq-js

JavaScript/TypeScript implementation of links-mq.

## Features

- **Multi-runtime support**: Works with Node.js, Bun, and Deno
- **Universal testing**: Uses [test-anywhere](https://github.com/link-foundation/test-anywhere) for cross-runtime tests
- **Automated releases**: Changesets-based versioning with GitHub Actions
- **Code quality**: ESLint + Prettier with pre-commit hooks via Husky
- **Package manager agnostic**: Works with npm, yarn, bun, deno, and pnpm

## Quick Start

### Development

```bash
cd js

# Install dependencies
npm install

# Run tests
npm test

# Or with other runtimes:
bun test
deno test --allow-read

# Lint code
npm run lint

# Format code
npm run format

# Check all (lint + format + file size)
npm run check
```

## Project Structure

```
js/
├── .changeset/           # Changeset configuration
├── .husky/               # Git hooks (pre-commit)
├── examples/             # Usage examples
├── scripts/              # Build and release scripts
├── src/                  # Source code
│   ├── index.js          # Main entry point
│   └── index.d.ts        # TypeScript definitions
├── tests/                # Test files
├── eslint.config.js      # ESLint configuration
├── .prettierrc           # Prettier configuration
├── bunfig.toml           # Bun configuration
├── deno.json             # Deno configuration
└── package.json          # Node.js package manifest
```

## Scripts Reference

| Script                 | Description                             |
| ---------------------- | --------------------------------------- |
| `npm test`             | Run tests with Node.js                  |
| `npm run lint`         | Check code with ESLint                  |
| `npm run lint:fix`     | Fix ESLint issues automatically         |
| `npm run format`       | Format code with Prettier               |
| `npm run format:check` | Check formatting without changing files |
| `npm run check`        | Run all checks (lint + format)          |
| `npm run changeset`    | Create a new changeset                  |

## License

[Unlicense](../LICENSE) - Public Domain
