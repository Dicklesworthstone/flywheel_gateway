/**
 * Metrics Data Model
 *
 * Defines the structure for all metrics collected by Flywheel Gateway.
 */

/**
 * Metric types supported by the system.
 */
export type MetricType = "counter" | "gauge" | "histogram";

/**
 * A metric label set.
 */
export type Labels = Record<string, string>;

/**
 * Base metric definition.
 */
export interface MetricDefinition {
  name: string;
  type: MetricType;
  description: string;
  unit?: string;
  labels?: string[];
}

/**
 * A recorded metric value.
 */
export interface MetricValue {
  name: string;
  type: MetricType;
  value: number;
  labels: Labels;
  timestamp: Date;
}

/**
 * Histogram bucket configuration.
 */
export interface HistogramBucket {
  le: number; // less than or equal
  count: number;
}

/**
 * Histogram metric value with distribution data.
 */
export interface HistogramValue extends MetricValue {
  type: "histogram";
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

/**
 * Aggregated metrics for a time period.
 */
export interface MetricAggregate {
  name: string;
  labels: Labels;
  period: {
    start: Date;
    end: Date;
  };
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50?: number;
  p95?: number;
  p99?: number;
}

/**
 * Current snapshot of all system metrics.
 */
export interface MetricSnapshot {
  timestamp: Date;
  correlationId: string;

  /** Agent metrics */
  agents: {
    total: number;
    byStatus: Record<string, number>;
    byDriver: Record<string, number>;
  };

  /** Token usage metrics */
  tokens: {
    last24h: number;
    last7d: number;
    last30d: number;
    byModel: Record<string, number>;
    trend: "up" | "down" | "stable";
    trendPercent: number;
  };

  /** API performance metrics */
  performance: {
    avgResponseMs: number;
    p50ResponseMs: number;
    p95ResponseMs: number;
    p99ResponseMs: number;
    successRate: number;
    requestCount: number;
    errorCount: number;
  };

  /** Flywheel coordination metrics */
  flywheel: {
    beadsOpen: number;
    beadsClosed24h: number;
    reservationsActive: number;
    messagesExchanged24h: number;
  };

  /** System health metrics */
  system: {
    wsConnections: number;
    apiLatencyMs: number;
    memoryUsageMb: number;
    cpuPercent: number;
    uptime: number;
  };
}

/**
 * Named snapshot for comparison.
 */
export interface NamedSnapshot {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  createdBy?: string;
  snapshot: MetricSnapshot;
}

/**
 * Metric comparison result.
 */
export interface MetricComparison {
  baseline: {
    period: { start: Date; end: Date };
    values: Record<string, number>;
  };
  current: {
    period: { start: Date; end: Date };
    values: Record<string, number>;
  };
  changes: Array<{
    metric: string;
    baseline: number;
    current: number;
    delta: number;
    deltaPercent: number;
    direction: "up" | "down" | "stable";
  }>;
}

/**
 * Standard histogram bucket boundaries for latency metrics.
 */
export const LATENCY_BUCKETS = [
  5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000,
] as const;

/**
 * Standard histogram bucket boundaries for size metrics.
 */
export const SIZE_BUCKETS = [
  100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000,
] as const;

/**
 * Core metric definitions for Flywheel Gateway.
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Agent metrics
  {
    name: "flywheel_agents_spawned_total",
    type: "counter",
    description: "Total number of agents spawned",
    labels: ["driver"],
  },
  {
    name: "flywheel_agents_active",
    type: "gauge",
    description: "Number of currently active agents",
    labels: ["status", "driver"],
  },
  {
    name: "flywheel_agents_terminated_total",
    type: "counter",
    description: "Total number of agents terminated",
    labels: ["driver", "reason"],
  },

  // Token metrics
  {
    name: "flywheel_tokens_used_total",
    type: "counter",
    description: "Total tokens consumed",
    unit: "tokens",
    labels: ["model", "agent_id"],
  },

  // API metrics
  {
    name: "flywheel_http_requests_total",
    type: "counter",
    description: "Total HTTP requests",
    labels: ["method", "path", "status"],
  },
  {
    name: "flywheel_http_request_duration_ms",
    type: "histogram",
    description: "HTTP request duration",
    unit: "ms",
    labels: ["method", "path"],
  },

  // WebSocket metrics
  {
    name: "flywheel_ws_connections",
    type: "gauge",
    description: "Active WebSocket connections",
  },
  {
    name: "flywheel_ws_messages_total",
    type: "counter",
    description: "Total WebSocket messages",
    labels: ["direction", "type"],
  },

  // System metrics
  {
    name: "flywheel_memory_bytes",
    type: "gauge",
    description: "Memory usage in bytes",
  },
  {
    name: "flywheel_cpu_percent",
    type: "gauge",
    description: "CPU usage percentage",
  },
  {
    name: "flywheel_uptime_seconds",
    type: "gauge",
    description: "Process uptime in seconds",
  },

  // Tool health metrics
  {
    name: "flywheel_tool_health_status",
    type: "gauge",
    description: "Tool health status (1=healthy, 0=unhealthy)",
    labels: ["tool"],
  },
  {
    name: "flywheel_tool_installed",
    type: "gauge",
    description: "Tool installation status (1=installed, 0=not installed)",
    labels: ["tool"],
  },
  {
    name: "flywheel_tool_check_duration_ms",
    type: "histogram",
    description: "Tool health check duration",
    unit: "ms",
    labels: ["tool"],
  },
  {
    name: "flywheel_tool_checksum_age_ms",
    type: "gauge",
    description: "Age of tool checksums since last refresh",
    unit: "ms",
  },
  {
    name: "flywheel_tool_checksum_stale",
    type: "gauge",
    description: "Whether tool checksums are stale (1=stale, 0=fresh)",
  },

  // Snapshot service metrics
  {
    name: "flywheel_snapshot_collection_total",
    type: "counter",
    description: "Total snapshot collection operations",
    labels: ["source", "status"],
  },
  {
    name: "flywheel_snapshot_collection_duration_ms",
    type: "histogram",
    description: "Snapshot collection duration by source",
    unit: "ms",
    labels: ["source"],
  },
  {
    name: "flywheel_snapshot_generation_duration_ms",
    type: "histogram",
    description: "Full snapshot generation duration",
    unit: "ms",
  },

  // NTM ingest metrics
  {
    name: "flywheel_ntm_state_transitions_total",
    type: "counter",
    description: "Total NTM agent state transitions",
    labels: ["from_state", "to_state"],
  },
  {
    name: "flywheel_ntm_agents_tracked",
    type: "gauge",
    description: "Number of agents currently tracked by NTM ingest",
  },
  {
    name: "flywheel_ntm_poll_duration_ms",
    type: "histogram",
    description: "NTM status poll duration",
    unit: "ms",
  },
  {
    name: "flywheel_ntm_poll_errors_total",
    type: "counter",
    description: "Total NTM poll errors",
    labels: ["error_type"],
  },
  {
    name: "flywheel_ntm_consecutive_errors",
    type: "gauge",
    description: "Current consecutive NTM poll errors",
  },
];
