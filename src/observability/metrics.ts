/**
 * Metrics collection system for FreshGuard Core Phase 2
 *
 * Provides comprehensive metrics collection for query performance,
 * circuit breaker states, retry attempts, and system health monitoring.
 *
 * @license MIT
 */

// ==============================================
// Types and Interfaces
// ==============================================

/**
 * Metric types supported by the system
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

/**
 * Histogram bucket configuration
 */
export interface HistogramBuckets {
  /** Predefined bucket boundaries */
  buckets: number[];
  /** Current bucket counts */
  counts: number[];
  /** Total count of observations */
  count: number;
  /** Sum of all observed values */
  sum: number;
}

/**
 * Summary quantile configuration
 */
export interface SummaryQuantiles {
  /** Quantile values (e.g., [0.5, 0.95, 0.99]) */
  quantiles: number[];
  /** Current quantile values */
  values: number[];
  /** Total count of observations */
  count: number;
  /** Sum of all observed values */
  sum: number;
}

/**
 * Metric data point
 */
export interface MetricValue {
  type: MetricType;
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number | HistogramBuckets | SummaryQuantiles;
  timestamp: Date;
}

/**
 * Query performance metrics
 */
export interface QueryMetrics {
  /** Total number of queries executed */
  totalQueries: number;
  /** Number of successful queries */
  successfulQueries: number;
  /** Number of failed queries */
  failedQueries: number;
  /** Average query duration in milliseconds */
  averageDuration: number;
  /** P50 query duration */
  p50Duration: number;
  /** P95 query duration */
  p95Duration: number;
  /** P99 query duration */
  p99Duration: number;
  /** Maximum query duration */
  maxDuration: number;
  /** Minimum query duration */
  minDuration: number;
  /** Queries per second over last minute */
  queriesPerSecond: number;
  /** Error rate percentage */
  errorRate: number;
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  /** Current state (CLOSED, OPEN, HALF_OPEN) */
  state: string;
  /** Number of successful calls */
  successCount: number;
  /** Number of failed calls */
  failureCount: number;
  /** Number of times circuit was opened */
  openCount: number;
  /** Current failure rate percentage */
  failureRate: number;
  /** Time since last state change */
  lastStateChangeTime: Date;
  /** Duration in current state (ms) */
  timeInCurrentState: number;
}

/**
 * Retry policy metrics
 */
export interface RetryMetrics {
  /** Total number of operations attempted */
  totalOperations: number;
  /** Operations that succeeded without retry */
  firstTrySuccesses: number;
  /** Operations that succeeded after retries */
  retriedSuccesses: number;
  /** Operations that failed after all retries */
  totalFailures: number;
  /** Average number of attempts per operation */
  averageAttempts: number;
  /** Total time spent on retries */
  totalRetryTime: number;
}

/**
 * System health metrics
 */
export interface SystemMetrics {
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Memory usage percentage */
  memoryUsagePercent: number;
  /** CPU usage percentage */
  cpuUsagePercent: number;
  /** Event loop lag in milliseconds */
  eventLoopLag: number;
  /** Number of active connections */
  activeConnections: number;
  /** Uptime in seconds */
  uptime: number;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /** Enable/disable metrics collection */
  enabled?: boolean;
  /** Collection interval in milliseconds */
  collectionInterval?: number;
  /** Maximum number of metrics to store */
  maxMetrics?: number;
  /** Default histogram buckets */
  defaultHistogramBuckets?: number[];
  /** Default summary quantiles */
  defaultSummaryQuantiles?: number[];
  /** Enable system metrics collection */
  collectSystemMetrics?: boolean;
  /** Metric name prefix */
  prefix?: string;
}

// ==============================================
// Utility Classes
// ==============================================

/**
 * Sliding window for calculating percentiles and moving averages
 */
class SlidingWindow {
  private values: { value: number; timestamp: number }[] = [];
  private readonly windowSize: number;
  private readonly maxAge: number;

  constructor(windowSize = 1000, maxAge = 60000) {
    this.windowSize = windowSize;
    this.maxAge = maxAge;
  }

  /**
   * Add a value to the window
   */
  add(value: number): void {
    const now = Date.now();
    this.values.push({ value, timestamp: now });

    // Remove old values
    this.cleanup(now);

    // Keep window size under control
    if (this.values.length > this.windowSize) {
      this.values.shift();
    }
  }

  /**
   * Calculate percentile (0-1)
   */
  percentile(p: number): number {
    if (this.values.length === 0) return 0;

    const sorted = this.values.map(v => v.value).sort((a, b) => a - b);
    const index = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Calculate average
   */
  average(): number {
    if (this.values.length === 0) return 0;
    const sum = this.values.reduce((acc, v) => acc + v.value, 0);
    return sum / this.values.length;
  }

  /**
   * Get minimum value
   */
  min(): number {
    if (this.values.length === 0) return 0;
    return Math.min(...this.values.map(v => v.value));
  }

  /**
   * Get maximum value
   */
  max(): number {
    if (this.values.length === 0) return 0;
    return Math.max(...this.values.map(v => v.value));
  }

  /**
   * Get count of values
   */
  count(): number {
    return this.values.length;
  }

  /**
   * Get rate per second over the window
   */
  rate(): number {
    if (this.values.length === 0) return 0;

    const now = Date.now();
    const windowStart = now - this.maxAge;
    const recentValues = this.values.filter(v => v.timestamp > windowStart);

    if (recentValues.length === 0) return 0;

    const timeSpan = (now - recentValues[0].timestamp) / 1000; // seconds
    return timeSpan > 0 ? recentValues.length / timeSpan : 0;
  }

  /**
   * Remove expired values
   */
  private cleanup(now: number): void {
    const cutoff = now - this.maxAge;
    this.values = this.values.filter(v => v.timestamp > cutoff);
  }
}

/**
 * Counter metric implementation
 */
class Counter {
  private value = 0;
  private readonly labels: Record<string, string>;

  constructor(labels: Record<string, string> = {}) {
    this.labels = labels;
  }

  /**
   * Increment counter
   */
  inc(amount = 1): void {
    this.value += amount;
  }

  /**
   * Get current value
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Get labels
   */
  getLabels(): Record<string, string> {
    return { ...this.labels };
  }

  /**
   * Reset counter
   */
  reset(): void {
    this.value = 0;
  }
}

/**
 * Gauge metric implementation
 */
class Gauge {
  private value = 0;
  private readonly labels: Record<string, string>;

  constructor(labels: Record<string, string> = {}) {
    this.labels = labels;
  }

  /**
   * Set gauge value
   */
  set(value: number): void {
    this.value = value;
  }

  /**
   * Increment gauge
   */
  inc(amount = 1): void {
    this.value += amount;
  }

  /**
   * Decrement gauge
   */
  dec(amount = 1): void {
    this.value -= amount;
  }

  /**
   * Get current value
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Get labels
   */
  getLabels(): Record<string, string> {
    return { ...this.labels };
  }
}

/**
 * Histogram metric implementation
 */
class Histogram {
  private readonly buckets: number[];
  private readonly counts: number[];
  private totalCount = 0;
  private totalSum = 0;
  private readonly labels: Record<string, string>;

  constructor(buckets: number[], labels: Record<string, string> = {}) {
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.counts = new Array(buckets.length + 1).fill(0); // +1 for +Inf bucket
    this.labels = labels;
  }

  /**
   * Observe a value
   */
  observe(value: number): void {
    this.totalCount++;
    this.totalSum += value;

    // Find appropriate bucket
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        this.counts[i]++;
        return;
      }
    }

    // Value is larger than all buckets, goes to +Inf bucket
    this.counts[this.counts.length - 1]++;
  }

  /**
   * Get histogram data
   */
  getValue(): HistogramBuckets {
    return {
      buckets: [...this.buckets],
      counts: [...this.counts],
      count: this.totalCount,
      sum: this.totalSum,
    };
  }

  /**
   * Get labels
   */
  getLabels(): Record<string, string> {
    return { ...this.labels };
  }

  /**
   * Reset histogram
   */
  reset(): void {
    this.counts.fill(0);
    this.totalCount = 0;
    this.totalSum = 0;
  }
}

// ==============================================
// Main Metrics Collector
// ==============================================

/**
 * Comprehensive metrics collection system
 */
export class MetricsCollector {
  private readonly config: Required<MetricsConfig>;
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();
  private queryWindow = new SlidingWindow(10000, 300000); // 5 minutes
  private systemMetricsInterval?: NodeJS.Timeout;
  private readonly startTime = Date.now();

  // Built-in metrics
  private readonly builtinCounters = {
    queries_total: new Counter(),
    queries_success_total: new Counter(),
    queries_error_total: new Counter(),
    circuit_breaker_opens_total: new Counter(),
    retry_attempts_total: new Counter(),
  };

  private readonly builtinGauges = {
    active_connections: new Gauge(),
    circuit_breaker_state: new Gauge(),
    memory_usage_bytes: new Gauge(),
    cpu_usage_percent: new Gauge(),
  };

  private readonly builtinHistograms = {
    query_duration_ms: new Histogram(this.getDefaultHistogramBuckets()),
    retry_duration_ms: new Histogram(this.getDefaultHistogramBuckets()),
  };

  constructor(config: MetricsConfig = {}) {
    this.config = {
      enabled: config.enabled !== false,
      collectionInterval: config.collectionInterval || 5000,
      maxMetrics: config.maxMetrics || 10000,
      defaultHistogramBuckets: config.defaultHistogramBuckets || this.getDefaultHistogramBuckets(),
      defaultSummaryQuantiles: config.defaultSummaryQuantiles || [0.5, 0.95, 0.99],
      collectSystemMetrics: config.collectSystemMetrics !== false,
      prefix: config.prefix || 'freshguard_',
    };

    if (this.config.enabled && this.config.collectSystemMetrics) {
      this.startSystemMetricsCollection();
    }
  }

  /**
   * Record a database query execution
   */
  recordQuery(
    operation: string,
    database: string,
    table: string | undefined,
    duration: number,
    success: boolean,
    error?: Error
  ): void {
    if (!this.config.enabled) return;

    const labels = {
      operation,
      database,
      table: table || 'unknown',
      status: success ? 'success' : 'error',
    };

    // Record basic metrics
    this.builtinCounters.queries_total.inc();
    this.builtinHistograms.query_duration_ms.observe(duration);
    this.queryWindow.add(duration);

    if (success) {
      this.builtinCounters.queries_success_total.inc();
    } else {
      this.builtinCounters.queries_error_total.inc();
    }

    // Record detailed metrics with labels
    this.incrementCounter('database_queries_total', 1, labels);
    this.observeHistogram('database_query_duration_seconds', duration / 1000, labels);

    if (error) {
      this.incrementCounter('database_errors_total', 1, {
        ...labels,
        error_type: error.constructor.name,
      });
    }
  }

  /**
   * Record circuit breaker state change
   */
  recordCircuitBreakerState(
    component: string,
    state: string,
    failureCount: number,
    successCount: number
  ): void {
    if (!this.config.enabled) return;

    const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2; // HALF_OPEN
    this.builtinGauges.circuit_breaker_state.set(stateValue);

    const labels = { component, state };

    this.setGauge('circuit_breaker_state', stateValue, labels);
    this.setGauge('circuit_breaker_failures', failureCount, labels);
    this.setGauge('circuit_breaker_successes', successCount, labels);

    if (state === 'OPEN') {
      this.builtinCounters.circuit_breaker_opens_total.inc();
      this.incrementCounter('circuit_breaker_opens_total', 1, labels);
    }
  }

  /**
   * Record retry attempt
   */
  recordRetryAttempt(
    operation: string,
    attempt: number,
    duration: number,
    success: boolean,
    finalAttempt: boolean
  ): void {
    if (!this.config.enabled) return;

    this.builtinCounters.retry_attempts_total.inc();
    this.builtinHistograms.retry_duration_ms.observe(duration);

    const labels = {
      operation,
      attempt: attempt.toString(),
      success: success.toString(),
      final: finalAttempt.toString(),
    };

    this.incrementCounter('retry_attempts_total', 1, labels);
    this.observeHistogram('retry_duration_seconds', duration / 1000, labels);
  }

  /**
   * Record connection event
   */
  recordConnection(database: string, action: 'open' | 'close', success: boolean): void {
    if (!this.config.enabled) return;

    const labels = { database, action, status: success ? 'success' : 'error' };

    this.incrementCounter('database_connections_total', 1, labels);

    if (action === 'open' && success) {
      this.builtinGauges.active_connections.inc();
    } else if (action === 'close') {
      this.builtinGauges.active_connections.dec();
    }
  }

  /**
   * Get query performance metrics
   */
  getQueryMetrics(): QueryMetrics {
    const totalQueries = this.builtinCounters.queries_total.getValue();
    const successfulQueries = this.builtinCounters.queries_success_total.getValue();
    const failedQueries = this.builtinCounters.queries_error_total.getValue();

    return {
      totalQueries,
      successfulQueries,
      failedQueries,
      averageDuration: this.queryWindow.average(),
      p50Duration: this.queryWindow.percentile(0.5),
      p95Duration: this.queryWindow.percentile(0.95),
      p99Duration: this.queryWindow.percentile(0.99),
      maxDuration: this.queryWindow.max(),
      minDuration: this.queryWindow.min(),
      queriesPerSecond: this.queryWindow.rate(),
      errorRate: totalQueries > 0 ? (failedQueries / totalQueries) * 100 : 0,
    };
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const memUsage = process.memoryUsage();

    return {
      memoryUsage: memUsage.heapUsed,
      memoryUsagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      cpuUsagePercent: this.builtinGauges.cpu_usage_percent.getValue(),
      eventLoopLag: this.measureEventLoopLag(),
      activeConnections: this.builtinGauges.active_connections.getValue(),
      uptime: (Date.now() - this.startTime) / 1000,
    };
  }

  /**
   * Get all metrics in Prometheus format
   */
  getAllMetrics(): MetricValue[] {
    const metrics: MetricValue[] = [];

    // Add counters
    for (const [name, counter] of Object.entries(this.builtinCounters)) {
      metrics.push({
        type: MetricType.COUNTER,
        name: this.config.prefix + name,
        help: `Built-in counter: ${name}`,
        labels: counter.getLabels(),
        value: counter.getValue(),
        timestamp: new Date(),
      });
    }

    // Add gauges
    for (const [name, gauge] of Object.entries(this.builtinGauges)) {
      metrics.push({
        type: MetricType.GAUGE,
        name: this.config.prefix + name,
        help: `Built-in gauge: ${name}`,
        labels: gauge.getLabels(),
        value: gauge.getValue(),
        timestamp: new Date(),
      });
    }

    // Add histograms
    for (const [name, histogram] of Object.entries(this.builtinHistograms)) {
      metrics.push({
        type: MetricType.HISTOGRAM,
        name: this.config.prefix + name,
        help: `Built-in histogram: ${name}`,
        labels: histogram.getLabels(),
        value: histogram.getValue(),
        timestamp: new Date(),
      });
    }

    // Add custom metrics
    for (const [name, counter] of this.counters) {
      metrics.push({
        type: MetricType.COUNTER,
        name,
        help: `Custom counter: ${name}`,
        labels: counter.getLabels(),
        value: counter.getValue(),
        timestamp: new Date(),
      });
    }

    for (const [name, gauge] of this.gauges) {
      metrics.push({
        type: MetricType.GAUGE,
        name,
        help: `Custom gauge: ${name}`,
        labels: gauge.getLabels(),
        value: gauge.getValue(),
        timestamp: new Date(),
      });
    }

    for (const [name, histogram] of this.histograms) {
      metrics.push({
        type: MetricType.HISTOGRAM,
        name,
        help: `Custom histogram: ${name}`,
        labels: histogram.getLabels(),
        value: histogram.getValue(),
        timestamp: new Date(),
      });
    }

    return metrics;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    // Reset built-in metrics
    Object.values(this.builtinCounters).forEach(c => c.reset());
    Object.values(this.builtinHistograms).forEach(h => h.reset());

    // Reset custom metrics
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();

    // Reset query window
    this.queryWindow = new SlidingWindow(10000, 300000);
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
      this.systemMetricsInterval = undefined;
    }
  }

  /**
   * Create or get a counter
   */
  private incrementCounter(name: string, amount = 1, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels);
    let counter = this.counters.get(key);

    if (!counter) {
      counter = new Counter(labels);
      this.counters.set(key, counter);
    }

    counter.inc(amount);
  }

  /**
   * Create or get a gauge
   */
  private setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels);
    let gauge = this.gauges.get(key);

    if (!gauge) {
      gauge = new Gauge(labels);
      this.gauges.set(key, gauge);
    }

    gauge.set(value);
  }

  /**
   * Create or get a histogram
   */
  private observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getMetricKey(name, labels);
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = new Histogram(this.config.defaultHistogramBuckets, labels);
      this.histograms.set(key, histogram);
    }

    histogram.observe(value);
  }

  /**
   * Generate a unique key for a metric with labels
   */
  private getMetricKey(name: string, labels: Record<string, string>): string {
    const sortedLabels = Object.keys(labels)
      .sort()
      .map(key => `${key}="${labels[key]}"`)
      .join(',');

    return `${name}{${sortedLabels}}`;
  }

  /**
   * Get default histogram buckets for latency measurements
   */
  private getDefaultHistogramBuckets(): number[] {
    return [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];
  }

  /**
   * Start system metrics collection
   */
  private startSystemMetricsCollection(): void {
    this.systemMetricsInterval = setInterval(() => {
      try {
        const memUsage = process.memoryUsage();
        this.builtinGauges.memory_usage_bytes.set(memUsage.heapUsed);

        // Simple CPU usage estimation (not perfect but useful)
        const usage = process.cpuUsage();
        const cpuPercent = (usage.user + usage.system) / 1000; // Convert to percentage
        this.builtinGauges.cpu_usage_percent.set(Math.min(cpuPercent, 100));
      } catch (error) {
        // Ignore errors in system metrics collection
      }
    }, this.config.collectionInterval);
  }

  /**
   * Measure event loop lag (simple implementation)
   */
  private measureEventLoopLag(): number {
    const start = process.hrtime();
    setImmediate(() => {
      const delta = process.hrtime(start);
      return (delta[0] * 1000) + (delta[1] * 1e-6); // Convert to milliseconds
    });
    return 0; // This is a simplified implementation
  }
}

// ==============================================
// Default Metrics Instance
// ==============================================

/**
 * Default metrics collector instance
 */
export const defaultMetrics = new MetricsCollector();

// ==============================================
// Convenience Functions
// ==============================================

/**
 * Create a metrics collector for a specific component
 */
export function createComponentMetrics(component: string, config?: MetricsConfig): MetricsCollector {
  return new MetricsCollector({
    ...config,
    prefix: `${config?.prefix || 'freshguard_'}${component}_`,
  });
}

/**
 * Time an operation and record metrics
 */
export async function timeOperation<T>(
  metricsCollector: MetricsCollector,
  operation: string,
  database: string,
  table: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - start;
    metricsCollector.recordQuery(operation, database, table, duration, true);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    metricsCollector.recordQuery(operation, database, table, duration, false, error as Error);
    throw error;
  }
}