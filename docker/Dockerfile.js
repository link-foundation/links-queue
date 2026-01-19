# Links Queue Docker Image - JavaScript
#
# Standalone Dockerfile for the JavaScript implementation.
#
# Usage:
#   docker build -f docker/Dockerfile.js -t links-queue:js .

# =============================================================================
# Build Stage
# =============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY js/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY js/src ./src

# =============================================================================
# Runtime Stage
# =============================================================================

FROM node:22-alpine

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
COPY --from=builder --chown=linksqueue:linksqueue /app/node_modules ./node_modules
COPY --from=builder --chown=linksqueue:linksqueue /app/src ./src
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
