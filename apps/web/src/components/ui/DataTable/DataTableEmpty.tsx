/**
 * DataTable Empty/Loading/Error states component.
 *
 * Renders appropriate state feedback for the table.
 */

import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { DataTableEmptyProps } from "./types";

/**
 * Skeleton row for loading state.
 */
function SkeletonRow({ columns }: { columns: number }) {
  const columnKeys = Array.from(
    { length: Math.max(columns - 1, 0) },
    (_, index) => `skeleton-col-${columns}-${index + 1}`,
  );

  return (
    <div className="data-table__skeleton-row">
      <div className="skeleton" style={{ width: 18, height: 18 }} />
      {columnKeys.map((key) => (
        <div
          key={key}
          className="skeleton skeleton--text"
          style={{ width: `${60 + Math.random() * 40}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Loading state component.
 */
function LoadingState({
  skeletonRows = 5,
  columns = 5,
}: {
  skeletonRows?: number;
  columns?: number;
}) {
  const rowKeys = Array.from(
    { length: Math.max(skeletonRows, 0) },
    (_, index) => `skeleton-row-${skeletonRows}-${index + 1}`,
  );

  return (
    <div className="data-table__loading">
      {rowKeys.map((key) => (
        <SkeletonRow key={key} columns={columns} />
      ))}
    </div>
  );
}

/**
 * Error state component.
 */
function ErrorState({
  error,
  onRetry,
}: {
  error: Error | string;
  onRetry?: (() => void) | undefined;
}) {
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div className="data-table__empty">
      <div className="data-table__empty-icon">
        <AlertCircle size={48} />
      </div>
      <h3 className="data-table__empty-title">Something went wrong</h3>
      <p className="data-table__empty-message">{errorMessage}</p>
      {onRetry && (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          <RefreshCw size={16} />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Empty state component.
 */
function EmptyState({
  title = "No data found",
  message = "There are no items to display.",
}: {
  title?: string | undefined;
  message?: string | undefined;
}) {
  return (
    <div className="data-table__empty">
      <div className="data-table__empty-icon">
        <Inbox size={48} />
      </div>
      <h3 className="data-table__empty-title">{title}</h3>
      <p className="data-table__empty-message">{message}</p>
    </div>
  );
}

/**
 * DataTable Empty component.
 *
 * Renders loading, error, or empty state based on props.
 */
export function DataTableEmpty({
  loading = false,
  error = null,
  emptyTitle,
  emptyMessage,
  onRetry,
  loadingComponent,
  errorComponent,
  emptyComponent,
  skeletonRows = 5,
  columns = 5,
}: DataTableEmptyProps) {
  // Loading state
  if (loading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }
    return <LoadingState skeletonRows={skeletonRows} columns={columns} />;
  }

  // Error state
  if (error) {
    if (errorComponent) {
      return <>{errorComponent}</>;
    }
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  // Empty state
  if (emptyComponent) {
    return <>{emptyComponent}</>;
  }
  return <EmptyState title={emptyTitle} message={emptyMessage} />;
}
