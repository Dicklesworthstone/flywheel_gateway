/**
 * Metrics Service
 *
 * Collects, stores, and exposes metrics for Flywheel Gateway.
 * Provides both in-memory real-time metrics and Prometheus-compatible export.
 */

import { getCorrelationId, getLogger } from "../middleware/correlation";
import {
  type HistogramBucket,
  LATENCY_BUCKETS,
  type Labels,
  type MetricComparison,
  type MetricSnapshot,
  type NamedSnapshot,
} from "../models/metrics";
import { getConnectionCount } from "./agent-ws";
import { logger } from "./logger";

/** In-memory metric storage */
interface MetricStore {
  counters: Map<string, number>;
  gauges: Map<string, number>;
  histograms: Map<
    string,
    {
      buckets: number[];
      boundaries: readonly number[];
      sum: number;
      count: number;
    }
  >;
}

/** Time series data point */
interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
  labels: Labels;
}

/** Maximum time series history to retain */
const MAX_HISTORY_POINTS = 1440; // 24 hours at 1-minute intervals

/** Maximum unique time series keys (prevents unbounded memory growth) */
const MAX_TIME_SERIES_KEYS = 5000;

/** Maximum named snapshots to retain */
const MAX_SNAPSHOTS = 50;

/** Named snapshots storage */
const namedSnapshots = new Map<string, NamedSnapshot>();

/** Process start time for uptime calculation */
const startTime = Date.now();

/** Metric storage */
const store: MetricStore = {
  counters: new Map(),
  gauges: new Map(),
  histograms: new Map(),
};

/** Time series history for trend calculation */
const timeSeries = new Map<string, TimeSeriesPoint[]>();

/**
 * Generate a unique key for a metric with labels.
 */
function metricKey(name: string, labels: Labels = {}): string {
  const sortedLabels = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return sortedLabels ? `${name}{${sortedLabels}}` : name;
}

/**
 * Increment a counter metric.
 */
export function incrementCounter(
  name: string,
  value = 1,
  labels: Labels = {},
): void {
  const key = metricKey(name, labels);
  const current = store.counters.get(key) ?? 0;
  store.counters.set(key, current + value);

  const log = getLogger();
  log.debug({
    type: "metrics:recorded",
    correlationId: getCorrelationId(),
    metricName: name,
    metricType: "counter",
    value,
    labels,
  });
}

/**
 * Set a gauge metric value.
 */
export function setGauge(
  name: string,
  value: number,
  labels: Labels = {},
): void {
  const key = metricKey(name, labels);
  store.gauges.set(key, value);

  const log = getLogger();
  log.debug({
    type: "metrics:recorded",
    correlationId: getCorrelationId(),
    metricName: name,
    metricType: "gauge",
    value,
    labels,
  });
}

/**
 * Record a histogram observation.
 */
export function recordHistogram(
  name: string,
  value: number,
  labels: Labels = {},
  bucketBoundaries: readonly number[] = LATENCY_BUCKETS,
): void {
  const key = metricKey(name, labels);
  let histogram = store.histograms.get(key);

  if (!histogram) {
    histogram = {
      buckets: new Array(bucketBoundaries.length).fill(0),
      boundaries: bucketBoundaries,
      sum: 0,
      count: 0,
    };
    store.histograms.set(key, histogram);
  }

  // Update buckets
  for (let i = 0; i < bucketBoundaries.length; i++) {
    const boundary = bucketBoundaries[i];
    if (boundary !== undefined && value <= boundary) {
      const current = histogram.buckets[i] ?? 0;
      histogram.buckets[i] = current + 1;
    }
  }

  histogram.sum += value;
  histogram.count++;

  const log = getLogger();
  log.debug({
    type: "metrics:recorded",
    correlationId: getCorrelationId(),
    metricName: name,
    metricType: "histogram",
    value,
    labels,
  });
}

/**
 * Record a time series data point for trend analysis.
 */
export function recordTimeSeries(
  name: string,
  value: number,
  labels: Labels = {},
): void {
  const key = metricKey(name, labels);
  let series = timeSeries.get(key);

  if (!series) {
    // Enforce max keys limit to prevent unbounded memory growth
    if (timeSeries.size >= MAX_TIME_SERIES_KEYS) {
      // Drop new series silently when at capacity
      return;
    }
    series = [];
    timeSeries.set(key, series);
  }

  series.push({
    timestamp: new Date(),
    value,
    labels,
  });

  // Trim old points
  if (series.length > MAX_HISTORY_POINTS) {
    timeSeries.set(key, series.slice(-MAX_HISTORY_POINTS));
  }
}

/**
 * Get counter value.
 */
export function getCounter(name: string, labels: Labels = {}): number {
  return store.counters.get(metricKey(name, labels)) ?? 0;
}

/**
 * Get gauge value.
 */
export function getGauge(name: string, labels: Labels = {}): number {
  return store.gauges.get(metricKey(name, labels)) ?? 0;
}

/**
 * Get histogram data.
 *
 * Note: The bucketBoundaries parameter is deprecated and ignored.
 * The histogram uses the boundaries that were passed when recording.
 */
export function getHistogram(
  name: string,
  labels: Labels = {},
  _bucketBoundaries?: readonly number[],
): { buckets: HistogramBucket[]; sum: number; count: number } | undefined {
  const histogram = store.histograms.get(metricKey(name, labels));
  if (!histogram) return undefined;

  return {
    buckets: histogram.buckets.map((count, i) => ({
      le: histogram.boundaries[i] ?? Infinity,
      count,
    })),
    sum: histogram.sum,
    count: histogram.count,
  };
}

/**
 * Calculate trend from time series data.
 */
function calculateTrend(
  name: string,
  labels: Labels = {},
  periodMs: number = 86400000, // 24 hours
): { trend: "up" | "down" | "stable"; trendPercent: number } {
  const series = timeSeries.get(metricKey(name, labels)) ?? [];
  const now = Date.now();
  const cutoff = now - periodMs;

  const recentPoints = series.filter((p) => p.timestamp.getTime() > cutoff);
  if (recentPoints.length < 2) {
    return { trend: "stable", trendPercent: 0 };
  }

  const firstPoint = recentPoints[0];
  const lastPoint = recentPoints[recentPoints.length - 1];
  if (!firstPoint || !lastPoint) {
    return { trend: "stable", trendPercent: 0 };
  }
  const first = firstPoint.value;
  const last = lastPoint.value;

  if (first === 0) {
    return { trend: last > 0 ? "up" : "stable", trendPercent: 0 };
  }

  const percent = ((last - first) / first) * 100;

  if (percent > 5) {
    return { trend: "up", trendPercent: percent };
  } else if (percent < -5) {
    return { trend: "down", trendPercent: percent };
  }
  return { trend: "stable", trendPercent: percent };
}

/**
 * Get current metrics snapshot.
 */
export function getMetricsSnapshot(): MetricSnapshot {
  const correlationId = getCorrelationId();
  const now = new Date();

  // Collect agent metrics (from counters/gauges)
  const agentStatuses = [
    "spawning",
    "ready",
    "executing",
    "paused",
    "terminating",
    "terminated",
    "failed",
  ];
  const byStatus: Record<string, number> = {};
  for (const status of agentStatuses) {
    byStatus[status] = getGauge("flywheel_agents_active", { status });
  }

  const byDriver: Record<string, number> = {};
  for (const driver of ["sdk", "acp", "tmux"]) {
    byDriver[driver] = getGauge("flywheel_agents_active", { driver });
  }

  // Token trend
  const tokenTrend = calculateTrend("flywheel_tokens_used_total");

  // Calculate percentiles from histogram
  const latencyHist = getHistogram("flywheel_http_request_duration_ms");
  const p50 = latencyHist ? calculatePercentile(latencyHist, 50) : 0;
  const p95 = latencyHist ? calculatePercentile(latencyHist, 95) : 0;
  const p99 = latencyHist ? calculatePercentile(latencyHist, 99) : 0;
  const avgLatency =
    latencyHist && latencyHist.count > 0
      ? latencyHist.sum / latencyHist.count
      : 0;

  const requestCount = getCounter("flywheel_http_requests_total");
  const errorCount = getCounter("flywheel_http_requests_total", {
    status: "5xx",
  });
  const successRate =
    requestCount > 0 ? ((requestCount - errorCount) / requestCount) * 100 : 100;

  // Memory and CPU
  const memoryUsage = process.memoryUsage();
  const memoryMb = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const cpuPercent = 0; // Would need OS-level metrics

  return {
    timestamp: now,
    correlationId,
    agents: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      byDriver,
    },
    tokens: {
      last24h: getCounter("flywheel_tokens_used_24h"),
      last7d: getCounter("flywheel_tokens_used_7d"),
      last30d: getCounter("flywheel_tokens_used_30d"),
      byModel: {
        "claude-3-opus": getCounter("flywheel_tokens_used_total", {
          model: "claude-3-opus",
        }),
        "claude-3-sonnet": getCounter("flywheel_tokens_used_total", {
          model: "claude-3-sonnet",
        }),
        "claude-3-haiku": getCounter("flywheel_tokens_used_total", {
          model: "claude-3-haiku",
        }),
      },
      trend: tokenTrend.trend,
      trendPercent: tokenTrend.trendPercent,
    },
    performance: {
      avgResponseMs: avgLatency,
      p50ResponseMs: p50,
      p95ResponseMs: p95,
      p99ResponseMs: p99,
      successRate,
      requestCount,
      errorCount,
    },
    flywheel: {
      beadsOpen: getGauge("flywheel_beads_open"),
      beadsClosed24h: getCounter("flywheel_beads_closed_24h"),
      reservationsActive: getGauge("flywheel_reservations_active"),
      messagesExchanged24h: getCounter("flywheel_messages_exchanged_24h"),
    },
    system: {
      wsConnections: getConnectionCount(),
      apiLatencyMs: avgLatency,
      memoryUsageMb: memoryMb,
      cpuPercent,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    },
  };
}

/**
 * Calculate percentile from histogram buckets.
 * Note: Buckets are cumulative (each bucket.count = count of values <= bucket.le)
 */
function calculatePercentile(
  histogram: { buckets: HistogramBucket[]; count: number },
  percentile: number,
): number {
  if (histogram.count === 0) return 0;

  const targetCount = (percentile / 100) * histogram.count;

  // Buckets are already cumulative, so find the first bucket
  // where the cumulative count meets the target
  for (const bucket of histogram.buckets) {
    if (bucket.count >= targetCount) {
      return bucket.le;
    }
  }

  return histogram.buckets[histogram.buckets.length - 1]?.le ?? 0;
}

/**
 * Create a named snapshot for later comparison.
 */
export function createNamedSnapshot(
  name: string,
  description?: string,
  createdBy?: string,
): NamedSnapshot {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
  const id = `snapshot_${Date.now()}_${random}`;
  const snapshot: NamedSnapshot = {
    id,
    name,
    createdAt: new Date(),
    snapshot: getMetricsSnapshot(),
  };
  if (description !== undefined) snapshot.description = description;
  if (createdBy !== undefined) snapshot.createdBy = createdBy;

  namedSnapshots.set(id, snapshot);
  logger.info({ snapshotId: id, name }, "Created named metrics snapshot");

  // Enforce size limit
  if (namedSnapshots.size > MAX_SNAPSHOTS) {
    // Delete oldest (by insertion order in Map, which matches creation order here)
    const firstKey = namedSnapshots.keys().next().value;
    if (firstKey) {
      namedSnapshots.delete(firstKey);
    }
  }

  return snapshot;
}

/**
 * Delete a named snapshot.
 */
export function deleteNamedSnapshot(id: string): boolean {
  return namedSnapshots.delete(id);
}

/**
 * List all named snapshots.
 */
export function listNamedSnapshots(): NamedSnapshot[] {
  return Array.from(namedSnapshots.values()).sort((a, b) => {
    // Sort by creation time descending, then by ID descending for stable ordering
    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id.localeCompare(a.id);
  });
}

/**
 * Get a named snapshot by ID.
 */
export function getNamedSnapshot(id: string): NamedSnapshot | undefined {
  return namedSnapshots.get(id);
}

/**
 * Compare two time periods or snapshots.
 */
export function compareMetrics(
  baseline: MetricSnapshot,
  current: MetricSnapshot,
): MetricComparison {
  const changes: MetricComparison["changes"] = [];

  // Helper to add comparison
  const compare = (metric: string, baseVal: number, currVal: number) => {
    const delta = currVal - baseVal;
    const deltaPercent =
      baseVal !== 0 ? (delta / baseVal) * 100 : currVal !== 0 ? 100 : 0;
    const direction =
      deltaPercent > 5 ? "up" : deltaPercent < -5 ? "down" : "stable";
    changes.push({
      metric,
      baseline: baseVal,
      current: currVal,
      delta,
      deltaPercent,
      direction,
    });
  };

  // Compare key metrics
  compare("agents.total", baseline.agents.total, current.agents.total);
  compare(
    "performance.avgResponseMs",
    baseline.performance.avgResponseMs,
    current.performance.avgResponseMs,
  );
  compare(
    "performance.successRate",
    baseline.performance.successRate,
    current.performance.successRate,
  );
  compare(
    "system.memoryUsageMb",
    baseline.system.memoryUsageMb,
    current.system.memoryUsageMb,
  );
  compare(
    "system.wsConnections",
    baseline.system.wsConnections,
    current.system.wsConnections,
  );

  return {
    baseline: {
      period: { start: baseline.timestamp, end: baseline.timestamp },
      values: {
        "agents.total": baseline.agents.total,
        "performance.avgResponseMs": baseline.performance.avgResponseMs,
      },
    },
    current: {
      period: { start: current.timestamp, end: current.timestamp },
      values: {
        "agents.total": current.agents.total,
        "performance.avgResponseMs": current.performance.avgResponseMs,
      },
    },
    changes,
  };
}

/**
 * Export metrics in Prometheus format.
 */
export function exportPrometheusFormat(): string {
  const lines: string[] = [];

  // Export counters
  for (const [key, value] of store.counters) {
    lines.push(`${key} ${value}`);
  }

  // Export gauges
  for (const [key, value] of store.gauges) {
    lines.push(`${key} ${value}`);
  }

  // Export histograms
  for (const [key, histogram] of store.histograms) {
    const baseName = key.replace(/\{.*\}$/, "");
    const labels = key.match(/\{.*\}$/)?.[0] ?? "";

    for (let i = 0; i < histogram.buckets.length; i++) {
      const le = histogram.boundaries[i];
      const bucketLabels = labels
        ? labels.replace("}", `,le="${le}"}`)
        : `{le="${le}"}`;
      lines.push(`${baseName}_bucket${bucketLabels} ${histogram.buckets[i]}`);
    }

    // +Inf bucket
    const infLabels = labels
      ? labels.replace("}", ',le="+Inf"}')
      : '{le="+Inf"}';
    lines.push(`${baseName}_bucket${infLabels} ${histogram.count}`);

    // Sum and count
    lines.push(`${baseName}_sum${labels} ${histogram.sum}`);
    lines.push(`${baseName}_count${labels} ${histogram.count}`);
  }

  return lines.join("\n");
}

/**
 * Reset all metrics (for testing).
 */
export function resetMetrics(): void {
  store.counters.clear();
  store.gauges.clear();
  store.histograms.clear();
  timeSeries.clear();
  namedSnapshots.clear();
}
