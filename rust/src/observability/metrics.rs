//! Metrics collection module for links-queue.
//!
//! Provides comprehensive metrics collection including queue depth, throughput,
//! latency histograms, consumer lag, error rates, and resource usage.
//!
//! # Requirements
//!
//! Implements REQ-OBS-001 through REQ-OBS-004 from REQUIREMENTS.md.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// Default latency bucket boundaries in milliseconds.
/// Follows Prometheus-style exponential buckets.
pub const DEFAULT_LATENCY_BUCKETS: &[f64] = &[
    1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0, 10000.0,
];

/// A histogram bucket definition.
#[derive(Debug, Clone)]
pub struct HistogramBucket {
    /// Upper bound (inclusive) for this bucket.
    pub le: f64,
    /// Number of observations in this bucket.
    pub count: u64,
}

/// Histogram statistics.
#[derive(Debug, Clone)]
pub struct HistogramStats {
    /// Total number of observations.
    pub count: u64,
    /// Sum of all observed values.
    pub sum: f64,
    /// Mean of all observations.
    pub mean: f64,
    /// Minimum observed value.
    pub min: f64,
    /// Maximum observed value.
    pub max: f64,
    /// 50th percentile (median).
    pub p50: f64,
    /// 90th percentile.
    pub p90: f64,
    /// 95th percentile.
    pub p95: f64,
    /// 99th percentile.
    pub p99: f64,
    /// Bucket counts.
    pub buckets: Vec<HistogramBucket>,
}

impl Default for HistogramStats {
    fn default() -> Self {
        Self {
            count: 0,
            sum: 0.0,
            mean: 0.0,
            min: 0.0,
            max: 0.0,
            p50: 0.0,
            p90: 0.0,
            p95: 0.0,
            p99: 0.0,
            buckets: Vec::new(),
        }
    }
}

/// A histogram for tracking latency distributions.
/// Supports percentile calculations (p50, p90, p95, p99).
#[derive(Debug)]
pub struct LatencyHistogram {
    buckets: Vec<f64>,
    counts: Vec<AtomicU64>,
    sum: AtomicU64,
    count: AtomicU64,
    samples: RwLock<Vec<f64>>,
    max_samples: usize,
    min: RwLock<f64>,
    max: RwLock<f64>,
}

impl LatencyHistogram {
    /// Creates a new LatencyHistogram with default buckets.
    #[must_use]
    pub fn new() -> Self {
        Self::with_buckets(DEFAULT_LATENCY_BUCKETS.to_vec())
    }

    /// Creates a new LatencyHistogram with custom buckets.
    #[must_use]
    pub fn with_buckets(buckets: Vec<f64>) -> Self {
        let counts = (0..=buckets.len())
            .map(|_| AtomicU64::new(0))
            .collect();
        Self {
            buckets,
            counts,
            sum: AtomicU64::new(0),
            count: AtomicU64::new(0),
            samples: RwLock::new(Vec::with_capacity(10000)),
            max_samples: 10000,
            min: RwLock::new(f64::MAX),
            max: RwLock::new(0.0),
        }
    }

    /// Records a latency observation in milliseconds.
    pub fn observe(&self, value: f64) {
        // Find the bucket
        let bucket_index = self
            .buckets
            .iter()
            .position(|&b| value <= b)
            .unwrap_or(self.buckets.len());

        self.counts[bucket_index].fetch_add(1, Ordering::Relaxed);

        // Update sum (using bits to store f64 atomically)
        loop {
            let current = self.sum.load(Ordering::Relaxed);
            let current_f64 = f64::from_bits(current);
            let new_f64 = current_f64 + value;
            if self.sum.compare_exchange(
                current,
                new_f64.to_bits(),
                Ordering::Relaxed,
                Ordering::Relaxed,
            ).is_ok() {
                break;
            }
        }

        self.count.fetch_add(1, Ordering::Relaxed);

        // Update min/max
        {
            let mut min = self.min.write().unwrap();
            if value < *min {
                *min = value;
            }
        }
        {
            let mut max = self.max.write().unwrap();
            if value > *max {
                *max = value;
            }
        }

        // Store sample for percentile calculation
        let mut samples = self.samples.write().unwrap();
        if samples.len() >= self.max_samples {
            samples.remove(0);
        }
        samples.push(value);
    }

    /// Calculates a percentile value.
    #[must_use]
    pub fn percentile(&self, p: f64) -> f64 {
        let samples = self.samples.read().unwrap();
        if samples.is_empty() {
            return 0.0;
        }

        let mut sorted: Vec<f64> = samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let index = ((p / 100.0) * sorted.len() as f64).ceil() as usize;
        let index = index.saturating_sub(1).min(sorted.len() - 1);
        sorted[index]
    }

    /// Gets histogram statistics.
    #[must_use]
    pub fn get_stats(&self) -> HistogramStats {
        let count = self.count.load(Ordering::Relaxed);
        let sum = f64::from_bits(self.sum.load(Ordering::Relaxed));
        let min = *self.min.read().unwrap();
        let max = *self.max.read().unwrap();

        HistogramStats {
            count,
            sum,
            mean: if count > 0 { sum / count as f64 } else { 0.0 },
            min: if count > 0 { min } else { 0.0 },
            max,
            p50: self.percentile(50.0),
            p90: self.percentile(90.0),
            p95: self.percentile(95.0),
            p99: self.percentile(99.0),
            buckets: self
                .buckets
                .iter()
                .enumerate()
                .map(|(i, &le)| HistogramBucket {
                    le,
                    count: self.counts[i].load(Ordering::Relaxed),
                })
                .collect(),
        }
    }

    /// Resets the histogram.
    pub fn reset(&self) {
        for count in &self.counts {
            count.store(0, Ordering::Relaxed);
        }
        self.sum.store(0, Ordering::Relaxed);
        self.count.store(0, Ordering::Relaxed);
        self.samples.write().unwrap().clear();
        *self.min.write().unwrap() = f64::MAX;
        *self.max.write().unwrap() = 0.0;
    }
}

impl Default for LatencyHistogram {
    fn default() -> Self {
        Self::new()
    }
}

/// A counter metric that only increments.
#[derive(Debug)]
pub struct Counter {
    name: String,
    help: String,
    value: AtomicU64,
    created_at: Instant,
}

impl Counter {
    /// Creates a new Counter.
    #[must_use]
    pub fn new(name: impl Into<String>, help: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            help: help.into(),
            value: AtomicU64::new(0),
            created_at: Instant::now(),
        }
    }

    /// Increments the counter by 1.
    pub fn inc(&self) {
        self.value.fetch_add(1, Ordering::Relaxed);
    }

    /// Increments the counter by the specified amount.
    pub fn inc_by(&self, amount: u64) {
        self.value.fetch_add(amount, Ordering::Relaxed);
    }

    /// Gets the current counter value.
    #[must_use]
    pub fn value(&self) -> u64 {
        self.value.load(Ordering::Relaxed)
    }

    /// Gets the counter name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Gets the counter help text.
    #[must_use]
    pub fn help(&self) -> &str {
        &self.help
    }

    /// Gets the creation time.
    #[must_use]
    pub fn created_at(&self) -> Instant {
        self.created_at
    }

    /// Resets the counter to zero.
    pub fn reset(&self) {
        self.value.store(0, Ordering::Relaxed);
    }
}

/// A gauge metric that can go up or down.
#[derive(Debug)]
pub struct Gauge {
    name: String,
    help: String,
    value: AtomicU64,
    last_updated: RwLock<Instant>,
}

impl Gauge {
    /// Creates a new Gauge.
    #[must_use]
    pub fn new(name: impl Into<String>, help: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            help: help.into(),
            value: AtomicU64::new(0),
            last_updated: RwLock::new(Instant::now()),
        }
    }

    /// Sets the gauge value.
    pub fn set(&self, value: i64) {
        self.value.store(value as u64, Ordering::Relaxed);
        *self.last_updated.write().unwrap() = Instant::now();
    }

    /// Increments the gauge by 1.
    pub fn inc(&self) {
        self.value.fetch_add(1, Ordering::Relaxed);
        *self.last_updated.write().unwrap() = Instant::now();
    }

    /// Increments the gauge by the specified amount.
    pub fn inc_by(&self, amount: i64) {
        if amount >= 0 {
            self.value.fetch_add(amount as u64, Ordering::Relaxed);
        } else {
            self.value.fetch_sub((-amount) as u64, Ordering::Relaxed);
        }
        *self.last_updated.write().unwrap() = Instant::now();
    }

    /// Decrements the gauge by 1.
    pub fn dec(&self) {
        self.value.fetch_sub(1, Ordering::Relaxed);
        *self.last_updated.write().unwrap() = Instant::now();
    }

    /// Decrements the gauge by the specified amount.
    pub fn dec_by(&self, amount: u64) {
        self.value.fetch_sub(amount, Ordering::Relaxed);
        *self.last_updated.write().unwrap() = Instant::now();
    }

    /// Gets the current gauge value.
    #[must_use]
    pub fn value(&self) -> i64 {
        self.value.load(Ordering::Relaxed) as i64
    }

    /// Gets the gauge name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Gets the gauge help text.
    #[must_use]
    pub fn help(&self) -> &str {
        &self.help
    }

    /// Resets the gauge to zero.
    pub fn reset(&self) {
        self.value.store(0, Ordering::Relaxed);
        *self.last_updated.write().unwrap() = Instant::now();
    }
}

/// Throughput metrics for a queue.
#[derive(Debug, Clone, Default)]
pub struct ThroughputMetrics {
    /// Total messages enqueued.
    pub enqueued: u64,
    /// Total messages dequeued.
    pub dequeued: u64,
    /// Total messages acknowledged.
    pub acknowledged: u64,
    /// Total messages rejected.
    pub rejected: u64,
    /// Total messages dead-lettered.
    pub dead_lettered: u64,
    /// Current enqueue rate (messages/second).
    pub enqueue_rate: f64,
    /// Current dequeue rate (messages/second).
    pub dequeue_rate: f64,
}

/// Latency metrics for a queue.
#[derive(Debug, Clone, Default)]
pub struct LatencyMetrics {
    /// Enqueue latency histogram stats.
    pub enqueue: HistogramStats,
    /// Dequeue latency histogram stats.
    pub dequeue: HistogramStats,
    /// Processing latency histogram stats.
    pub processing: HistogramStats,
}

/// Complete metrics data for a queue.
#[derive(Debug, Clone)]
pub struct QueueMetricsData {
    /// Queue name.
    pub queue: String,
    /// Timestamp when metrics were collected.
    pub timestamp: u64,
    /// Uptime in milliseconds.
    pub uptime: u64,
    /// Current queue depth.
    pub depth: i64,
    /// Throughput metrics.
    pub throughput: ThroughputMetrics,
    /// Latency metrics.
    pub latency: LatencyMetrics,
    /// Consumer lag.
    pub consumer_lag: i64,
    /// Messages in flight.
    pub in_flight: i64,
    /// Total errors.
    pub errors: u64,
}

/// Metrics collector for a queue instance.
pub struct QueueMetrics {
    queue_name: String,
    created_at: Instant,

    // Depth gauge
    depth: Gauge,

    // Throughput counters
    enqueued: Counter,
    dequeued: Counter,
    acknowledged: Counter,
    rejected: Counter,
    dead_lettered: Counter,

    // Latency histograms
    enqueue_latency: LatencyHistogram,
    dequeue_latency: LatencyHistogram,
    processing_latency: LatencyHistogram,

    // Consumer lag and in-flight
    consumer_lag: Gauge,
    in_flight: Gauge,

    // Errors
    errors: Counter,

    // Rate tracking
    last_rate_calculation: RwLock<Instant>,
    last_enqueued_count: AtomicU64,
    last_dequeued_count: AtomicU64,
    enqueue_rate: RwLock<f64>,
    dequeue_rate: RwLock<f64>,
}

impl QueueMetrics {
    /// Creates a new `QueueMetrics` collector.
    #[must_use]
    pub fn new(queue_name: impl Into<String>) -> Self {
        Self {
            queue_name: queue_name.into(),
            created_at: Instant::now(),
            depth: Gauge::new("links_queue_depth", "Current number of messages in the queue"),
            enqueued: Counter::new("links_queue_messages_enqueued_total", "Total messages enqueued"),
            dequeued: Counter::new("links_queue_messages_dequeued_total", "Total messages dequeued"),
            acknowledged: Counter::new("links_queue_messages_acknowledged_total", "Total messages acknowledged"),
            rejected: Counter::new("links_queue_messages_rejected_total", "Total messages rejected"),
            dead_lettered: Counter::new("links_queue_messages_dead_lettered_total", "Total messages dead-lettered"),
            enqueue_latency: LatencyHistogram::new(),
            dequeue_latency: LatencyHistogram::new(),
            processing_latency: LatencyHistogram::new(),
            consumer_lag: Gauge::new("links_queue_consumer_lag", "Consumer lag"),
            in_flight: Gauge::new("links_queue_in_flight", "Messages in flight"),
            errors: Counter::new("links_queue_errors_total", "Total errors"),
            last_rate_calculation: RwLock::new(Instant::now()),
            last_enqueued_count: AtomicU64::new(0),
            last_dequeued_count: AtomicU64::new(0),
            enqueue_rate: RwLock::new(0.0),
            dequeue_rate: RwLock::new(0.0),
        }
    }

    /// Gets the queue name.
    #[must_use]
    pub fn queue_name(&self) -> &str {
        &self.queue_name
    }

    /// Records an enqueue operation.
    pub fn record_enqueue(&self, latency_ms: Option<f64>) {
        self.enqueued.inc();
        self.depth.inc();
        if let Some(latency) = latency_ms {
            self.enqueue_latency.observe(latency);
        }
    }

    /// Records a dequeue operation.
    pub fn record_dequeue(&self, latency_ms: Option<f64>) {
        self.dequeued.inc();
        self.depth.dec();
        self.in_flight.inc();
        if let Some(latency) = latency_ms {
            self.dequeue_latency.observe(latency);
        }
    }

    /// Records an acknowledge operation.
    pub fn record_acknowledge(&self, processing_time_ms: Option<f64>) {
        self.acknowledged.inc();
        self.in_flight.dec();
        if let Some(time) = processing_time_ms {
            self.processing_latency.observe(time);
        }
    }

    /// Records a reject operation.
    pub fn record_reject(&self, requeued: bool) {
        self.rejected.inc();
        self.in_flight.dec();
        if requeued {
            self.depth.inc();
        }
    }

    /// Records a dead letter operation.
    pub fn record_dead_letter(&self) {
        self.dead_lettered.inc();
        self.in_flight.dec();
    }

    /// Records an error.
    pub fn record_error(&self) {
        self.errors.inc();
    }

    /// Sets the queue depth directly.
    pub fn set_depth(&self, depth: i64) {
        self.depth.set(depth);
    }

    /// Sets the in-flight count directly.
    pub fn set_in_flight(&self, count: i64) {
        self.in_flight.set(count);
    }

    /// Sets the consumer lag.
    pub fn set_consumer_lag(&self, lag: i64) {
        self.consumer_lag.set(lag);
    }

    /// Calculates throughput rates.
    pub fn calculate_rates(&self) {
        let now = Instant::now();
        let mut last_calc = self.last_rate_calculation.write().unwrap();
        let elapsed = now.duration_since(*last_calc).as_secs_f64();

        if elapsed > 0.0 {
            let current_enqueued = self.enqueued.value();
            let current_dequeued = self.dequeued.value();
            let last_enqueued = self.last_enqueued_count.load(Ordering::Relaxed);
            let last_dequeued = self.last_dequeued_count.load(Ordering::Relaxed);

            let enqueue_delta = current_enqueued.saturating_sub(last_enqueued);
            let dequeue_delta = current_dequeued.saturating_sub(last_dequeued);

            *self.enqueue_rate.write().unwrap() = enqueue_delta as f64 / elapsed;
            *self.dequeue_rate.write().unwrap() = dequeue_delta as f64 / elapsed;

            *last_calc = now;
            self.last_enqueued_count.store(current_enqueued, Ordering::Relaxed);
            self.last_dequeued_count.store(current_dequeued, Ordering::Relaxed);
        }
    }

    /// Gets all metrics as a structured object.
    #[must_use]
    pub fn get_metrics(&self) -> QueueMetricsData {
        self.calculate_rates();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        QueueMetricsData {
            queue: self.queue_name.clone(),
            timestamp: now,
            uptime: self.created_at.elapsed().as_millis() as u64,
            depth: self.depth.value(),
            throughput: ThroughputMetrics {
                enqueued: self.enqueued.value(),
                dequeued: self.dequeued.value(),
                acknowledged: self.acknowledged.value(),
                rejected: self.rejected.value(),
                dead_lettered: self.dead_lettered.value(),
                enqueue_rate: *self.enqueue_rate.read().unwrap(),
                dequeue_rate: *self.dequeue_rate.read().unwrap(),
            },
            latency: LatencyMetrics {
                enqueue: self.enqueue_latency.get_stats(),
                dequeue: self.dequeue_latency.get_stats(),
                processing: self.processing_latency.get_stats(),
            },
            consumer_lag: self.consumer_lag.value(),
            in_flight: self.in_flight.value(),
            errors: self.errors.value(),
        }
    }

    /// Resets all metrics.
    pub fn reset(&self) {
        self.depth.reset();
        self.enqueued.reset();
        self.dequeued.reset();
        self.acknowledged.reset();
        self.rejected.reset();
        self.dead_lettered.reset();
        self.enqueue_latency.reset();
        self.dequeue_latency.reset();
        self.processing_latency.reset();
        self.consumer_lag.reset();
        self.in_flight.reset();
        self.errors.reset();
        *self.last_rate_calculation.write().unwrap() = Instant::now();
        self.last_enqueued_count.store(0, Ordering::Relaxed);
        self.last_dequeued_count.store(0, Ordering::Relaxed);
        *self.enqueue_rate.write().unwrap() = 0.0;
        *self.dequeue_rate.write().unwrap() = 0.0;
    }
}

/// Global metrics registry for managing multiple queue metrics.
pub struct MetricsRegistry {
    queues: RwLock<HashMap<String, Arc<QueueMetrics>>>,
    counters: RwLock<HashMap<String, Arc<Counter>>>,
    gauges: RwLock<HashMap<String, Arc<Gauge>>>,
    created_at: Instant,
}

impl MetricsRegistry {
    /// Creates a new `MetricsRegistry`.
    #[must_use]
    pub fn new() -> Self {
        Self {
            queues: RwLock::new(HashMap::new()),
            counters: RwLock::new(HashMap::new()),
            gauges: RwLock::new(HashMap::new()),
            created_at: Instant::now(),
        }
    }

    /// Gets or creates metrics for a queue.
    pub fn get_queue_metrics(&self, queue_name: &str) -> Arc<QueueMetrics> {
        let mut queues = self.queues.write().unwrap();
        queues
            .entry(queue_name.to_string())
            .or_insert_with(|| Arc::new(QueueMetrics::new(queue_name)))
            .clone()
    }

    /// Removes metrics for a queue.
    pub fn remove_queue_metrics(&self, queue_name: &str) -> bool {
        self.queues.write().unwrap().remove(queue_name).is_some()
    }

    /// Gets or creates a global counter.
    pub fn counter(&self, name: &str, help: &str) -> Arc<Counter> {
        let mut counters = self.counters.write().unwrap();
        counters
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(Counter::new(name, help)))
            .clone()
    }

    /// Gets or creates a global gauge.
    pub fn gauge(&self, name: &str, help: &str) -> Arc<Gauge> {
        let mut gauges = self.gauges.write().unwrap();
        gauges
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(Gauge::new(name, help)))
            .clone()
    }

    /// Gets all queue metrics.
    #[must_use]
    pub fn get_all_queue_metrics(&self) -> HashMap<String, QueueMetricsData> {
        let queues = self.queues.read().unwrap();
        queues
            .iter()
            .map(|(name, metrics)| (name.clone(), metrics.get_metrics()))
            .collect()
    }

    /// Gets the registry uptime.
    #[must_use]
    pub fn uptime(&self) -> Duration {
        self.created_at.elapsed()
    }

    /// Resets all metrics.
    pub fn reset(&self) {
        for metrics in self.queues.read().unwrap().values() {
            metrics.reset();
        }
        for counter in self.counters.read().unwrap().values() {
            counter.reset();
        }
        for gauge in self.gauges.read().unwrap().values() {
            gauge.reset();
        }
    }
}

impl Default for MetricsRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_counter() {
        let counter = Counter::new("test_counter", "Test counter");
        assert_eq!(counter.value(), 0);

        counter.inc();
        assert_eq!(counter.value(), 1);

        counter.inc_by(5);
        assert_eq!(counter.value(), 6);

        counter.reset();
        assert_eq!(counter.value(), 0);
    }

    #[test]
    fn test_gauge() {
        let gauge = Gauge::new("test_gauge", "Test gauge");
        assert_eq!(gauge.value(), 0);

        gauge.set(100);
        assert_eq!(gauge.value(), 100);

        gauge.inc();
        assert_eq!(gauge.value(), 101);

        gauge.dec();
        assert_eq!(gauge.value(), 100);

        gauge.reset();
        assert_eq!(gauge.value(), 0);
    }

    #[test]
    fn test_histogram() {
        let hist = LatencyHistogram::new();

        for i in 1..=100 {
            hist.observe(i as f64);
        }

        let stats = hist.get_stats();
        assert_eq!(stats.count, 100);
        assert_eq!(stats.min, 1.0);
        assert_eq!(stats.max, 100.0);
        assert_eq!(stats.p50, 50.0);
        assert_eq!(stats.p99, 99.0);
    }

    #[test]
    fn test_queue_metrics() {
        let metrics = QueueMetrics::new("test_queue");

        metrics.record_enqueue(Some(5.0));
        metrics.record_enqueue(Some(10.0));
        metrics.record_dequeue(Some(3.0));
        metrics.record_acknowledge(Some(100.0));

        let data = metrics.get_metrics();
        assert_eq!(data.queue, "test_queue");
        assert_eq!(data.depth, 1);
        assert_eq!(data.throughput.enqueued, 2);
        assert_eq!(data.throughput.dequeued, 1);
        assert_eq!(data.throughput.acknowledged, 1);
        assert_eq!(data.in_flight, 0);
    }

    #[test]
    fn test_registry() {
        let registry = MetricsRegistry::new();

        let m1 = registry.get_queue_metrics("queue1");
        let m2 = registry.get_queue_metrics("queue1");

        // Should be the same instance
        assert!(Arc::ptr_eq(&m1, &m2));

        m1.record_enqueue(None);

        let all = registry.get_all_queue_metrics();
        assert_eq!(all.get("queue1").unwrap().throughput.enqueued, 1);
    }
}
