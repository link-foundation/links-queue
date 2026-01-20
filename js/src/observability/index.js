/**
 * Observability module for links-queue.
 *
 * Provides comprehensive observability features including metrics collection,
 * Prometheus export, structured logging, and health checks.
 *
 * @module observability
 *
 * @see REQUIREMENTS.md - REQ-OBS-001 through REQ-OBS-022
 */

// =============================================================================
// Metrics Exports
// =============================================================================

export {
  // Metric primitives
  Counter,
  Gauge,
  LatencyHistogram,
  DEFAULT_LATENCY_BUCKETS,
  // Queue metrics
  QueueMetrics,
  // Registry
  MetricsRegistry,
  defaultRegistry,
} from './metrics.js';

// =============================================================================
// Prometheus Exports
// =============================================================================

export { PrometheusExporter, metricsMiddleware } from './prometheus.js';

// =============================================================================
// Logger Exports
// =============================================================================

export {
  // Log levels
  LogLevel,
  // Context management
  LogContext,
  // Logger
  Logger,
  defaultLogger,
  createQueueLogger,
} from './logger.js';

// =============================================================================
// Health Check Exports
// =============================================================================

export {
  // Status values
  HealthStatus,
  // Component checker
  ComponentChecker,
  // Health checker
  HealthChecker,
  // Middleware
  healthMiddleware,
  // Factory
  createServerHealthChecker,
} from './health.js';
