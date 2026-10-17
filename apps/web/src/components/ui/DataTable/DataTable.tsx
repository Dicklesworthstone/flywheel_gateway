/**
 * DataTable component.
 *
 * A comprehensive data table with sorting, filtering, pagination,
 * row selection, and responsive mobile view.
 */

import { AnimatePresence } from "framer-motion";
import { DataTableBody } from "./DataTableBody";
import { DataTableBulkActions } from "./DataTableBulkActions";
import { DataTableCards } from "./DataTableCards";
import { DataTableEmpty } from "./DataTableEmpty";
import { DataTableHeader } from "./DataTableHeader";
import { DataTablePagination } from "./DataTablePagination";
import { DataTableToolbar } from "./DataTableToolbar";
import type { DataTableProps } from "./types";
import { useDataTable } from "./useDataTable";
import { isIndeterminate } from "./useRowSelection";

/**
 * Default page size options.
 */
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * DataTable component.
 *
 * @example
 * ```tsx
 * <DataTable
 *   id="agents-table"
 *   data={agents}
 *   columns={columns}
 *   getRowId={(a) => a.id}
 *   selectable
 *   searchable
 *   paginated
 *   bulkActions={[
 *     { id: "delete", label: "Delete", variant: "danger", onAction: handleDelete }
 *   ]}
 *   onRowClick={(agent) => navigate(`/agents/${agent.id}`)}
 * />
 * ```
 */
export function DataTable<T>({
  id,
  data,
  columns,
  getRowId,
  // Features
  selectable = false,
  searchable = false,
  searchPlaceholder,
  paginated = false,
  sortable = true,
  expandable = false,
  // Handlers
  onRowClick,
  onRowDoubleClick: _onRowDoubleClick,
  onSelectionChange,
  onSortChange,
  onPageChange,
  onSearchChange,
  // Bulk actions
  bulkActions = [],
  // Filters
  filters: externalFilters,
  onFilterChange,
  // Expansion
  renderExpandedRow,
  // Pagination
  initialPageSize = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  pagination: externalPagination,
  // Sorting
  initialSort,
  // Loading/Error
  loading = false,
  error = null,
  loadingComponent,
  errorComponent,
  emptyComponent,
  emptyTitle,
  emptyMessage,
  // Styling
  className = "",
  ariaLabel,
  ariaLabelledBy,
}: DataTableProps<T>) {
  const {
    // Processed data
    displayedData,
    // Search
    searchQuery,
    setSearchQuery,
    // Sorting
    sortState,
    handleSort,
    // Pagination
    pagination,
    handlePageChange,
    handlePageSizeChange,
    // Selection
    selection,
    selectedRows,
    handleSelectRow,
    handleSelectAll,
    clearSelection,
    // Expansion
    expandedIds,
    handleToggleExpand,
    // Filters
    filters,
    removeFilter,
    clearFilters,
  } = useDataTable(
    // Build options conditionally (for exactOptionalPropertyTypes)
    (() => {
      const opts: Parameters<typeof useDataTable<T>>[0] = {
        data,
        columns,
        getRowId,
        initialPageSize,
      };
      if (initialSort !== undefined) opts.initialSort = initialSort;
      if (externalPagination !== undefined)
        opts.externalPagination = externalPagination;
      if (onSortChange !== undefined) opts.onSortChange = onSortChange;
      if (onPageChange !== undefined) opts.onPageChange = onPageChange;
      if (onSearchChange !== undefined) opts.onSearchChange = onSearchChange;
      if (onSelectionChange !== undefined)
        opts.onSelectionChange = onSelectionChange;
      return opts;
    })(),
  );

  // Use external filters if provided
  const activeFilters = externalFilters ?? filters;

  // Determine if table is empty
  const isEmpty = !loading && !error && displayedData.length === 0;
  const hasData = displayedData.length > 0;

  // Selection state
  const selectedCount = selection.selected.size;
  const isAllSelected = selection.isAllPageSelected;
  const isPartiallySelected = isIndeterminate(
    selectedCount,
    displayedData.length,
  );

  return (
    <section
      className={`data-table ${className}`}
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {/* Toolbar: Search and Filters */}
      {(searchable || activeFilters.length > 0) && (
        <DataTableToolbar
          searchable={searchable}
          searchValue={searchQuery}
          searchPlaceholder={searchPlaceholder}
          onSearchChange={setSearchQuery}
          filters={activeFilters}
          onFilterRemove={
            onFilterChange
              ? (id) => {
                  const newFilters = activeFilters.filter((f) => f.id !== id);
                  onFilterChange(newFilters);
                }
              : removeFilter
          }
          onClearFilters={
            onFilterChange ? () => onFilterChange([]) : clearFilters
          }
        />
      )}

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectable && selectedCount > 0 && bulkActions.length > 0 && (
          <DataTableBulkActions
            selectedCount={selectedCount}
            selectedRows={selectedRows}
            actions={bulkActions}
            onClearSelection={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Loading/Error/Empty States */}
      {(loading || error || isEmpty) && (
        <DataTableEmpty
          loading={loading}
          error={error}
          emptyTitle={emptyTitle}
          emptyMessage={emptyMessage}
          loadingComponent={loadingComponent}
          errorComponent={errorComponent}
          emptyComponent={emptyComponent}
          skeletonRows={initialPageSize}
          columns={columns.length + (selectable ? 1 : 0)}
        />
      )}

      {/* Desktop Table */}
      {hasData && (
        <div className="data-table__container">
          <table className="data-table__table" aria-rowcount={pagination.total}>
            <DataTableHeader
              columns={columns}
              sortable={sortable}
              sortState={sortState}
              onSort={handleSort}
              selectable={selectable}
              isAllSelected={isAllSelected}
              isIndeterminate={isPartiallySelected}
              onSelectAll={handleSelectAll}
            />
            <DataTableBody
              data={displayedData}
              columns={columns}
              getRowId={getRowId}
              selectable={selectable}
              selectedIds={selection.selected}
              onSelectRow={handleSelectRow}
              onRowClick={onRowClick}
              expandable={expandable}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              renderExpandedRow={renderExpandedRow}
            />
          </table>
        </div>
      )}

      {/* Mobile Cards */}
      {hasData && (
        <DataTableCards
          data={displayedData}
          columns={columns}
          getRowId={getRowId}
          selectable={selectable}
          selectedIds={selection.selected}
          onSelectRow={handleSelectRow}
          onRowClick={onRowClick}
        />
      )}

      {/* Pagination */}
      {paginated && hasData && (
        <DataTablePagination
          pagination={pagination}
          pageSizeOptions={pageSizeOptions}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}
    </section>
  );
}
