// Dashboard types for Custom Dashboard Builder

/**
 * Widget types available in the dashboard builder
 */
export type WidgetType =
  | "metric-card" // Single KPI with trend
  | "line-chart" // Time series
  | "bar-chart" // Categorical comparison
  | "pie-chart" // Distribution
  | "table" // Tabular data
  | "agent-list" // Agent status list
  | "activity-feed" // Recent events stream
  | "cost-breakdown" // Cost visualization
  | "heatmap" // Usage patterns
  | "gauge" // Progress/capacity
  | "text" // Markdown content
  | "iframe"; // External embeds

/**
 * Dashboard visibility levels
 */
export type DashboardVisibility = "private" | "team" | "public";

/**
 * Permission levels for dashboard access
 */
export type DashboardPermission = "view" | "edit";

/**
 * Time range presets for data queries
 */
export type TimeRangePreset =
  | "15m"
  | "1h"
  | "6h"
  | "24h"
  | "7d"
  | "30d"
  | "custom";

/**
 * Auto-refresh interval options (in seconds)
 */
export type RefreshInterval = 0 | 15 | 30 | 60 | 300 | 900;

/**
 * Grid position for a widget
 */
export interface WidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

/**
 * Data source configuration for widgets
 */
export interface DataSourceConfig {
  type: "api" | "query" | "static";
  endpoint?: string;
  query?: string;
  filters?: Record<string, unknown>;
  timeRange?: {
    preset: TimeRangePreset;
    start?: string;
    end?: string;
  };
}

/**
 * Display configuration varies by widget type
 */
export interface DisplayConfig {
  colorScheme?: string;
  showLegend?: boolean;
  showGrid?: boolean;
  showLabels?: boolean;
  labelPosition?: "top" | "bottom" | "left" | "right";
  animationEnabled?: boolean;
}

/**
 * Threshold configuration for metric widgets
 */
export interface ThresholdConfig {
  warning?: number;
  critical?: number;
  warningColor?: string;
  criticalColor?: string;
}

/**
 * Widget configuration
 */
export interface WidgetConfig {
  dataSource: DataSourceConfig;
  display?: DisplayConfig;
  thresholds?: ThresholdConfig;
  customOptions?: Record<string, unknown>;
}

/**
 * A widget instance on a dashboard
 */
export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  description?: string;
  position: WidgetPosition;
  config: WidgetConfig;
  refreshInterval?: RefreshInterval;
}

/**
 * Dashboard layout configuration
 */
export interface DashboardLayout {
  columns: number; // typically 12 or 24
  rowHeight: number;
  margin: [number, number];
  containerPadding: [number, number];
}

/**
 * Dashboard sharing configuration
 */
export interface DashboardSharing {
  visibility: DashboardVisibility;
  teamId?: string;
  viewers: string[];
  editors: string[];
  publicSlug?: string;
  requireAuth: boolean;
  embedEnabled: boolean;
  embedToken?: string;
}

/**
 * Full dashboard definition
 */
export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  workspaceId: string;
  layout: DashboardLayout;
  widgets: Widget[];
  sharing: DashboardSharing;
  refreshInterval: RefreshInterval;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a new dashboard
 */
export interface CreateDashboardInput {
  name: string;
  description?: string;
  workspaceId?: string;
  layout?: Partial<DashboardLayout>;
  widgets?: Widget[];
  sharing?: Partial<DashboardSharing>;
  refreshInterval?: RefreshInterval;
}

/**
 * Input for updating an existing dashboard
 */
export interface UpdateDashboardInput {
  name?: string;
  description?: string;
  layout?: Partial<DashboardLayout>;
  widgets?: Widget[];
  sharing?: Partial<DashboardSharing>;
  refreshInterval?: RefreshInterval;
}

/**
 * Dashboard list item (summary without full widget data)
 */
export interface DashboardSummary {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  ownerName?: string;
  visibility: DashboardVisibility;
  widgetCount: number;
  isFavorite?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Dashboard permission entry
 */
export interface DashboardPermissionEntry {
  dashboardId: string;
  userId: string;
  userName?: string;
  permission: DashboardPermission;
  grantedAt: string;
}

/**
 * Widget data response
 */
export interface WidgetData {
  widgetId: string;
  data: unknown;
  fetchedAt: string;
  error?: string;
}

/**
 * Widget gallery item definition
 */
export interface WidgetDefinition {
  type: WidgetType;
  name: string;
  description: string;
  icon: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  configSchema?: Record<string, unknown>;
}

/**
 * Default layout configuration
 */
export const DEFAULT_LAYOUT: DashboardLayout = {
  columns: 12,
  rowHeight: 80,
  margin: [16, 16],
  containerPadding: [16, 16],
};

/**
 * Default sharing configuration
 */
export const DEFAULT_SHARING: DashboardSharing = {
  visibility: "private",
  viewers: [],
  editors: [],
  requireAuth: true,
  embedEnabled: false,
};
