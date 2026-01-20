//! Observability module for links-queue.
//!
//! Provides comprehensive observability features including:
//! - Metrics collection (counters, gauges, histograms)
//! - Prometheus-compatible metrics export
//! - Structured logging with JSON support
//! - Health checks (liveness, readiness, component health)
//!
//! # Requirements
//!
//! This module implements the following requirements from REQUIREMENTS.md:
//! - REQ-OBS-001: Queue depth metrics
//! - REQ-OBS-002: Throughput metrics (enqueue/dequeue rates)
//! - REQ-OBS-003: Latency histograms
//! - REQ-OBS-004: Consumer lag metrics
//! - REQ-OBS-010: Configurable log levels
//! - REQ-OBS-011: Correlation IDs for tracing
//! - REQ-OBS-012: Structured logging (JSON format)
//! - REQ-OBS-020: Liveness endpoint
//! - REQ-OBS-021: Readiness endpoint
//! - REQ-OBS-022: Backend connectivity health checks
//!
//! # Example
//!
//! ```rust
//! use links_queue::observability::{
//!     QueueMetrics, MetricsRegistry, HealthChecker, HealthStatus,
//!     Logger, LogLevel,
//! };
//!
//! // Metrics
//! let metrics = QueueMetrics::new("my_queue");
//! metrics.record_enqueue(Some(5.0));
//! metrics.record_dequeue(Some(10.0));
//! let data = metrics.get_metrics();
//! println!("Queue depth: {}", data.depth);
//!
//! // Health checks
//! let checker = HealthChecker::new("1.0.0");
//! checker.set_ready(true);
//! let liveness = checker.check_alive();
//! println!("Status: {:?}", liveness.status);
//!
//! // Logging
//! let logger = Logger::new().with_level(LogLevel::Info);
//! logger.info("Application started");
//! ```

mod metrics;
mod prometheus;
mod logger;
mod health;

pub use metrics::{
    Counter, Gauge, LatencyHistogram, HistogramStats, HistogramBucket,
    QueueMetrics, QueueMetricsData, ThroughputMetrics, LatencyMetrics,
    MetricsRegistry, DEFAULT_LATENCY_BUCKETS,
};

pub use prometheus::PrometheusExporter;

pub use logger::{
    LogLevel, LogFormat, LogContext, Logger, LogEntry, LogOutput,
    create_queue_logger,
};

pub use health::{
    HealthStatus, ComponentHealth, HealthCheckResult,
    ComponentChecker, HealthChecker, LivenessResult, ReadinessResult,
};
