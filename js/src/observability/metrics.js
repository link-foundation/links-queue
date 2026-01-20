/**
 * Metrics collection module for links-queue.
 *
 * Provides comprehensive metrics collection including queue depth, throughput,
 * latency histograms, consumer lag, error rates, and resource usage.
 *
 * @module observability/metrics
 *
 * @see REQUIREMENTS.md - REQ-OBS-001 through REQ-OBS-004
 */

/**
 * Histogram bucket boundaries for latency tracking (in milliseconds).
 * Follows Prometheus-style exponential buckets.
 */
export const DEFAULT_LATENCY_BUCKETS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/**
 * A histogram for tracking latency distributions.
 * Supports percentile calculations (p50, p90, p95, p99).
 */
export class LatencyHistogram {
  /**
   * Creates a new LatencyHistogram.
   *
   * @param {Object} [options] - Configuration options
   * @param {number[]} [options.buckets] - Bucket boundaries in milliseconds
   * @param {number} [options.maxSamples] - Maximum samples to keep for percentile calculation
   */
  constructor(options = {}) {
    this._buckets = options.buckets ?? DEFAULT_LATENCY_BUCKETS;
    this._maxSamples = options.maxSamples ?? 10000;
    this._counts = new Array(this._buckets.length + 1).fill(0);
    this._sum = 0;
    this._count = 0;
    this._samples = [];
    this._min = Number.MAX_VALUE;
    this._max = 0;
  }

  /**
   * Records a latency observation.
   *
   * @param {number} value - Latency value in milliseconds
   */
  observe(value) {
    // Find the bucket
    let bucketIndex = this._buckets.length;
    for (let i = 0; i < this._buckets.length; i++) {
      if (value <= this._buckets[i]) {
        bucketIndex = i;
        break;
      }
    }
    this._counts[bucketIndex]++;
    this._sum += value;
    this._count++;

    // Track min/max
    if (value < this._min) {
      this._min = value;
    }
    if (value > this._max) {
      this._max = value;
    }

    // Store sample for percentile calculation
    this._samples.push(value);
    if (this._samples.length > this._maxSamples) {
      this._samples.shift();
    }
  }

  /**
   * Calculates a percentile value.
   *
   * @param {number} p - Percentile (0-100)
   * @returns {number} The percentile value, or 0 if no samples
   */
  percentile(p) {
    if (this._samples.length === 0) {
      return 0;
    }

    const sorted = [...this._samples].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Gets histogram statistics.
   *
   * @returns {Object} Statistics including count, sum, mean, percentiles
   */
  getStats() {
    return {
      count: this._count,
      sum: this._sum,
      mean: this._count > 0 ? this._sum / this._count : 0,
      min: this._count > 0 ? this._min : 0,
      max: this._max,
      p50: this.percentile(50),
      p90: this.percentile(90),
      p95: this.percentile(95),
      p99: this.percentile(99),
      buckets: this._buckets.map((boundary, i) => ({
        le: boundary,
        count: this._counts[i],
      })),
    };
  }

  /**
   * Resets the histogram.
   */
  reset() {
    this._counts.fill(0);
    this._sum = 0;
    this._count = 0;
    this._samples = [];
    this._min = Number.MAX_VALUE;
    this._max = 0;
  }
}

/**
 * A counter metric that only increments.
 */
export class Counter {
  /**
   * Creates a new Counter.
   *
   * @param {Object} [options] - Configuration options
   * @param {string} [options.name] - Counter name
   * @param {string} [options.help] - Counter description
   */
  constructor(options = {}) {
    this._name = options.name ?? 'counter';
    this._help = options.help ?? '';
    this._value = 0;
    this._createdAt = Date.now();
  }

  /**
   * Increments the counter.
   *
   * @param {number} [amount=1] - Amount to increment by
   */
  inc(amount = 1) {
    if (amount < 0) {
      throw new Error('Counter can only be incremented');
    }
    this._value += amount;
  }

  /**
   * Gets the current counter value.
   *
   * @returns {number} Current value
   */
  get value() {
    return this._value;
  }

  /**
   * Gets counter metadata.
   *
   * @returns {Object} Counter metadata
   */
  getMetadata() {
    return {
      name: this._name,
      help: this._help,
      value: this._value,
      createdAt: this._createdAt,
    };
  }

  /**
   * Resets the counter to zero.
   */
  reset() {
    this._value = 0;
    this._createdAt = Date.now();
  }
}

/**
 * A gauge metric that can go up or down.
 */
export class Gauge {
  /**
   * Creates a new Gauge.
   *
   * @param {Object} [options] - Configuration options
   * @param {string} [options.name] - Gauge name
   * @param {string} [options.help] - Gauge description
   * @param {number} [options.initialValue] - Initial value
   */
  constructor(options = {}) {
    this._name = options.name ?? 'gauge';
    this._help = options.help ?? '';
    this._value = options.initialValue ?? 0;
    this._lastUpdated = Date.now();
  }

  /**
   * Sets the gauge value.
   *
   * @param {number} value - New value
   */
  set(value) {
    this._value = value;
    this._lastUpdated = Date.now();
  }

  /**
   * Increments the gauge.
   *
   * @param {number} [amount=1] - Amount to increment by
   */
  inc(amount = 1) {
    this._value += amount;
    this._lastUpdated = Date.now();
  }

  /**
   * Decrements the gauge.
   *
   * @param {number} [amount=1] - Amount to decrement by
   */
  dec(amount = 1) {
    this._value -= amount;
    this._lastUpdated = Date.now();
  }

  /**
   * Gets the current gauge value.
   *
   * @returns {number} Current value
   */
  get value() {
    return this._value;
  }

  /**
   * Gets gauge metadata.
   *
   * @returns {Object} Gauge metadata
   */
  getMetadata() {
    return {
      name: this._name,
      help: this._help,
      value: this._value,
      lastUpdated: this._lastUpdated,
    };
  }

  /**
   * Resets the gauge to zero.
   */
  reset() {
    this._value = 0;
    this._lastUpdated = Date.now();
  }
}

/**
 * Metrics collector for a queue instance.
 * Tracks all observability metrics for the queue.
 */
export class QueueMetrics {
  /**
   * Creates a new QueueMetrics collector.
   *
   * @param {Object} [options] - Configuration options
   * @param {string} [options.queueName] - Name of the queue being monitored
   * @param {number[]} [options.latencyBuckets] - Custom latency bucket boundaries
   */
  constructor(options = {}) {
    this._queueName = options.queueName ?? 'default';
    this._createdAt = Date.now();

    // Queue depth gauge (REQ-OBS-001)
    this._depth = new Gauge({
      name: 'links_queue_depth',
      help: 'Current number of messages in the queue',
    });

    // Throughput counters (REQ-OBS-002)
    this._enqueued = new Counter({
      name: 'links_queue_messages_enqueued_total',
      help: 'Total number of messages enqueued',
    });
    this._dequeued = new Counter({
      name: 'links_queue_messages_dequeued_total',
      help: 'Total number of messages dequeued',
    });
    this._acknowledged = new Counter({
      name: 'links_queue_messages_acknowledged_total',
      help: 'Total number of messages acknowledged',
    });
    this._rejected = new Counter({
      name: 'links_queue_messages_rejected_total',
      help: 'Total number of messages rejected',
    });
    this._deadLettered = new Counter({
      name: 'links_queue_messages_dead_lettered_total',
      help: 'Total number of messages moved to dead letter queue',
    });

    // Latency histograms (REQ-OBS-003)
    const latencyBuckets = options.latencyBuckets ?? DEFAULT_LATENCY_BUCKETS;
    this._enqueueLatency = new LatencyHistogram({ buckets: latencyBuckets });
    this._dequeueLatency = new LatencyHistogram({ buckets: latencyBuckets });
    this._processingLatency = new LatencyHistogram({ buckets: latencyBuckets });

    // Consumer lag gauge (REQ-OBS-004)
    this._consumerLag = new Gauge({
      name: 'links_queue_consumer_lag',
      help: 'Number of messages waiting to be processed',
    });

    // In-flight messages
    this._inFlight = new Gauge({
      name: 'links_queue_in_flight',
      help: 'Number of messages currently being processed',
    });

    // Error counters
    this._errors = new Counter({
      name: 'links_queue_errors_total',
      help: 'Total number of errors',
    });

    // Throughput rate tracking
    this._lastRateCalculation = Date.now();
    this._lastEnqueuedCount = 0;
    this._lastDequeuedCount = 0;
    this._enqueueRate = 0;
    this._dequeueRate = 0;
  }

  /**
   * Gets the queue name.
   *
   * @returns {string} Queue name
   */
  get queueName() {
    return this._queueName;
  }

  /**
   * Records an enqueue operation.
   *
   * @param {number} [latencyMs] - Latency in milliseconds
   */
  recordEnqueue(latencyMs = 0) {
    this._enqueued.inc();
    this._depth.inc();
    if (latencyMs > 0) {
      this._enqueueLatency.observe(latencyMs);
    }
  }

  /**
   * Records a dequeue operation.
   *
   * @param {number} [latencyMs] - Latency in milliseconds
   */
  recordDequeue(latencyMs = 0) {
    this._dequeued.inc();
    this._depth.dec();
    this._inFlight.inc();
    if (latencyMs > 0) {
      this._dequeueLatency.observe(latencyMs);
    }
  }

  /**
   * Records an acknowledge operation.
   *
   * @param {number} [processingTimeMs] - Processing time in milliseconds
   */
  recordAcknowledge(processingTimeMs = 0) {
    this._acknowledged.inc();
    this._inFlight.dec();
    if (processingTimeMs > 0) {
      this._processingLatency.observe(processingTimeMs);
    }
  }

  /**
   * Records a reject operation.
   *
   * @param {boolean} [requeued=false] - Whether the message was requeued
   */
  recordReject(requeued = false) {
    this._rejected.inc();
    this._inFlight.dec();
    if (requeued) {
      this._depth.inc();
    }
  }

  /**
   * Records a dead letter operation.
   */
  recordDeadLetter() {
    this._deadLettered.inc();
    this._inFlight.dec();
  }

  /**
   * Records an error.
   */
  recordError() {
    this._errors.inc();
  }

  /**
   * Updates the queue depth directly.
   *
   * @param {number} depth - Current queue depth
   */
  setDepth(depth) {
    this._depth.set(depth);
  }

  /**
   * Updates the in-flight count directly.
   *
   * @param {number} count - Current in-flight count
   */
  setInFlight(count) {
    this._inFlight.set(count);
  }

  /**
   * Updates the consumer lag.
   *
   * @param {number} lag - Current consumer lag
   */
  setConsumerLag(lag) {
    this._consumerLag.set(lag);
  }

  /**
   * Calculates throughput rates (messages per second).
   * Should be called periodically.
   */
  calculateRates() {
    const now = Date.now();
    const elapsed = (now - this._lastRateCalculation) / 1000; // seconds

    if (elapsed > 0) {
      const enqueuedDelta = this._enqueued.value - this._lastEnqueuedCount;
      const dequeuedDelta = this._dequeued.value - this._lastDequeuedCount;

      this._enqueueRate = enqueuedDelta / elapsed;
      this._dequeueRate = dequeuedDelta / elapsed;

      this._lastRateCalculation = now;
      this._lastEnqueuedCount = this._enqueued.value;
      this._lastDequeuedCount = this._dequeued.value;
    }
  }

  /**
   * Gets all metrics as a structured object.
   *
   * @returns {Object} All metrics
   */
  getMetrics() {
    this.calculateRates();

    return {
      queue: this._queueName,
      timestamp: Date.now(),
      uptime: Date.now() - this._createdAt,

      // Queue depth (REQ-OBS-001)
      depth: this._depth.value,

      // Throughput (REQ-OBS-002)
      throughput: {
        enqueued: this._enqueued.value,
        dequeued: this._dequeued.value,
        acknowledged: this._acknowledged.value,
        rejected: this._rejected.value,
        deadLettered: this._deadLettered.value,
        enqueueRate: this._enqueueRate,
        dequeueRate: this._dequeueRate,
      },

      // Latency histograms (REQ-OBS-003)
      latency: {
        enqueue: this._enqueueLatency.getStats(),
        dequeue: this._dequeueLatency.getStats(),
        processing: this._processingLatency.getStats(),
      },

      // Consumer lag (REQ-OBS-004)
      consumerLag: this._consumerLag.value,
      inFlight: this._inFlight.value,

      // Errors
      errors: this._errors.value,
    };
  }

  /**
   * Resets all metrics.
   */
  reset() {
    this._depth.reset();
    this._enqueued.reset();
    this._dequeued.reset();
    this._acknowledged.reset();
    this._rejected.reset();
    this._deadLettered.reset();
    this._enqueueLatency.reset();
    this._dequeueLatency.reset();
    this._processingLatency.reset();
    this._consumerLag.reset();
    this._inFlight.reset();
    this._errors.reset();
    this._lastRateCalculation = Date.now();
    this._lastEnqueuedCount = 0;
    this._lastDequeuedCount = 0;
    this._enqueueRate = 0;
    this._dequeueRate = 0;
    this._createdAt = Date.now();
  }
}

/**
 * Global metrics registry for managing multiple queue metrics.
 */
export class MetricsRegistry {
  /**
   * Creates a new MetricsRegistry.
   */
  constructor() {
    /** @type {Map<string, QueueMetrics>} */
    this._queues = new Map();
    this._createdAt = Date.now();

    // Global counters
    this._globalCounters = new Map();
    this._globalGauges = new Map();
  }

  /**
   * Gets or creates metrics for a queue.
   *
   * @param {string} queueName - Queue name
   * @param {Object} [options] - Metrics options
   * @returns {QueueMetrics} Queue metrics instance
   */
  getQueueMetrics(queueName, options = {}) {
    if (!this._queues.has(queueName)) {
      this._queues.set(queueName, new QueueMetrics({ ...options, queueName }));
    }
    return this._queues.get(queueName);
  }

  /**
   * Removes metrics for a queue.
   *
   * @param {string} queueName - Queue name
   * @returns {boolean} True if removed
   */
  removeQueueMetrics(queueName) {
    return this._queues.delete(queueName);
  }

  /**
   * Gets a global counter by name.
   *
   * @param {string} name - Counter name
   * @param {Object} [options] - Counter options
   * @returns {Counter} Counter instance
   */
  counter(name, options = {}) {
    if (!this._globalCounters.has(name)) {
      this._globalCounters.set(name, new Counter({ ...options, name }));
    }
    return this._globalCounters.get(name);
  }

  /**
   * Gets a global gauge by name.
   *
   * @param {string} name - Gauge name
   * @param {Object} [options] - Gauge options
   * @returns {Gauge} Gauge instance
   */
  gauge(name, options = {}) {
    if (!this._globalGauges.has(name)) {
      this._globalGauges.set(name, new Gauge({ ...options, name }));
    }
    return this._globalGauges.get(name);
  }

  /**
   * Gets all metrics from all queues.
   *
   * @returns {Object} All metrics
   */
  getAllMetrics() {
    const queues = {};
    for (const [name, metrics] of this._queues) {
      queues[name] = metrics.getMetrics();
    }

    const counters = {};
    for (const [name, counter] of this._globalCounters) {
      counters[name] = counter.value;
    }

    const gauges = {};
    for (const [name, gauge] of this._globalGauges) {
      gauges[name] = gauge.value;
    }

    return {
      timestamp: Date.now(),
      uptime: Date.now() - this._createdAt,
      queues,
      counters,
      gauges,
    };
  }

  /**
   * Resets all metrics.
   */
  reset() {
    for (const metrics of this._queues.values()) {
      metrics.reset();
    }
    for (const counter of this._globalCounters.values()) {
      counter.reset();
    }
    for (const gauge of this._globalGauges.values()) {
      gauge.reset();
    }
    this._createdAt = Date.now();
  }
}

// Default global registry instance
export const defaultRegistry = new MetricsRegistry();
