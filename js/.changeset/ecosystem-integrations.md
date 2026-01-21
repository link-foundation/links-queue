---
'links-queue-js': minor
---

Add ecosystem integrations and deployment tools

**JavaScript Framework Integrations:**

- Express.js middleware with request-level facade and RESTful router
- Fastify plugin with decorators and route prefixes
- NestJS module with forRoot/forRootAsync patterns and decorators
- Hono middleware for edge environments (Cloudflare Workers, Deno Deploy)

**Deployment Tools:**

- Docker images with multi-stage builds for JS and Rust versions
- Docker Compose configurations for single node and cluster deployments
- Kubernetes Helm chart with HPA, PVC, ConfigMap, and ServiceAccount support

**CLI Enhancements:**

- Queue management commands (create, delete, list, info, purge)
- Message operations (send, receive, peek, ack, reject)
- Cluster management (status, join, leave)
- Statistics and health check commands
