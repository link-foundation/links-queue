/**
 * Type definitions for links-queue observability module.
 *
 * @module observability
 */

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * Default latency bucket boundaries in milliseconds.
 */
export declare const DEFAULT_LATENCY_BUCKETS: number[];

/**
 * Histogram bucket definition.
 */
export interface HistogramBucket {
  le: number;
  count: number;
}

/**
 * Histogram statistics.
 */
export interface HistogramStats {
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  buckets: HistogramBucket[];
}

/**
 * Options for creating a LatencyHistogram.
 */
export interface LatencyHistogramOptions {
  buckets?: number[];
  maxSamples?: number;
}

/**
 * A histogram for tracking latency distributions.
 */
export declare class LatencyHistogram {
  constructor(options?: LatencyHistogramOptions);
  observe(value: number): void;
  percentile(p: number): number;
  getStats(): HistogramStats;
  reset(): void;
}

/**
 * Options for creating a Counter.
 */
export interface CounterOptions {
  name?: string;
  help?: string;
}

/**
 * Counter metadata.
 */
export interface CounterMetadata {
  name: string;
  help: string;
  value: number;
  createdAt: number;
}

/**
 * A counter metric that only increments.
 */
export declare class Counter {
  constructor(options?: CounterOptions);
  inc(amount?: number): void;
  readonly value: number;
  getMetadata(): CounterMetadata;
  reset(): void;
}

/**
 * Options for creating a Gauge.
 */
export interface GaugeOptions {
  name?: string;
  help?: string;
  initialValue?: number;
}

/**
 * Gauge metadata.
 */
export interface GaugeMetadata {
  name: string;
  help: string;
  value: number;
  lastUpdated: number;
}

/**
 * A gauge metric that can go up or down.
 */
export declare class Gauge {
  constructor(options?: GaugeOptions);
  set(value: number): void;
  inc(amount?: number): void;
  dec(amount?: number): void;
  readonly value: number;
  getMetadata(): GaugeMetadata;
  reset(): void;
}

/**
 * Options for creating QueueMetrics.
 */
export interface QueueMetricsOptions {
  queueName?: string;
  latencyBuckets?: number[];
}

/**
 * Throughput metrics.
 */
export interface ThroughputMetrics {
  enqueued: number;
  dequeued: number;
  acknowledged: number;
  rejected: number;
  deadLettered: number;
  enqueueRate: number;
  dequeueRate: number;
}

/**
 * Latency metrics.
 */
export interface LatencyMetrics {
  enqueue: HistogramStats;
  dequeue: HistogramStats;
  processing: HistogramStats;
}

/**
 * Complete queue metrics.
 */
export interface QueueMetricsData {
  queue: string;
  timestamp: number;
  uptime: number;
  depth: number;
  throughput: ThroughputMetrics;
  latency: LatencyMetrics;
  consumerLag: number;
  inFlight: number;
  errors: number;
}

/**
 * Metrics collector for a queue instance.
 */
export declare class QueueMetrics {
  constructor(options?: QueueMetricsOptions);
  readonly queueName: string;
  recordEnqueue(latencyMs?: number): void;
  recordDequeue(latencyMs?: number): void;
  recordAcknowledge(processingTimeMs?: number): void;
  recordReject(requeued?: boolean): void;
  recordDeadLetter(): void;
  recordError(): void;
  setDepth(depth: number): void;
  setInFlight(count: number): void;
  setConsumerLag(lag: number): void;
  calculateRates(): void;
  getMetrics(): QueueMetricsData;
  reset(): void;
}

/**
 * All metrics from a registry.
 */
export interface AllMetrics {
  timestamp: number;
  uptime: number;
  queues: Record<string, QueueMetricsData>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

/**
 * Global metrics registry for managing multiple queue metrics.
 */
export declare class MetricsRegistry {
  constructor();
  getQueueMetrics(
    queueName: string,
    options?: QueueMetricsOptions
  ): QueueMetrics;
  removeQueueMetrics(queueName: string): boolean;
  counter(name: string, options?: CounterOptions): Counter;
  gauge(name: string, options?: GaugeOptions): Gauge;
  getAllMetrics(): AllMetrics;
  reset(): void;
}

/**
 * Default global registry instance.
 */
export declare const defaultRegistry: MetricsRegistry;

// =============================================================================
// Prometheus Types
// =============================================================================

/**
 * Options for creating a PrometheusExporter.
 */
export interface PrometheusExporterOptions {
  registry?: MetricsRegistry;
  prefix?: string;
  defaultLabels?: Record<string, string>;
}

/**
 * Prometheus exporter for links-queue metrics.
 */
export declare class PrometheusExporter {
  constructor(options?: PrometheusExporterOptions);
  registry: MetricsRegistry;
  export(): string;
  static contentType(): string;
  static format(
    registry: MetricsRegistry,
    options?: PrometheusExporterOptions
  ): string;
  static formatQueueMetrics(
    metrics: QueueMetricsData,
    options?: PrometheusExporterOptions
  ): string;
}

/**
 * Options for metrics middleware.
 */
export interface MetricsMiddlewareOptions {
  registry?: MetricsRegistry;
  path?: string;
  prefix?: string;
  defaultLabels?: Record<string, string>;
}

/**
 * Express/Fastify compatible middleware for serving Prometheus metrics.
 */
export declare function metricsMiddleware(
  options?: MetricsMiddlewareOptions
): (req: any, res: any, next?: () => void) => void;

// =============================================================================
// Logger Types
// =============================================================================

/**
 * Log levels with numeric severity.
 */
export declare const LogLevel: {
  readonly DEBUG: 0;
  readonly INFO: 1;
  readonly WARN: 2;
  readonly ERROR: 3;
  readonly FATAL: 4;
};

export type LogLevelValue = 0 | 1 | 2 | 3 | 4;
export type LogLevelName =
  | 'DEBUG'
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  | 'FATAL'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

/**
 * Context manager for correlation IDs.
 */
export declare class LogContext {
  static run<T>(fn: () => T): T;
  static run<T>(correlationId: string, fn: () => T): T;
  static runAsync<T>(fn: () => Promise<T>): Promise<T>;
  static runAsync<T>(correlationId: string, fn: () => Promise<T>): Promise<T>;
  static getCorrelationId(): string | undefined;
  static setCorrelationId(correlationId: string): void;
  static generateCorrelationId(): string;
}

/**
 * Log rotation options.
 */
export interface LogRotateOptions {
  maxSize?: string | number;
  maxFiles?: number;
}

/**
 * Logger options.
 */
export interface LoggerOptions {
  level?: LogLevelValue | LogLevelName;
  format?: 'json' | 'text';
  destination?: string;
  rotate?: LogRotateOptions;
  defaultFields?: Record<string, unknown>;
  includeTimestamp?: boolean;
  includeCorrelationId?: boolean;
}

/**
 * Log entry fields.
 */
export interface LogFields {
  [key: string]: unknown;
}

/**
 * Structured logger for links-queue.
 */
export declare class Logger {
  constructor(options?: LoggerOptions);
  readonly level: LogLevelValue;
  setLevel(level: LogLevelValue | LogLevelName): void;
  isLevelEnabled(level: LogLevelValue): boolean;
  child(fields: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields | Error): void;
  fatal(message: string, fields?: LogFields | Error): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Default logger instance.
 */
export declare const defaultLogger: Logger;

/**
 * Options for creating a queue logger.
 */
export interface QueueLoggerOptions extends LoggerOptions {
  queueName?: string;
  component?: string;
}

/**
 * Creates a logger with queue-specific context.
 */
export declare function createQueueLogger(options?: QueueLoggerOptions): Logger;

// =============================================================================
// Health Check Types
// =============================================================================

/**
 * Health status values.
 */
export declare const HealthStatus: {
  readonly HEALTHY: 'healthy';
  readonly UNHEALTHY: 'unhealthy';
  readonly DEGRADED: 'degraded';
  readonly UNKNOWN: 'unknown';
};

export type HealthStatusValue =
  | 'healthy'
  | 'unhealthy'
  | 'degraded'
  | 'unknown';

/**
 * Component health check result.
 */
export interface ComponentHealth {
  status: HealthStatusValue;
  latency?: number;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Overall health check result.
 */
export interface HealthCheckResult {
  status: HealthStatusValue;
  timestamp: number;
  version: string;
  uptime: number;
  ready: boolean;
  alive: boolean;
  components: Record<string, ComponentHealth>;
}

/**
 * Liveness check result.
 */
export interface LivenessResult {
  status: HealthStatusValue;
  timestamp: number;
}

/**
 * Readiness check result.
 */
export interface ReadinessResult {
  status: HealthStatusValue;
  timestamp: number;
  message?: string;
  component?: string;
}

/**
 * Options for creating a ComponentChecker.
 */
export interface ComponentCheckerOptions {
  name: string;
  check: () => Promise<Partial<ComponentHealth>>;
  critical?: boolean;
  timeout?: number;
}

/**
 * A component health checker.
 */
export declare class ComponentChecker {
  constructor(options: ComponentCheckerOptions);
  readonly name: string;
  readonly critical: boolean;
  check(): Promise<ComponentHealth>;
}

/**
 * Options for creating a HealthChecker.
 */
export interface HealthCheckerOptions {
  version?: string;
  components?: Record<string, ComponentChecker>;
}

/**
 * Health checker for links-queue.
 */
export declare class HealthChecker {
  constructor(options?: HealthCheckerOptions);
  readonly uptime: number;
  setAlive(alive: boolean): void;
  setReady(ready: boolean): void;
  registerComponent(
    name: string,
    checker: ComponentChecker | (() => Promise<Partial<ComponentHealth>>),
    options?: Partial<ComponentCheckerOptions>
  ): void;
  unregisterComponent(name: string): boolean;
  isAlive(): Promise<LivenessResult>;
  isReady(): Promise<ReadinessResult>;
  getHealthDetails(): Promise<HealthCheckResult>;
  registerBackend(
    name: string,
    backend: { isConnected?(): boolean; getStats?(): any },
    options?: Partial<ComponentCheckerOptions>
  ): void;
  registerCluster(
    name: string,
    cluster: { getStats?(): any },
    options?: Partial<ComponentCheckerOptions>
  ): void;
  registerQueue(
    name: string,
    queue: { getStats?(): any },
    options?: Partial<ComponentCheckerOptions>
  ): void;
}

/**
 * Options for health middleware.
 */
export interface HealthMiddlewareOptions {
  checker: HealthChecker;
  livePath?: string;
  readyPath?: string;
  detailsPath?: string;
}

/**
 * Express/Fastify compatible middleware for health endpoints.
 */
export declare function healthMiddleware(
  options: HealthMiddlewareOptions
): (req: any, res: any, next?: () => void) => Promise<void>;

/**
 * Options for creating a server health checker.
 */
export interface ServerHealthCheckerOptions {
  version?: string;
  backend?: { isConnected?(): boolean; getStats?(): any };
  cluster?: { getStats?(): any };
  queues?: Record<string, { getStats?(): any }>;
}

/**
 * Creates a health checker pre-configured for a queue server.
 */
export declare function createServerHealthChecker(
  options?: ServerHealthCheckerOptions
): HealthChecker;
