//! Prometheus metrics exporter for links-queue.
//!
//! Provides Prometheus-compatible metrics export in text format,
//! following the Prometheus exposition format specification.

use super::metrics::{MetricsRegistry, QueueMetricsData, HistogramStats};
use std::collections::HashMap;
use std::sync::Arc;

/// Formats a metric name for Prometheus.
fn format_metric_name(name: &str, prefix: Option<&str>) -> String {
    let name = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == ':' { c } else { '_' })
        .collect::<String>();

    // Remove consecutive underscores and trim
    let name = name
        .split('_')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_");

    match prefix {
        Some(p) => format!("{}_{}", p, name),
        None => name,
    }
}

/// Escapes label values for Prometheus format.
fn escape_label_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

/// Formats labels as Prometheus label string.
fn format_labels(labels: &HashMap<String, String>) -> String {
    if labels.is_empty() {
        return String::new();
    }

    let pairs: Vec<String> = labels
        .iter()
        .map(|(k, v)| format!("{}=\"{}\"", k, escape_label_value(v)))
        .collect();

    format!("{{{}}}", pairs.join(","))
}

/// Prometheus exporter for links-queue metrics.
pub struct PrometheusExporter {
    registry: Arc<MetricsRegistry>,
    prefix: Option<String>,
    default_labels: HashMap<String, String>,
}

impl PrometheusExporter {
    /// Creates a new `PrometheusExporter`.
    #[must_use]
    pub fn new(registry: Arc<MetricsRegistry>) -> Self {
        Self {
            registry,
            prefix: None,
            default_labels: HashMap::new(),
        }
    }

    /// Sets the metric name prefix.
    #[must_use]
    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = Some(prefix.into());
        self
    }

    /// Adds a default label.
    #[must_use]
    pub fn with_label(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.default_labels.insert(key.into(), value.into());
        self
    }

    /// Formats a counter metric.
    fn format_counter(
        &self,
        name: &str,
        value: u64,
        help: &str,
        labels: &HashMap<String, String>,
    ) -> String {
        let metric_name = format_metric_name(name, self.prefix.as_deref());
        let mut all_labels = self.default_labels.clone();
        all_labels.extend(labels.clone());
        let label_str = format_labels(&all_labels);

        format!(
            "# HELP {} {}\n# TYPE {} counter\n{}{} {}",
            metric_name, help, metric_name, metric_name, label_str, value
        )
    }

    /// Formats a gauge metric.
    fn format_gauge(
        &self,
        name: &str,
        value: i64,
        help: &str,
        labels: &HashMap<String, String>,
    ) -> String {
        let metric_name = format_metric_name(name, self.prefix.as_deref());
        let mut all_labels = self.default_labels.clone();
        all_labels.extend(labels.clone());
        let label_str = format_labels(&all_labels);

        format!(
            "# HELP {} {}\n# TYPE {} gauge\n{}{} {}",
            metric_name, help, metric_name, metric_name, label_str, value
        )
    }

    /// Formats a histogram metric.
    fn format_histogram(
        &self,
        name: &str,
        stats: &HistogramStats,
        help: &str,
        labels: &HashMap<String, String>,
    ) -> String {
        let metric_name = format_metric_name(name, self.prefix.as_deref());
        let mut all_labels = self.default_labels.clone();
        all_labels.extend(labels.clone());

        let mut lines = vec![
            format!("# HELP {} {}", metric_name, help),
            format!("# TYPE {} histogram", metric_name),
        ];

        // Bucket values (cumulative)
        let mut cumulative = 0u64;
        for bucket in &stats.buckets {
            cumulative += bucket.count;
            let mut bucket_labels = all_labels.clone();
            bucket_labels.insert("le".to_string(), bucket.le.to_string());
            lines.push(format!(
                "{}_bucket{} {}",
                metric_name,
                format_labels(&bucket_labels),
                cumulative
            ));
        }

        // +Inf bucket
        let mut inf_labels = all_labels.clone();
        inf_labels.insert("le".to_string(), "+Inf".to_string());
        lines.push(format!(
            "{}_bucket{} {}",
            metric_name,
            format_labels(&inf_labels),
            stats.count
        ));

        // Sum and count
        let label_str = format_labels(&all_labels);
        lines.push(format!("{}_sum{} {}", metric_name, label_str, stats.sum));
        lines.push(format!("{}_count{} {}", metric_name, label_str, stats.count));

        lines.join("\n")
    }

    /// Exports queue metrics in Prometheus format.
    fn export_queue_metrics(&self, queue_name: &str, metrics: &QueueMetricsData) -> String {
        let mut labels = HashMap::new();
        labels.insert("queue".to_string(), queue_name.to_string());

        let mut parts = Vec::new();

        // Queue depth
        parts.push(self.format_gauge(
            "links_queue_depth",
            metrics.depth,
            "Current number of messages in the queue",
            &labels,
        ));

        // Throughput counters
        parts.push(self.format_counter(
            "links_queue_messages_enqueued_total",
            metrics.throughput.enqueued,
            "Total number of messages enqueued",
            &labels,
        ));
        parts.push(self.format_counter(
            "links_queue_messages_dequeued_total",
            metrics.throughput.dequeued,
            "Total number of messages dequeued",
            &labels,
        ));
        parts.push(self.format_counter(
            "links_queue_messages_acknowledged_total",
            metrics.throughput.acknowledged,
            "Total number of messages acknowledged",
            &labels,
        ));
        parts.push(self.format_counter(
            "links_queue_messages_rejected_total",
            metrics.throughput.rejected,
            "Total number of messages rejected",
            &labels,
        ));
        parts.push(self.format_counter(
            "links_queue_messages_dead_lettered_total",
            metrics.throughput.dead_lettered,
            "Total number of messages moved to dead letter queue",
            &labels,
        ));

        // Throughput rates
        parts.push(self.format_gauge(
            "links_queue_enqueue_rate",
            metrics.throughput.enqueue_rate as i64,
            "Current enqueue rate (messages/second)",
            &labels,
        ));
        parts.push(self.format_gauge(
            "links_queue_dequeue_rate",
            metrics.throughput.dequeue_rate as i64,
            "Current dequeue rate (messages/second)",
            &labels,
        ));

        // Latency histograms
        parts.push(self.format_histogram(
            "links_queue_enqueue_duration_milliseconds",
            &metrics.latency.enqueue,
            "Enqueue operation duration in milliseconds",
            &labels,
        ));
        parts.push(self.format_histogram(
            "links_queue_dequeue_duration_milliseconds",
            &metrics.latency.dequeue,
            "Dequeue operation duration in milliseconds",
            &labels,
        ));
        parts.push(self.format_histogram(
            "links_queue_processing_duration_milliseconds",
            &metrics.latency.processing,
            "Message processing duration in milliseconds",
            &labels,
        ));

        // Consumer lag and in-flight
        parts.push(self.format_gauge(
            "links_queue_consumer_lag",
            metrics.consumer_lag,
            "Number of messages waiting to be processed",
            &labels,
        ));
        parts.push(self.format_gauge(
            "links_queue_in_flight",
            metrics.in_flight,
            "Number of messages currently being processed",
            &labels,
        ));

        // Errors
        parts.push(self.format_counter(
            "links_queue_errors_total",
            metrics.errors,
            "Total number of errors",
            &labels,
        ));

        parts.join("\n\n")
    }

    /// Exports all metrics in Prometheus text format.
    #[must_use]
    pub fn export(&self) -> String {
        let mut parts = Vec::new();

        // Uptime
        parts.push(self.format_gauge(
            "links_queue_uptime_seconds",
            self.registry.uptime().as_secs() as i64,
            "Uptime of the links-queue process in seconds",
            &HashMap::new(),
        ));

        // Queue metrics
        let queues = self.registry.get_all_queue_metrics();
        for (name, metrics) in &queues {
            parts.push(self.export_queue_metrics(name, metrics));
        }

        parts.join("\n\n") + "\n"
    }

    /// Returns the content type for Prometheus metrics.
    #[must_use]
    pub fn content_type() -> &'static str {
        "text/plain; version=0.0.4; charset=utf-8"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_metric_name() {
        assert_eq!(format_metric_name("my_metric", None), "my_metric");
        assert_eq!(format_metric_name("my-metric", None), "my_metric");
        assert_eq!(format_metric_name("my_metric", Some("app")), "app_my_metric");
    }

    #[test]
    fn test_format_labels() {
        let mut labels = HashMap::new();
        labels.insert("queue".to_string(), "test".to_string());
        labels.insert("env".to_string(), "prod".to_string());

        let result = format_labels(&labels);
        assert!(result.contains("queue=\"test\""));
        assert!(result.contains("env=\"prod\""));
    }

    #[test]
    fn test_escape_label_value() {
        assert_eq!(escape_label_value("hello"), "hello");
        assert_eq!(escape_label_value("hello\"world"), "hello\\\"world");
        assert_eq!(escape_label_value("hello\nworld"), "hello\\nworld");
    }

    #[test]
    fn test_exporter() {
        let registry = Arc::new(MetricsRegistry::new());
        let metrics = registry.get_queue_metrics("test");
        metrics.record_enqueue(Some(5.0));

        let exporter = PrometheusExporter::new(registry);
        let output = exporter.export();

        assert!(output.contains("# TYPE"));
        assert!(output.contains("links_queue_depth"));
        assert!(output.contains("queue=\"test\""));
    }

    #[test]
    fn test_content_type() {
        let ct = PrometheusExporter::content_type();
        assert!(ct.contains("text/plain"));
        assert!(ct.contains("version=0.0.4"));
    }
}
