/**
 * DashboardsPage - Custom dashboard builder and viewer.
 *
 * Features:
 * - List view of all dashboards
 * - Dashboard viewer with auto-refresh
 * - Edit mode with drag-and-drop layout
 * - Widget gallery and configuration
 */

import type { Widget, WidgetType } from "@flywheel/shared";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useState } from "react";
import {
  DashboardGrid,
  WIDGET_DEFINITIONS,
  WidgetConfigPanel,
  WidgetGallery,
} from "../components/dashboard";
import { useDashboard } from "../hooks/useDashboard";
import "./Dashboards.css";

export function DashboardsPage() {
  // Get dashboard ID from URL params if present
  const { dashboardId } = useParams({ strict: false }) as {
    dashboardId?: string;
  };
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [editingWidget, setEditingWidget] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");

  const {
    dashboards,
    currentDashboard,
    widgetData,
    loading,
    error,
    saving,
    listDashboards,
    getDashboard: _getDashboard,
    createDashboard,
    updateDashboard: _updateDashboard,
    deleteDashboard: _deleteDashboard,
    duplicateDashboard,
    addWidget,
    updateWidget,
    removeWidget,
    updateLayout,
    fetchWidgetData,
    toggleFavorite,
    clearError,
  } = useDashboard(dashboardId);

  // Load dashboards list on mount
  useEffect(() => {
    listDashboards();
  }, [listDashboards]);

  // Handle creating a new dashboard
  const handleCreate = async () => {
    if (!newDashboardName.trim()) return;

    const dashboard = await createDashboard({
      name: newDashboardName.trim(),
      description: "",
    });

    if (dashboard) {
      setNewDashboardName("");
      setShowCreateModal(false);
      navigate({ to: `/dashboards/${dashboard.id}` });
    }
  };

  const handleCardKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    dashboardIdValue: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate({ to: `/dashboards/${dashboardIdValue}` });
    }
  };

  const handleOverlayKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setShowCreateModal(false);
    }
  };

  const handleModalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setShowCreateModal(false);
    }
  };

  // Handle adding a widget
  const handleAddWidget = async (type: WidgetType) => {
    const definition = WIDGET_DEFINITIONS.find((d) => d.type === type);
    if (!definition) return;

    // Find an empty spot in the grid
    const existingPositions =
      currentDashboard?.widgets.map((w) => w.position) || [];
    const columns = currentDashboard?.layout.columns || 12;

    // Simple placement: find next available row
    let maxY = 0;
    existingPositions.forEach((pos) => {
      const bottom = pos.y + pos.h;
      if (bottom > maxY) maxY = bottom;
    });

    const newWidget: Omit<Widget, "id"> = {
      type,
      title: definition.name,
      position: {
        x: 0,
        y: maxY,
        w: Math.min(definition.defaultSize.w, columns),
        h: definition.defaultSize.h,
        ...(definition.minSize?.w !== null &&
          definition.minSize?.w !== undefined && {
            minW: definition.minSize.w,
          }),
        ...(definition.minSize?.h !== null &&
          definition.minSize?.h !== undefined && {
            minH: definition.minSize.h,
          }),
      },
      config: {
        dataSource: {
          type: "api",
          endpoint: "",
        },
        display: {
          showLegend: true,
          showLabels: true,
          animationEnabled: true,
        },
      },
    };

    const added = await addWidget(newWidget);
    if (added) {
      setShowGallery(false);
      setEditingWidget(added.id);
    }
  };

  // Handle widget config save
  const handleWidgetSave = async (updates: Partial<Widget>) => {
    if (!editingWidget) return;

    await updateWidget(editingWidget, updates);
    setEditingWidget(null);

    // Refresh widget data if endpoint changed
    if (updates.config?.dataSource?.endpoint) {
      fetchWidgetData(editingWidget);
    }
  };

  // Dashboard list view
  if (!dashboardId) {
    return (
      <div className="dashboards-page">
        <div className="dashboards-page__header">
          <div>
            <h1>Custom Dashboards</h1>
            <p className="muted">Build and manage your own dashboards</p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShowCreateModal(true)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Dashboard
          </button>
        </div>

        {loading ? (
          <div className="dashboards-page__loading">Loading dashboards...</div>
        ) : error ? (
          <div className="dashboards-page__error">
            <p>{error}</p>
            <button type="button" onClick={clearError}>
              Dismiss
            </button>
          </div>
        ) : dashboards.length === 0 ? (
          <div className="dashboards-page__empty">
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <h3>No dashboards yet</h3>
            <p>Create your first custom dashboard to get started</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setShowCreateModal(true)}
            >
              Create Dashboard
            </button>
          </div>
        ) : (
          <div className="dashboards-page__grid">
            {dashboards.map((dashboard) => (
              // biome-ignore lint/a11y/useSemanticElements: card contains nested button controls
              <div
                key={dashboard.id}
                className="dashboards-page__card"
                onClick={() => navigate({ to: `/dashboards/${dashboard.id}` })}
                onKeyDown={(event) => handleCardKeyDown(event, dashboard.id)}
                role="button"
                tabIndex={0}
              >
                <div className="dashboards-page__card-header">
                  <h3>{dashboard.name}</h3>
                  <button
                    type="button"
                    className={`dashboards-page__favorite ${dashboard.isFavorite ? "dashboards-page__favorite--active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(
                        dashboard.id,
                        dashboard.isFavorite || false,
                      );
                    }}
                    aria-label={
                      dashboard.isFavorite
                        ? "Remove from favorites"
                        : "Add to favorites"
                    }
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill={dashboard.isFavorite ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  </button>
                </div>
                {dashboard.description && (
                  <p className="dashboards-page__card-description">
                    {dashboard.description}
                  </p>
                )}
                <div className="dashboards-page__card-meta">
                  <span>{dashboard.widgetCount} widgets</span>
                  <span>Updated {formatTimeAgo(dashboard.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create Modal */}
        {showCreateModal && (
          // biome-ignore lint/a11y/useSemanticElements: modal overlay isn't a semantic button
          <div
            className="dashboards-page__modal-overlay"
            onClick={() => setShowCreateModal(false)}
            onKeyDown={handleOverlayKeyDown}
            role="button"
            tabIndex={0}
            aria-label="Close create dashboard modal"
          >
            <div
              className="dashboards-page__modal"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={handleModalKeyDown}
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
            >
              <h2>Create Dashboard</h2>
              <div className="dashboards-page__modal-field">
                <label htmlFor="dashboard-name">Name</label>
                <input
                  id="dashboard-name"
                  type="text"
                  value={newDashboardName}
                  onChange={(e) => setNewDashboardName(e.target.value)}
                  placeholder="My Dashboard"
                />
              </div>
              <div className="dashboards-page__modal-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleCreate}
                  disabled={!newDashboardName.trim() || saving}
                >
                  {saving ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Dashboard view/edit
  if (loading || !currentDashboard) {
    return (
      <div className="dashboards-page">
        <div className="dashboards-page__loading">Loading dashboard...</div>
      </div>
    );
  }

  const editingWidgetData = editingWidget
    ? currentDashboard.widgets.find((w) => w.id === editingWidget)
    : null;

  return (
    <div className="dashboards-page dashboards-page--viewer">
      {/* Header */}
      <div className="dashboards-page__header">
        <div className="dashboards-page__breadcrumb">
          <button
            type="button"
            className="dashboards-page__back"
            onClick={() => navigate({ to: "/dashboards" })}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h1>{currentDashboard.name}</h1>
          {saving && <span className="dashboards-page__saving">Saving...</span>}
        </div>

        <div className="dashboards-page__actions">
          {isEditing ? (
            <>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setShowGallery(true)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Widget
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setIsEditing(false)}
              >
                Done Editing
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => duplicateDashboard(currentDashboard.id)}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="dashboards-page__content">
        <div className="dashboards-page__grid-container">
          <DashboardGrid
            dashboard={currentDashboard}
            widgetData={widgetData}
            isEditing={isEditing}
            onWidgetEdit={(widgetId) => setEditingWidget(widgetId)}
            onWidgetRemove={(widgetId) => removeWidget(widgetId)}
            onWidgetRefresh={(widgetId) => fetchWidgetData(widgetId)}
            onLayoutChange={updateLayout}
          />
        </div>

        {/* Side panels */}
        {showGallery && (
          <div className="dashboards-page__panel">
            <WidgetGallery
              onAddWidget={handleAddWidget}
              onClose={() => setShowGallery(false)}
            />
          </div>
        )}

        {editingWidgetData && (
          <div className="dashboards-page__panel">
            <WidgetConfigPanel
              widget={editingWidgetData}
              onSave={handleWidgetSave}
              onCancel={() => setEditingWidget(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}
