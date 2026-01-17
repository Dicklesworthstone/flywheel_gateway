/**
 * useDashboard - Hook for managing dashboard state and operations.
 *
 * Provides:
 * - Dashboard CRUD operations
 * - Widget management
 * - Real-time data fetching
 * - Optimistic updates
 */

import type {
  CreateDashboardInput,
  Dashboard,
  DashboardSummary,
  RefreshInterval,
  UpdateDashboardInput,
  Widget,
  WidgetData,
} from "@flywheel/shared";
import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "/api/dashboards";

interface UseDashboardOptions {
  autoRefresh?: boolean;
  refreshInterval?: RefreshInterval;
}

interface DashboardState {
  dashboards: DashboardSummary[];
  currentDashboard: Dashboard | null;
  widgetData: Map<string, WidgetData>;
  loading: boolean;
  error: string | null;
  saving: boolean;
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data ?? data;
}

export function useDashboard(
  dashboardId?: string,
  options: UseDashboardOptions = {},
) {
  const { autoRefresh = true, refreshInterval = 60 } = options;

  const [state, setState] = useState<DashboardState>({
    dashboards: [],
    currentDashboard: null,
    widgetData: new Map(),
    loading: false,
    error: null,
    saving: false,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const widgetTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );

  // Keep a ref to current dashboard to avoid resetting timers on state changes
  const dashboardRef = useRef<Dashboard | null>(null);
  useEffect(() => {
    dashboardRef.current = state.currentDashboard;
  }, [state.currentDashboard]);

  // List all dashboards
  const listDashboards = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const data = await fetchJSON<{ items: DashboardSummary[] }>(API_BASE);
      setState((s) => ({
        ...s,
        dashboards: data.items ?? [],
        loading: false,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error:
          err instanceof Error ? err.message : "Failed to load dashboards",
      }));
    }
  }, []);

  // Get a specific dashboard
  const getDashboard = useCallback(async (id: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const dashboard = await fetchJSON<Dashboard>(`${API_BASE}/${id}`);
      setState((s) => ({
        ...s,
        currentDashboard: dashboard,
        loading: false,
      }));
      return dashboard;
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error:
          err instanceof Error ? err.message : "Failed to load dashboard",
      }));
      return null;
    }
  }, []);

  // Create a new dashboard
  const createDashboard = useCallback(async (input: CreateDashboardInput) => {
    setState((s) => ({ ...s, saving: true, error: null }));

    try {
      const dashboard = await fetchJSON<Dashboard>(API_BASE, {
        method: "POST",
        body: JSON.stringify(input),
      });

      setState((s) => ({
        ...s,
        dashboards: [
          {
            id: dashboard.id,
            name: dashboard.name,
            description: dashboard.description ?? "",
            ownerId: dashboard.ownerId,
            visibility: dashboard.sharing.visibility,
            widgetCount: dashboard.widgets.length,
            createdAt: dashboard.createdAt,
            updatedAt: dashboard.updatedAt,
          },
          ...s.dashboards,
        ],
        currentDashboard: dashboard,
        saving: false,
      }));

      return dashboard;
    } catch (err) {
      setState((s) => ({
        ...s,
        saving: false,
        error:
          err instanceof Error ? err.message : "Failed to create dashboard",
      }));
      return null;
    }
  }, []);

  // Update a dashboard
  const updateDashboard = useCallback(
    async (id: string, input: UpdateDashboardInput) => {
      setState((s) => ({ ...s, saving: true, error: null }));

      // Optimistic update
      const previousDashboard = state.currentDashboard;
      if (state.currentDashboard?.id === id) {
        setState((s) => ({
          ...s,
          currentDashboard: s.currentDashboard
            ? {
                ...s.currentDashboard,
                ...input,
                layout: input.layout
                  ? { ...s.currentDashboard.layout, ...input.layout }
                  : s.currentDashboard.layout,
                sharing: input.sharing
                  ? { ...s.currentDashboard.sharing, ...input.sharing }
                  : s.currentDashboard.sharing,
                updatedAt: new Date().toISOString(),
              }
            : null,
        }));
      }

      try {
        const dashboard = await fetchJSON<Dashboard>(`${API_BASE}/${id}`, {
          method: "PUT",
          body: JSON.stringify(input),
        });

        setState((s) => ({
          ...s,
          currentDashboard: dashboard,
          dashboards: s.dashboards.map((d) =>
            d.id === id
              ? {
                  ...d,
                  name: dashboard.name,
                  description: dashboard.description ?? "",
                  visibility: dashboard.sharing.visibility,
                  widgetCount: dashboard.widgets.length,
                  updatedAt: dashboard.updatedAt,
                }
              : d,
          ),
          saving: false,
        }));

        return dashboard;
      } catch (err) {
        // Revert optimistic update
        setState((s) => ({
          ...s,
          currentDashboard: previousDashboard,
          saving: false,
          error:
            err instanceof Error ? err.message : "Failed to update dashboard",
        }));
        return null;
      }
    },
    [state.currentDashboard],
  );

  // Delete a dashboard
  const deleteDashboard = useCallback(async (id: string) => {
    setState((s) => ({ ...s, saving: true, error: null }));

    try {
      await fetchJSON(`${API_BASE}/${id}`, { method: "DELETE" });

      setState((s) => ({
        ...s,
        dashboards: s.dashboards.filter((d) => d.id !== id),
        currentDashboard:
          s.currentDashboard?.id === id ? null : s.currentDashboard,
        saving: false,
      }));

      return true;
    } catch (err) {
      setState((s) => ({
        ...s,
        saving: false,
        error:
          err instanceof Error ? err.message : "Failed to delete dashboard",
      }));
      return false;
    }
  }, []);

  // Duplicate a dashboard
  const duplicateDashboard = useCallback(async (id: string) => {
    setState((s) => ({ ...s, saving: true, error: null }));

    try {
      const dashboard = await fetchJSON<Dashboard>(
        `${API_BASE}/${id}/duplicate`,
        {
          method: "POST",
        },
      );

      setState((s) => ({
        ...s,
        dashboards: [
          {
            id: dashboard.id,
            name: dashboard.name,
            description: dashboard.description ?? "",
            ownerId: dashboard.ownerId,
            visibility: dashboard.sharing.visibility,
            widgetCount: dashboard.widgets.length,
            createdAt: dashboard.createdAt,
            updatedAt: dashboard.updatedAt,
          },
          ...s.dashboards,
        ],
        saving: false,
      }));

      return dashboard;
    } catch (err) {
      setState((s) => ({
        ...s,
        saving: false,
        error:
          err instanceof Error ? err.message : "Failed to duplicate dashboard",
      }));
      return null;
    }
  }, []);

  // Add widget to current dashboard
  const addWidget = useCallback(
    async (widget: Omit<Widget, "id">) => {
      if (!state.currentDashboard) return null;

      setState((s) => ({ ...s, saving: true, error: null }));

      try {
        // API returns the updated Dashboard, not just the widget
        const updatedDashboard = await fetchJSON<Dashboard>(
          `${API_BASE}/${state.currentDashboard.id}/widgets`,
          {
            method: "POST",
            body: JSON.stringify(widget),
          },
        );

        // Find the newly added widget (it will be the last one)
        const newWidget =
          updatedDashboard.widgets[updatedDashboard.widgets.length - 1];

        setState((s) => ({
          ...s,
          currentDashboard: updatedDashboard,
          saving: false,
        }));

        return newWidget;
      } catch (err) {
        setState((s) => ({
          ...s,
          saving: false,
          error: err instanceof Error ? err.message : "Failed to add widget",
        }));
        return null;
      }
    },
    [state.currentDashboard],
  );

  // Update a widget
  const updateWidget = useCallback(
    async (widgetId: string, updates: Partial<Widget>) => {
      if (!state.currentDashboard) return null;

      setState((s) => ({ ...s, saving: true, error: null }));

      // Optimistic update
      const previousDashboard = state.currentDashboard;
      setState((s) => ({
        ...s,
        currentDashboard: s.currentDashboard
          ? {
              ...s.currentDashboard,
              widgets: s.currentDashboard.widgets.map((w) =>
                w.id === widgetId ? { ...w, ...updates } : w,
              ),
            }
          : null,
      }));

      try {
        // API returns the updated Dashboard, not just the widget
        const updatedDashboard = await fetchJSON<Dashboard>(
          `${API_BASE}/${state.currentDashboard.id}/widgets/${widgetId}`,
          {
            method: "PUT",
            body: JSON.stringify(updates),
          },
        );

        // Find the updated widget
        const updatedWidget = updatedDashboard.widgets.find(
          (w) => w.id === widgetId,
        );

        setState((s) => ({
          ...s,
          currentDashboard: updatedDashboard,
          saving: false,
        }));

        return updatedWidget ?? null;
      } catch (err) {
        // Revert optimistic update
        setState((s) => ({
          ...s,
          currentDashboard: previousDashboard,
          saving: false,
          error: err instanceof Error ? err.message : "Failed to update widget",
        }));
        return null;
      }
    },
    [state.currentDashboard],
  );

  // Remove a widget
  const removeWidget = useCallback(
    async (widgetId: string) => {
      if (!state.currentDashboard) return false;

      setState((s) => ({ ...s, saving: true, error: null }));

      // Optimistic update
      const previousWidgets = state.currentDashboard.widgets;
      setState((s) => ({
        ...s,
        currentDashboard: s.currentDashboard
          ? {
              ...s.currentDashboard,
              widgets: s.currentDashboard.widgets.filter(
                (w) => w.id !== widgetId,
              ),
            }
          : null,
      }));

      try {
        await fetchJSON(
          `${API_BASE}/${state.currentDashboard.id}/widgets/${widgetId}`,
          {
            method: "DELETE",
          },
        );

        // Clear widget data
        setState((s) => {
          const newWidgetData = new Map(s.widgetData);
          newWidgetData.delete(widgetId);
          return { ...s, widgetData: newWidgetData, saving: false };
        });

        return true;
      } catch (err) {
        // Revert optimistic update
        setState((s) => ({
          ...s,
          currentDashboard: s.currentDashboard
            ? { ...s.currentDashboard, widgets: previousWidgets }
            : null,
          saving: false,
          error: err instanceof Error ? err.message : "Failed to remove widget",
        }));
        return false;
      }
    },
    [state.currentDashboard],
  );

  // Fetch widget data
  const fetchWidgetData = useCallback(async (widgetId: string) => {
    const dashboard = dashboardRef.current;
    if (!dashboard) return null;

    try {
      const data = await fetchJSON<WidgetData>(
        `${API_BASE}/${dashboard.id}/widgets/${widgetId}/data`,
      );

      setState((s) => {
        const newWidgetData = new Map(s.widgetData);
        newWidgetData.set(widgetId, data);
        return { ...s, widgetData: newWidgetData };
      });

      return data;
    } catch (err) {
      const errorData: WidgetData = {
        widgetId,
        data: null,
        fetchedAt: new Date().toISOString(),
        error:
          err instanceof Error ? err.message : "Failed to fetch widget data",
      };

      setState((s) => {
        const newWidgetData = new Map(s.widgetData);
        newWidgetData.set(widgetId, errorData);
        return { ...s, widgetData: newWidgetData };
      });

      return errorData;
    }
  }, []);

  // Refresh all widgets
  const refreshAllWidgets = useCallback(async () => {
    const dashboard = dashboardRef.current;
    if (!dashboard) return;

    await Promise.all(
      dashboard.widgets.map((widget) => fetchWidgetData(widget.id)),
    );
  }, [fetchWidgetData]);

  // Toggle favorite
  const toggleFavorite = useCallback(
    async (id: string, isFavorite: boolean) => {
      try {
        if (isFavorite) {
          await fetchJSON(`${API_BASE}/${id}/favorite`, { method: "DELETE" });
        } else {
          await fetchJSON(`${API_BASE}/${id}/favorite`, { method: "POST" });
        }

        setState((s) => ({
          ...s,
          dashboards: s.dashboards.map((d) =>
            d.id === id ? { ...d, isFavorite: !isFavorite } : d,
          ),
        }));

        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  // Update layout positions (bulk widget position update)
  const updateLayout = useCallback(
    async (
      layouts: Array<{
        widgetId: string;
        position: Widget["position"];
      }>,
    ) => {
      if (!state.currentDashboard) return;

      // Optimistic update
      setState((s) => ({
        ...s,
        currentDashboard: s.currentDashboard
          ? {
              ...s.currentDashboard,
              widgets: s.currentDashboard.widgets.map((widget) => {
                const layout = layouts.find((l) => l.widgetId === widget.id);
                return layout
                  ? { ...widget, position: layout.position }
                  : widget;
              }),
            }
          : null,
      }));

      // Send updates to server
      try {
        await Promise.all(
          layouts.map(({ widgetId, position }) =>
            fetchJSON(
              `${API_BASE}/${state.currentDashboard?.id}/widgets/${widgetId}`,
              {
                method: "PUT",
                body: JSON.stringify({ position }),
              },
            ),
          ),
        );
      } catch {
        // Layout changes are typically non-critical - silently fail
        // The optimistic update is already applied, so the UI remains consistent
      }
    },
    [state.currentDashboard],
  );

  // Set up auto-refresh for dashboard
  useEffect(() => {
    if (!autoRefresh || !state.currentDashboard?.id || refreshInterval === 0) {
      return;
    }

    refreshTimerRef.current = setInterval(() => {
      refreshAllWidgets();
    }, refreshInterval * 1000);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [
    autoRefresh,
    state.currentDashboard?.id,
    refreshInterval,
    refreshAllWidgets,
  ]);

  // Set up individual widget refresh timers
  const widgetConfigStr = JSON.stringify(
    state.currentDashboard?.widgets.map((w) => ({
      id: w.id,
      interval: w.refreshInterval,
    })),
  );

  useEffect(() => {
    const dashboard = dashboardRef.current;
    if (!dashboard) return;

    // Clear existing timers
    widgetTimersRef.current.forEach((timer) => {
      clearInterval(timer);
    });
    widgetTimersRef.current.clear();

    // Set up per-widget timers for widgets with custom intervals
    dashboard.widgets.forEach((widget) => {
      if (widget.refreshInterval && widget.refreshInterval > 0) {
        const timer = setInterval(() => {
          fetchWidgetData(widget.id);
        }, widget.refreshInterval * 1000);

        widgetTimersRef.current.set(widget.id, timer);
      }
    });

    return () => {
      widgetTimersRef.current.forEach((timer) => {
        clearInterval(timer);
      });
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: widgetConfigStr is used as a trigger
  }, [widgetConfigStr, fetchWidgetData]);

  // Load dashboard on mount if ID provided
  useEffect(() => {
    if (dashboardId) {
      getDashboard(dashboardId);
    }
  }, [dashboardId, getDashboard]);

  // Fetch initial widget data when dashboard is loaded
  const prevDashboardIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      state.currentDashboard &&
      state.currentDashboard.id !== prevDashboardIdRef.current
    ) {
      prevDashboardIdRef.current = state.currentDashboard.id;
      // Fetch initial widget data
      state.currentDashboard.widgets.forEach((widget) => {
        fetchWidgetData(widget.id);
      });
    }
  }, [state.currentDashboard, fetchWidgetData]);

  // Clear error
  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    // State
    ...state,

    // Dashboard operations
    listDashboards,
    getDashboard,
    createDashboard,
    updateDashboard,
    deleteDashboard,
    duplicateDashboard,

    // Widget operations
    addWidget,
    updateWidget,
    removeWidget,
    updateLayout,

    // Data operations
    fetchWidgetData,
    refreshAllWidgets,

    // Utility
    toggleFavorite,
    clearError,
  };
}

export type UseDashboardReturn = ReturnType<typeof useDashboard>;
