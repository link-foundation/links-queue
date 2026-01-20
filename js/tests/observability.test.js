/**
 * Tests for the observability module.
 *
 * Tests metrics collection, Prometheus export, structured logging,
 * and health checks.
 *
 * Note: Uses inline setup/teardown instead of beforeEach/afterEach for Deno compatibility.
 * Deno's node:test compatibility layer doesn't support beforeEach/afterEach.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';

import {
  // Metrics
  Counter,
  Gauge,
  LatencyHistogram,
  QueueMetrics,
  MetricsRegistry,
  DEFAULT_LATENCY_BUCKETS,
  // Prometheus
  PrometheusExporter,
  // Logger
  LogLevel,
  LogContext,
  Logger,
  createQueueLogger,
  // Health
  HealthStatus,
  ComponentChecker,
  HealthChecker,
  createServerHealthChecker,
} from '../src/observability/index.js';

// =============================================================================
// Metrics Tests
// =============================================================================

describe('Metrics', () => {
  describe('Counter', () => {
    it('should start at zero', () => {
      const counter = new Counter({ name: 'test_counter' });
      assert.strictEqual(counter.value, 0);
    });

    it('should increment by 1 by default', () => {
      const counter = new Counter();
      counter.inc();
      assert.strictEqual(counter.value, 1);
    });

    it('should increment by specified amount', () => {
      const counter = new Counter();
      counter.inc(5);
      assert.strictEqual(counter.value, 5);
    });

    it('should throw on negative increment', () => {
      const counter = new Counter();
      assert.throws(() => counter.inc(-1), /only be incremented/);
    });

    it('should provide metadata', () => {
      const counter = new Counter({ name: 'my_counter', help: 'My help text' });
      counter.inc(10);
      const meta = counter.getMetadata();
      assert.strictEqual(meta.name, 'my_counter');
      assert.strictEqual(meta.help, 'My help text');
      assert.strictEqual(meta.value, 10);
      assert.ok(meta.createdAt > 0);
    });

    it('should reset to zero', () => {
      const counter = new Counter();
      counter.inc(100);
      counter.reset();
      assert.strictEqual(counter.value, 0);
    });
  });

  describe('Gauge', () => {
    it('should start at zero by default', () => {
      const gauge = new Gauge();
      assert.strictEqual(gauge.value, 0);
    });

    it('should start at specified initial value', () => {
      const gauge = new Gauge({ initialValue: 42 });
      assert.strictEqual(gauge.value, 42);
    });

    it('should set value', () => {
      const gauge = new Gauge();
      gauge.set(100);
      assert.strictEqual(gauge.value, 100);
    });

    it('should increment', () => {
      const gauge = new Gauge({ initialValue: 10 });
      gauge.inc(5);
      assert.strictEqual(gauge.value, 15);
    });

    it('should decrement', () => {
      const gauge = new Gauge({ initialValue: 10 });
      gauge.dec(3);
      assert.strictEqual(gauge.value, 7);
    });

    it('should allow negative values', () => {
      const gauge = new Gauge();
      gauge.dec(10);
      assert.strictEqual(gauge.value, -10);
    });

    it('should provide metadata', () => {
      const gauge = new Gauge({ name: 'my_gauge', help: 'Gauge help' });
      gauge.set(50);
      const meta = gauge.getMetadata();
      assert.strictEqual(meta.name, 'my_gauge');
      assert.strictEqual(meta.value, 50);
      assert.ok(meta.lastUpdated > 0);
    });

    it('should reset', () => {
      const gauge = new Gauge({ initialValue: 100 });
      gauge.reset();
      assert.strictEqual(gauge.value, 0);
    });
  });

  describe('LatencyHistogram', () => {
    it('should use default buckets', () => {
      const hist = new LatencyHistogram();
      const stats = hist.getStats();
      assert.strictEqual(stats.buckets.length, DEFAULT_LATENCY_BUCKETS.length);
    });

    it('should track observations', () => {
      const hist = new LatencyHistogram();
      hist.observe(10);
      hist.observe(20);
      hist.observe(30);
      const stats = hist.getStats();
      assert.strictEqual(stats.count, 3);
      assert.strictEqual(stats.sum, 60);
      assert.strictEqual(stats.mean, 20);
    });

    it('should track min/max', () => {
      const hist = new LatencyHistogram();
      hist.observe(5);
      hist.observe(100);
      hist.observe(50);
      const stats = hist.getStats();
      assert.strictEqual(stats.min, 5);
      assert.strictEqual(stats.max, 100);
    });

    it('should calculate percentiles', () => {
      const hist = new LatencyHistogram();
      // Add 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        hist.observe(i);
      }
      const stats = hist.getStats();
      assert.strictEqual(stats.p50, 50);
      assert.strictEqual(stats.p90, 90);
      assert.strictEqual(stats.p99, 99);
    });

    it('should bucket observations correctly', () => {
      const hist = new LatencyHistogram({ buckets: [10, 50, 100] });
      hist.observe(5); // bucket 0 (le=10)
      hist.observe(30); // bucket 1 (le=50)
      hist.observe(75); // bucket 2 (le=100)
      hist.observe(150); // bucket 3 (+Inf)
      const stats = hist.getStats();
      assert.strictEqual(stats.buckets[0].count, 1);
      assert.strictEqual(stats.buckets[1].count, 1);
      assert.strictEqual(stats.buckets[2].count, 1);
    });

    it('should reset', () => {
      const hist = new LatencyHistogram();
      hist.observe(10);
      hist.observe(20);
      hist.reset();
      const stats = hist.getStats();
      assert.strictEqual(stats.count, 0);
      assert.strictEqual(stats.sum, 0);
    });
  });

  describe('QueueMetrics', () => {
    it('should track enqueue operations', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.recordEnqueue(5);
      metrics.recordEnqueue(10);
      const data = metrics.getMetrics();
      assert.strictEqual(data.depth, 2);
      assert.strictEqual(data.throughput.enqueued, 2);
    });

    it('should track dequeue operations', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.recordEnqueue();
      metrics.recordEnqueue();
      metrics.recordDequeue(3);
      const data = metrics.getMetrics();
      assert.strictEqual(data.depth, 1);
      assert.strictEqual(data.throughput.dequeued, 1);
      assert.strictEqual(data.inFlight, 1);
    });

    it('should track acknowledge operations', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.recordEnqueue();
      metrics.recordDequeue();
      metrics.recordAcknowledge(100);
      const data = metrics.getMetrics();
      assert.strictEqual(data.throughput.acknowledged, 1);
      assert.strictEqual(data.inFlight, 0);
    });

    it('should track reject operations', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.recordEnqueue();
      metrics.recordDequeue();
      metrics.recordReject(true); // requeued
      const data = metrics.getMetrics();
      assert.strictEqual(data.throughput.rejected, 1);
      assert.strictEqual(data.depth, 1); // requeued
      assert.strictEqual(data.inFlight, 0);
    });

    it('should track dead letter operations', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.recordEnqueue();
      metrics.recordDequeue();
      metrics.recordDeadLetter();
      const data = metrics.getMetrics();
      assert.strictEqual(data.throughput.deadLettered, 1);
      assert.strictEqual(data.inFlight, 0);
    });

    it('should track errors', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.recordError();
      metrics.recordError();
      const data = metrics.getMetrics();
      assert.strictEqual(data.errors, 2);
    });

    it('should allow direct depth setting', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.setDepth(50);
      const data = metrics.getMetrics();
      assert.strictEqual(data.depth, 50);
    });

    it('should include queue name in metrics', () => {
      const metrics = new QueueMetrics({ queueName: 'my_queue' });
      const data = metrics.getMetrics();
      assert.strictEqual(data.queue, 'my_queue');
    });

    it('should track latency histograms', () => {
      const metrics = new QueueMetrics({ queueName: 'test' });
      metrics.recordEnqueue(5);
      metrics.recordDequeue(10);
      metrics.recordAcknowledge(100);
      const data = metrics.getMetrics();
      assert.strictEqual(data.latency.enqueue.count, 1);
      assert.strictEqual(data.latency.dequeue.count, 1);
      assert.strictEqual(data.latency.processing.count, 1);
    });
  });

  describe('MetricsRegistry', () => {
    it('should create queue metrics on demand', () => {
      const registry = new MetricsRegistry();
      const metrics1 = registry.getQueueMetrics('queue1');
      const metrics2 = registry.getQueueMetrics('queue1');
      assert.strictEqual(metrics1, metrics2);
    });

    it('should manage multiple queues', () => {
      const registry = new MetricsRegistry();
      const m1 = registry.getQueueMetrics('queue1');
      const m2 = registry.getQueueMetrics('queue2');
      m1.recordEnqueue();
      m2.recordEnqueue();
      m2.recordEnqueue();
      const all = registry.getAllMetrics();
      assert.strictEqual(all.queues.queue1.throughput.enqueued, 1);
      assert.strictEqual(all.queues.queue2.throughput.enqueued, 2);
    });

    it('should remove queue metrics', () => {
      const registry = new MetricsRegistry();
      registry.getQueueMetrics('queue1');
      assert.strictEqual(registry.removeQueueMetrics('queue1'), true);
      assert.strictEqual(registry.removeQueueMetrics('queue1'), false);
    });

    it('should manage global counters', () => {
      const registry = new MetricsRegistry();
      const counter = registry.counter('requests_total');
      counter.inc(5);
      const all = registry.getAllMetrics();
      assert.strictEqual(all.counters.requests_total, 5);
    });

    it('should manage global gauges', () => {
      const registry = new MetricsRegistry();
      const gauge = registry.gauge('connections');
      gauge.set(10);
      const all = registry.getAllMetrics();
      assert.strictEqual(all.gauges.connections, 10);
    });

    it('should reset all metrics', () => {
      const registry = new MetricsRegistry();
      registry.getQueueMetrics('q1').recordEnqueue();
      registry.counter('c1').inc();
      registry.gauge('g1').set(100);
      registry.reset();
      const all = registry.getAllMetrics();
      assert.strictEqual(all.queues.q1.throughput.enqueued, 0);
      assert.strictEqual(all.counters.c1, 0);
      assert.strictEqual(all.gauges.g1, 0);
    });
  });
});

// =============================================================================
// Prometheus Tests
// =============================================================================

describe('Prometheus Exporter', () => {
  it('should export metrics in Prometheus format', () => {
    const registry = new MetricsRegistry();
    const metrics = registry.getQueueMetrics('test');
    metrics.recordEnqueue(5);
    metrics.recordDequeue(10);

    const exporter = new PrometheusExporter({ registry });
    const output = exporter.export();

    assert.ok(output.includes('# TYPE'));
    assert.ok(output.includes('links_queue_depth'));
    assert.ok(output.includes('links_queue_messages_enqueued_total'));
    assert.ok(output.includes('{queue="test"}'));
  });

  it('should include histograms with buckets', () => {
    const registry = new MetricsRegistry();
    const metrics = registry.getQueueMetrics('test');
    metrics.recordEnqueue(5);
    metrics.recordEnqueue(50);

    const exporter = new PrometheusExporter({ registry });
    const output = exporter.export();

    assert.ok(
      output.includes(
        '# TYPE links_queue_enqueue_duration_milliseconds histogram'
      )
    );
    assert.ok(output.includes('_bucket{'));
    assert.ok(output.includes('le='));
    assert.ok(output.includes('+Inf'));
    assert.ok(output.includes('_sum'));
    assert.ok(output.includes('_count'));
  });

  it('should support custom prefix', () => {
    const registry = new MetricsRegistry();
    registry.getQueueMetrics('test').recordEnqueue();

    const exporter = new PrometheusExporter({ registry, prefix: 'myapp' });
    const output = exporter.export();

    assert.ok(output.includes('myapp_links_queue_depth'));
  });

  it('should support default labels', () => {
    const registry = new MetricsRegistry();
    registry.getQueueMetrics('test').recordEnqueue();

    const exporter = new PrometheusExporter({
      registry,
      defaultLabels: { env: 'test', instance: 'localhost' },
    });
    const output = exporter.export();

    assert.ok(output.includes('env="test"'));
    assert.ok(output.includes('instance="localhost"'));
  });

  it('should provide correct content type', () => {
    const contentType = PrometheusExporter.contentType();
    assert.ok(contentType.includes('text/plain'));
    assert.ok(contentType.includes('version=0.0.4'));
  });

  it('should have static format helper', () => {
    const registry = new MetricsRegistry();
    registry.getQueueMetrics('test').recordEnqueue();

    const output = PrometheusExporter.format(registry);
    assert.ok(output.includes('links_queue_depth'));
  });
});

// =============================================================================
// Logger Tests
// =============================================================================

describe('Logger', () => {
  describe('LogLevel', () => {
    it('should have correct severity order', () => {
      assert.ok(LogLevel.DEBUG < LogLevel.INFO);
      assert.ok(LogLevel.INFO < LogLevel.WARN);
      assert.ok(LogLevel.WARN < LogLevel.ERROR);
      assert.ok(LogLevel.ERROR < LogLevel.FATAL);
    });
  });

  describe('LogContext', () => {
    it('should generate correlation IDs', () => {
      const id = LogContext.generateCorrelationId();
      assert.ok(typeof id === 'string');
      assert.ok(id.length > 0);
    });

    it('should run with correlation ID context', () => {
      const testId = 'test-correlation-id';
      LogContext.run(testId, () => {
        assert.strictEqual(LogContext.getCorrelationId(), testId);
      });
    });

    it('should generate ID if not provided', () => {
      LogContext.run(() => {
        const id = LogContext.getCorrelationId();
        assert.ok(typeof id === 'string');
        assert.ok(id.length > 0);
      });
    });

    it('should handle async context', async () => {
      const testId = 'async-test-id';
      await LogContext.runAsync(testId, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.strictEqual(LogContext.getCorrelationId(), testId);
      });
    });
  });

  describe('Logger instance', () => {
    // Helper functions for test setup/teardown (Deno compatibility - no beforeEach/afterEach)
    const createTmpLogDir = async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'logger-test-'));
      const logPath = join(tmpDir, 'test.log');
      return { tmpDir, logPath };
    };

    const cleanupTmpDir = async (tmpDir) => {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    };

    it('should create with default options', () => {
      const logger = new Logger();
      assert.strictEqual(logger.level, LogLevel.INFO);
    });

    it('should respect log level', () => {
      const logger = new Logger({ level: 'warn' });
      assert.strictEqual(logger.level, LogLevel.WARN);
      assert.strictEqual(logger.isLevelEnabled(LogLevel.ERROR), true);
      assert.strictEqual(logger.isLevelEnabled(LogLevel.INFO), false);
    });

    it('should change log level', () => {
      const logger = new Logger({ level: 'info' });
      logger.setLevel('debug');
      assert.strictEqual(logger.level, LogLevel.DEBUG);
    });

    it('should write JSON format to file', async () => {
      const { tmpDir, logPath } = await createTmpLogDir();
      try {
        const logger = new Logger({
          level: 'info',
          format: 'json',
          destination: logPath,
          includeCorrelationId: false,
        });

        logger.info('Test message', { foo: 'bar' });
        await logger.close();

        const content = await readFile(logPath, 'utf8');
        const entry = JSON.parse(content.trim());
        assert.strictEqual(entry.level, 'INFO');
        assert.strictEqual(entry.message, 'Test message');
        assert.strictEqual(entry.foo, 'bar');
        assert.ok(entry.timestamp);
      } finally {
        await cleanupTmpDir(tmpDir);
      }
    });

    it('should write text format', async () => {
      const { tmpDir, logPath } = await createTmpLogDir();
      try {
        const logger = new Logger({
          level: 'info',
          format: 'text',
          destination: logPath,
          includeCorrelationId: false,
        });

        logger.info('Text message');
        await logger.close();

        const content = await readFile(logPath, 'utf8');
        assert.ok(content.includes('[INFO]'));
        assert.ok(content.includes('Text message'));
      } finally {
        await cleanupTmpDir(tmpDir);
      }
    });

    it('should create child logger with extra fields', async () => {
      const { tmpDir, logPath } = await createTmpLogDir();
      try {
        const logger = new Logger({
          level: 'info',
          format: 'json',
          destination: logPath,
          includeCorrelationId: false,
        });

        const child = logger.child({ component: 'test-component' });
        child.info('Child message');
        await logger.close();

        const content = await readFile(logPath, 'utf8');
        const entry = JSON.parse(content.trim());
        assert.strictEqual(entry.component, 'test-component');
      } finally {
        await cleanupTmpDir(tmpDir);
      }
    });

    it('should handle Error objects', async () => {
      const { tmpDir, logPath } = await createTmpLogDir();
      try {
        const logger = new Logger({
          level: 'info',
          format: 'json',
          destination: logPath,
          includeCorrelationId: false,
        });

        const error = new Error('Test error');
        logger.error('An error occurred', error);
        await logger.close();

        const content = await readFile(logPath, 'utf8');
        const entry = JSON.parse(content.trim());
        assert.strictEqual(entry.error, 'Test error');
        assert.ok(entry.stack);
      } finally {
        await cleanupTmpDir(tmpDir);
      }
    });

    it('should include correlation ID when in context', async () => {
      const { tmpDir, logPath } = await createTmpLogDir();
      try {
        const logger = new Logger({
          level: 'info',
          format: 'json',
          destination: logPath,
        });

        await LogContext.runAsync('my-correlation-id', async () => {
          logger.info('Correlated message');
        });
        await logger.close();

        const content = await readFile(logPath, 'utf8');
        const entry = JSON.parse(content.trim());
        assert.strictEqual(entry.correlationId, 'my-correlation-id');
      } finally {
        await cleanupTmpDir(tmpDir);
      }
    });
  });

  describe('createQueueLogger', () => {
    it('should create logger with queue context', () => {
      const logger = createQueueLogger({
        queueName: 'my-queue',
        component: 'worker',
        level: 'debug',
      });
      assert.ok(logger instanceof Logger);
    });
  });
});

// =============================================================================
// Health Check Tests
// =============================================================================

describe('Health Checks', () => {
  describe('HealthStatus', () => {
    it('should have expected values', () => {
      assert.strictEqual(HealthStatus.HEALTHY, 'healthy');
      assert.strictEqual(HealthStatus.UNHEALTHY, 'unhealthy');
      assert.strictEqual(HealthStatus.DEGRADED, 'degraded');
      assert.strictEqual(HealthStatus.UNKNOWN, 'unknown');
    });
  });

  describe('ComponentChecker', () => {
    it('should run health check', async () => {
      const checker = new ComponentChecker({
        name: 'test-component',
        check: async () => ({ status: HealthStatus.HEALTHY }),
      });

      const result = await checker.check();
      assert.strictEqual(result.status, HealthStatus.HEALTHY);
      assert.ok(result.latency >= 0);
    });

    it('should handle check failures', async () => {
      const checker = new ComponentChecker({
        name: 'failing-component',
        check: async () => {
          throw new Error('Component failed');
        },
      });

      const result = await checker.check();
      assert.strictEqual(result.status, HealthStatus.UNHEALTHY);
      assert.strictEqual(result.message, 'Component failed');
    });

    it('should timeout slow checks', async () => {
      const checker = new ComponentChecker({
        name: 'slow-component',
        check: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { status: HealthStatus.HEALTHY };
        },
        timeout: 50,
      });

      const result = await checker.check();
      assert.strictEqual(result.status, HealthStatus.UNHEALTHY);
      assert.ok(result.message.includes('timeout'));
    });

    it('should report critical status', () => {
      const critical = new ComponentChecker({
        name: 'critical',
        check: async () => ({ status: HealthStatus.HEALTHY }),
        critical: true,
      });
      const nonCritical = new ComponentChecker({
        name: 'non-critical',
        check: async () => ({ status: HealthStatus.HEALTHY }),
        critical: false,
      });

      assert.strictEqual(critical.critical, true);
      assert.strictEqual(nonCritical.critical, false);
    });
  });

  describe('HealthChecker', () => {
    it('should report alive by default', async () => {
      const checker = new HealthChecker();
      const result = await checker.isAlive();
      assert.strictEqual(result.status, HealthStatus.HEALTHY);
    });

    it('should report not alive when set', async () => {
      const checker = new HealthChecker();
      checker.setAlive(false);
      const result = await checker.isAlive();
      assert.strictEqual(result.status, HealthStatus.UNHEALTHY);
    });

    it('should report not ready by default', async () => {
      const checker = new HealthChecker();
      const result = await checker.isReady();
      assert.strictEqual(result.status, HealthStatus.UNHEALTHY);
    });

    it('should report ready when set', async () => {
      const checker = new HealthChecker();
      checker.setReady(true);
      const result = await checker.isReady();
      assert.strictEqual(result.status, HealthStatus.HEALTHY);
    });

    it('should register and check components', async () => {
      const checker = new HealthChecker();
      checker.registerComponent('db', async () => ({
        status: HealthStatus.HEALTHY,
        details: { connections: 5 },
      }));
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.strictEqual(details.status, HealthStatus.HEALTHY);
      assert.ok(details.components.db);
      assert.strictEqual(details.components.db.status, HealthStatus.HEALTHY);
    });

    it('should report unhealthy when critical component fails', async () => {
      const checker = new HealthChecker();
      checker.registerComponent(
        'critical-db',
        async () => ({ status: HealthStatus.UNHEALTHY }),
        { critical: true }
      );
      checker.setReady(true);

      const result = await checker.isReady();
      assert.strictEqual(result.status, HealthStatus.UNHEALTHY);
    });

    it('should report degraded when non-critical component fails', async () => {
      const checker = new HealthChecker();
      checker.registerComponent(
        'cache',
        async () => ({ status: HealthStatus.UNHEALTHY }),
        { critical: false }
      );
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.strictEqual(details.status, HealthStatus.DEGRADED);
    });

    it('should include version and uptime', async () => {
      const checker = new HealthChecker({ version: '1.2.3' });
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.strictEqual(details.version, '1.2.3');
      assert.ok(details.uptime >= 0);
    });

    it('should unregister components', async () => {
      const checker = new HealthChecker();
      checker.registerComponent('temp', async () => ({
        status: HealthStatus.HEALTHY,
      }));
      assert.strictEqual(checker.unregisterComponent('temp'), true);
      assert.strictEqual(checker.unregisterComponent('temp'), false);
    });

    it('should register backend health check', async () => {
      const checker = new HealthChecker();
      const mockBackend = {
        isConnected: () => true,
        getStats: () => ({ connections: 1 }),
      };
      checker.registerBackend('backend', mockBackend);
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.strictEqual(
        details.components.backend.status,
        HealthStatus.HEALTHY
      );
    });

    it('should report unhealthy backend when disconnected', async () => {
      const checker = new HealthChecker();
      const mockBackend = {
        isConnected: () => false,
      };
      checker.registerBackend('backend', mockBackend);
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.strictEqual(
        details.components.backend.status,
        HealthStatus.UNHEALTHY
      );
    });

    it('should register cluster health check', async () => {
      const checker = new HealthChecker();
      const mockCluster = {
        getStats: () => ({ nodeCount: 3, leader: 'node1' }),
      };
      checker.registerCluster('cluster', mockCluster);
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.strictEqual(
        details.components.cluster.status,
        HealthStatus.HEALTHY
      );
      assert.strictEqual(details.components.cluster.details.nodes, 3);
    });

    it('should register queue health check', async () => {
      const checker = new HealthChecker();
      const mockQueue = {
        getStats: () => ({ depth: 10, inFlight: 2 }),
      };
      checker.registerQueue('tasks', mockQueue);
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.strictEqual(details.components.tasks.status, HealthStatus.HEALTHY);
      assert.strictEqual(details.components.tasks.details.depth, 10);
    });
  });

  describe('createServerHealthChecker', () => {
    it('should create health checker with backend', () => {
      const mockBackend = { isConnected: () => true };
      const checker = createServerHealthChecker({
        version: '1.0.0',
        backend: mockBackend,
      });
      assert.ok(checker instanceof HealthChecker);
    });

    it('should create health checker with multiple queues', async () => {
      const checker = createServerHealthChecker({
        queues: {
          tasks: { getStats: () => ({ depth: 5 }) },
          events: { getStats: () => ({ depth: 10 }) },
        },
      });
      checker.setReady(true);

      const details = await checker.getHealthDetails();
      assert.ok(details.components.queue_tasks);
      assert.ok(details.components.queue_events);
    });
  });
});
