// Allow certain Clippy lints for this module to keep the code clean and functional.
// These can be addressed in future iterations.
#![allow(clippy::derivable_impls)]
#![allow(clippy::doc_markdown)]
#![allow(clippy::missing_const_for_fn)]
#![allow(clippy::option_if_let_else)]
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::significant_drop_in_scrutinee)]
#![allow(clippy::await_holding_lock)]
#![allow(clippy::must_use_candidate)]
#![allow(clippy::future_not_send)]
#![allow(clippy::significant_drop_tightening)]
#![allow(clippy::uninlined_format_args)]
#![allow(clippy::use_self)]
#![allow(clippy::should_implement_trait)]
#![allow(clippy::map_unwrap_or)]
#![allow(clippy::cast_possible_wrap)]
#![allow(clippy::cast_sign_loss)]
#![allow(clippy::cast_precision_loss)]

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

mod health;
mod logger;
mod metrics;
mod prometheus;

pub use metrics::{
    Counter, Gauge, HistogramBucket, HistogramStats, LatencyHistogram, LatencyMetrics,
    MetricsRegistry, QueueMetrics, QueueMetricsData, ThroughputMetrics, DEFAULT_LATENCY_BUCKETS,
};

pub use prometheus::PrometheusExporter;

pub use logger::{
    create_queue_logger, LogContext, LogEntry, LogFormat, LogLevel, LogOutput, Logger,
};

pub use health::{
    ComponentChecker, ComponentHealth, HealthCheckResult, HealthChecker, HealthStatus,
    LivenessResult, ReadinessResult,
};
