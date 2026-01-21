# Links Queue Docker Image
#
# Multi-stage build for minimal image size.
# Supports both JavaScript and Rust implementations.
#
# Build arguments:
#   - RUNTIME: js (default) or rust
#
# Usage:
#   docker build -t links-queue .
#   docker build -t links-queue-rust --build-arg RUNTIME=rust .

ARG RUNTIME=js

# =============================================================================
# JavaScript Build Stage
# =============================================================================

FROM node:22-alpine AS js-builder

WORKDIR /app

# Copy package files
COPY js/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY js/src ./src

# =============================================================================
# JavaScript Runtime Stage
# =============================================================================

FROM node:22-alpine AS js-runtime

LABEL org.opencontainers.image.title="Links Queue (JavaScript)"
LABEL org.opencontainers.image.description="Universal queue system using links"
LABEL org.opencontainers.image.vendor="Link Foundation"
LABEL org.opencontainers.image.source="https://github.com/link-foundation/links-queue"
LABEL org.opencontainers.image.licenses="Unlicense"

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S linksqueue && \
    adduser -u 1001 -S linksqueue -G linksqueue

# Copy from builder
COPY --from=js-builder --chown=linksqueue:linksqueue /app/node_modules ./node_modules
COPY --from=js-builder --chown=linksqueue:linksqueue /app/src ./src
COPY --chown=linksqueue:linksqueue js/package.json ./

# Set environment
ENV NODE_ENV=production
ENV LINKS_QUEUE_HOST=0.0.0.0
ENV LINKS_QUEUE_PORT=5000

# Expose default port
EXPOSE 5000

# Switch to non-root user
USER linksqueue

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('net').createConnection({port: process.env.LINKS_QUEUE_PORT || 5000}).on('connect', () => process.exit(0)).on('error', () => process.exit(1))"

# Run server
CMD ["node", "src/cli.js", "server"]

# =============================================================================
# Rust Build Stage
# =============================================================================

FROM rust:1.75-alpine AS rust-builder

# Install build dependencies
RUN apk add --no-cache musl-dev

WORKDIR /app

# Copy Cargo files
COPY rust/Cargo.toml rust/Cargo.lock* ./

# Create dummy src to cache dependencies
RUN mkdir -p src && \
    echo 'fn main() {}' > src/main.rs && \
    echo 'pub fn dummy() {}' > src/lib.rs

# Build dependencies only
RUN cargo build --release && \
    rm -rf src

# Copy actual source
COPY rust/src ./src

# Build the actual binary
RUN touch src/main.rs src/lib.rs && \
    cargo build --release

# =============================================================================
# Rust Runtime Stage
# =============================================================================

FROM alpine:3.19 AS rust-runtime

LABEL org.opencontainers.image.title="Links Queue (Rust)"
LABEL org.opencontainers.image.description="Universal queue system using links"
LABEL org.opencontainers.image.vendor="Link Foundation"
LABEL org.opencontainers.image.source="https://github.com/link-foundation/links-queue"
LABEL org.opencontainers.image.licenses="Unlicense"

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S linksqueue && \
    adduser -u 1001 -S linksqueue -G linksqueue

# Copy binary from builder
COPY --from=rust-builder --chown=linksqueue:linksqueue /app/target/release/links-queue /usr/local/bin/

# Set environment
ENV LINKS_QUEUE_HOST=0.0.0.0
ENV LINKS_QUEUE_PORT=5000

# Expose default port
EXPOSE 5000

# Switch to non-root user
USER linksqueue

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD nc -z localhost ${LINKS_QUEUE_PORT:-5000} || exit 1

# Run server
CMD ["links-queue", "server"]

# =============================================================================
# Final Stage Selection
# =============================================================================

FROM ${RUNTIME}-runtime AS final
