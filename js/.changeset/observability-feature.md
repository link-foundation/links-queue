---
'links-queue-js': minor
---

Added observability module with comprehensive metrics, logging, and health checks:

- **Metrics**: Counter, Gauge, LatencyHistogram with percentiles, QueueMetrics, MetricsRegistry
- **Prometheus**: PrometheusExporter with text format output, metricsMiddleware for Express/Fastify
- **Logging**: Structured Logger with JSON/text formats, log rotation, correlation ID tracking
- **Health**: HealthChecker with liveness/readiness endpoints, component health, Kubernetes-compatible responses
