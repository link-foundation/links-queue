/**
 * Prometheus metrics exporter for links-queue.
 *
 * Provides Prometheus-compatible metrics export in text format,
 * following the Prometheus exposition format specification.
 *
 * @module observability/prometheus
 *
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/
 * @see REQUIREMENTS.md - REQ-OBS-001 through REQ-OBS-004
 */

import { defaultRegistry } from './metrics.js';

/**
 * Formats a metric name for Prometheus.
 * Converts to lowercase and replaces invalid characters.
 *
 * @param {string} name - Original metric name
 * @returns {string} Prometheus-compatible name
 */
const formatMetricName = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_:]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '')
    .replace(/_$/, '');

/**
 * Escapes label values for Prometheus format.
 *
 * @param {string} value - Label value
 * @returns {string} Escaped value
 */
const escapeLabelValue = (value) =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');

/**
 * Formats labels as Prometheus label string.
 *
 * @param {Object} labels - Label key-value pairs
 * @returns {string} Formatted label string
 */
const formatLabels = (labels) => {
  if (!labels || Object.keys(labels).length === 0) {
    return '';
  }
  const pairs = Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',');
  return `{${pairs}}`;
};

/**
 * Prometheus exporter for links-queue metrics.
 */
export class PrometheusExporter {
  /**
   * Creates a new PrometheusExporter.
   *
   * @param {Object} [options] - Configuration options
   * @param {import('./metrics.js').MetricsRegistry} [options.registry] - Metrics registry to export
   * @param {string} [options.prefix] - Metric name prefix
   * @param {Object} [options.defaultLabels] - Default labels to add to all metrics
   */
  constructor(options = {}) {
    this._registry = options.registry ?? defaultRegistry;
    this._prefix = options.prefix ?? '';
    this._defaultLabels = options.defaultLabels ?? {};
  }

  /**
   * Gets the metrics registry.
   *
   * @returns {import('./metrics.js').MetricsRegistry} Registry
   */
  get registry() {
    return this._registry;
  }

  /**
   * Sets the metrics registry.
   *
   * @param {import('./metrics.js').MetricsRegistry} registry - New registry
   */
  set registry(registry) {
    this._registry = registry;
  }

  /**
   * Formats a counter metric for Prometheus.
   *
   * @param {string} name - Metric name
   * @param {number} value - Counter value
   * @param {string} help - Help text
   * @param {Object} [labels] - Additional labels
   * @returns {string} Prometheus format output
   * @private
   */
  _formatCounter(name, value, help, labels = {}) {
    const metricName = formatMetricName(
      this._prefix ? `${this._prefix}_${name}` : name
    );
    const allLabels = { ...this._defaultLabels, ...labels };
    const labelStr = formatLabels(allLabels);

    return [
      `# HELP ${metricName} ${help}`,
      `# TYPE ${metricName} counter`,
      `${metricName}${labelStr} ${value}`,
    ].join('\n');
  }

  /**
   * Formats a gauge metric for Prometheus.
   *
   * @param {string} name - Metric name
   * @param {number} value - Gauge value
   * @param {string} help - Help text
   * @param {Object} [labels] - Additional labels
   * @returns {string} Prometheus format output
   * @private
   */
  _formatGauge(name, value, help, labels = {}) {
    const metricName = formatMetricName(
      this._prefix ? `${this._prefix}_${name}` : name
    );
    const allLabels = { ...this._defaultLabels, ...labels };
    const labelStr = formatLabels(allLabels);

    return [
      `# HELP ${metricName} ${help}`,
      `# TYPE ${metricName} gauge`,
      `${metricName}${labelStr} ${value}`,
    ].join('\n');
  }

  /**
   * Formats a histogram metric for Prometheus.
   *
   * @param {string} name - Metric name
   * @param {Object} stats - Histogram stats from LatencyHistogram.getStats()
   * @param {string} help - Help text
   * @param {Object} [labels] - Additional labels
   * @returns {string} Prometheus format output
   * @private
   */
  _formatHistogram(name, stats, help, labels = {}) {
    const metricName = formatMetricName(
      this._prefix ? `${this._prefix}_${name}` : name
    );
    const allLabels = { ...this._defaultLabels, ...labels };
    const lines = [
      `# HELP ${metricName} ${help}`,
      `# TYPE ${metricName} histogram`,
    ];

    // Bucket values (cumulative)
    let cumulative = 0;
    for (const bucket of stats.buckets) {
      cumulative += bucket.count;
      const bucketLabels = { ...allLabels, le: String(bucket.le) };
      lines.push(
        `${metricName}_bucket${formatLabels(bucketLabels)} ${cumulative}`
      );
    }

    // +Inf bucket
    const infLabels = { ...allLabels, le: '+Inf' };
    lines.push(`${metricName}_bucket${formatLabels(infLabels)} ${stats.count}`);

    // Sum and count
    const labelStr = formatLabels(allLabels);
    lines.push(`${metricName}_sum${labelStr} ${stats.sum}`);
    lines.push(`${metricName}_count${labelStr} ${stats.count}`);

    return lines.join('\n');
  }

  /**
   * Formats a summary metric for Prometheus (for percentiles).
   *
   * @param {string} name - Metric name
   * @param {Object} stats - Histogram stats with percentiles
   * @param {string} help - Help text
   * @param {Object} [labels] - Additional labels
   * @returns {string} Prometheus format output
   * @private
   */
  _formatSummary(name, stats, help, labels = {}) {
    const metricName = formatMetricName(
      this._prefix ? `${this._prefix}_${name}` : name
    );
    const allLabels = { ...this._defaultLabels, ...labels };
    const lines = [
      `# HELP ${metricName} ${help}`,
      `# TYPE ${metricName} summary`,
    ];

    // Quantiles
    const quantiles = [
      { q: '0.5', value: stats.p50 },
      { q: '0.9', value: stats.p90 },
      { q: '0.95', value: stats.p95 },
      { q: '0.99', value: stats.p99 },
    ];

    for (const { q, value } of quantiles) {
      const quantileLabels = { ...allLabels, quantile: q };
      lines.push(`${metricName}${formatLabels(quantileLabels)} ${value}`);
    }

    // Sum and count
    const labelStr = formatLabels(allLabels);
    lines.push(`${metricName}_sum${labelStr} ${stats.sum}`);
    lines.push(`${metricName}_count${labelStr} ${stats.count}`);

    return lines.join('\n');
  }

  /**
   * Exports queue metrics in Prometheus format.
   *
   * @param {string} queueName - Queue name
   * @param {Object} metrics - Metrics from QueueMetrics.getMetrics()
   * @returns {string} Prometheus format output
   * @private
   */
  _exportQueueMetrics(queueName, metrics) {
    const labels = { queue: queueName };
    const parts = [];

    // Queue depth (gauge)
    parts.push(
      this._formatGauge(
        'links_queue_depth',
        metrics.depth,
        'Current number of messages in the queue',
        labels
      )
    );

    // Throughput counters
    parts.push(
      this._formatCounter(
        'links_queue_messages_enqueued_total',
        metrics.throughput.enqueued,
        'Total number of messages enqueued',
        labels
      )
    );
    parts.push(
      this._formatCounter(
        'links_queue_messages_dequeued_total',
        metrics.throughput.dequeued,
        'Total number of messages dequeued',
        labels
      )
    );
    parts.push(
      this._formatCounter(
        'links_queue_messages_acknowledged_total',
        metrics.throughput.acknowledged,
        'Total number of messages acknowledged',
        labels
      )
    );
    parts.push(
      this._formatCounter(
        'links_queue_messages_rejected_total',
        metrics.throughput.rejected,
        'Total number of messages rejected',
        labels
      )
    );
    parts.push(
      this._formatCounter(
        'links_queue_messages_dead_lettered_total',
        metrics.throughput.deadLettered,
        'Total number of messages moved to dead letter queue',
        labels
      )
    );

    // Throughput rates (gauges)
    parts.push(
      this._formatGauge(
        'links_queue_enqueue_rate',
        metrics.throughput.enqueueRate,
        'Current enqueue rate (messages/second)',
        labels
      )
    );
    parts.push(
      this._formatGauge(
        'links_queue_dequeue_rate',
        metrics.throughput.dequeueRate,
        'Current dequeue rate (messages/second)',
        labels
      )
    );

    // Latency histograms
    parts.push(
      this._formatHistogram(
        'links_queue_enqueue_duration_milliseconds',
        metrics.latency.enqueue,
        'Enqueue operation duration in milliseconds',
        labels
      )
    );
    parts.push(
      this._formatHistogram(
        'links_queue_dequeue_duration_milliseconds',
        metrics.latency.dequeue,
        'Dequeue operation duration in milliseconds',
        labels
      )
    );
    parts.push(
      this._formatHistogram(
        'links_queue_processing_duration_milliseconds',
        metrics.latency.processing,
        'Message processing duration in milliseconds',
        labels
      )
    );

    // Consumer lag and in-flight (gauges)
    parts.push(
      this._formatGauge(
        'links_queue_consumer_lag',
        metrics.consumerLag,
        'Number of messages waiting to be processed',
        labels
      )
    );
    parts.push(
      this._formatGauge(
        'links_queue_in_flight',
        metrics.inFlight,
        'Number of messages currently being processed',
        labels
      )
    );

    // Errors
    parts.push(
      this._formatCounter(
        'links_queue_errors_total',
        metrics.errors,
        'Total number of errors',
        labels
      )
    );

    return parts.join('\n\n');
  }

  /**
   * Exports all metrics in Prometheus text format.
   *
   * @returns {string} Prometheus exposition format output
   */
  export() {
    const allMetrics = this._registry.getAllMetrics();
    const parts = [];

    // Process info
    parts.push(
      this._formatGauge(
        'links_queue_uptime_seconds',
        Math.floor(allMetrics.uptime / 1000),
        'Uptime of the links-queue process in seconds'
      )
    );

    // Queue metrics
    for (const [queueName, metrics] of Object.entries(allMetrics.queues)) {
      parts.push(this._exportQueueMetrics(queueName, metrics));
    }

    // Global counters
    for (const [name, value] of Object.entries(allMetrics.counters)) {
      parts.push(this._formatCounter(name, value, `Global counter: ${name}`));
    }

    // Global gauges
    for (const [name, value] of Object.entries(allMetrics.gauges)) {
      parts.push(this._formatGauge(name, value, `Global gauge: ${name}`));
    }

    return `${parts.join('\n\n')}\n`;
  }

  /**
   * Returns the content type for Prometheus metrics.
   *
   * @returns {string} Content type header value
   */
  static contentType() {
    return 'text/plain; version=0.0.4; charset=utf-8';
  }

  /**
   * Static helper to format metrics from a registry.
   *
   * @param {import('./metrics.js').MetricsRegistry} registry - Metrics registry
   * @param {Object} [options] - Exporter options
   * @returns {string} Prometheus format output
   */
  static format(registry, options = {}) {
    const exporter = new PrometheusExporter({ ...options, registry });
    return exporter.export();
  }

  /**
   * Static helper to format metrics from QueueMetrics.
   *
   * @param {Object} metrics - Metrics from QueueMetrics.getMetrics()
   * @param {Object} [options] - Exporter options
   * @returns {string} Prometheus format output
   */
  static formatQueueMetrics(metrics, options = {}) {
    const exporter = new PrometheusExporter(options);
    return exporter._exportQueueMetrics(metrics.queue, metrics);
  }
}

/**
 * Express/Fastify compatible middleware for serving Prometheus metrics.
 *
 * @param {Object} [options] - Middleware options
 * @param {import('./metrics.js').MetricsRegistry} [options.registry] - Metrics registry
 * @param {string} [options.path] - Path to serve metrics on (default: /metrics)
 * @returns {Function} Middleware function
 */
export const metricsMiddleware = (options = {}) => {
  const registry = options.registry ?? defaultRegistry;
  const path = options.path ?? '/metrics';
  const exporter = new PrometheusExporter({ ...options, registry });

  return (req, res, next) => {
    // Support both Express-style (req.path) and raw HTTP (req.url)
    const requestPath =
      req.path ?? new URL(req.url, 'http://localhost').pathname;

    if (requestPath === path) {
      const metrics = exporter.export();
      res.setHeader('Content-Type', PrometheusExporter.contentType());
      res.end(metrics);
      return;
    }

    if (typeof next === 'function') {
      next();
    }
  };
};
