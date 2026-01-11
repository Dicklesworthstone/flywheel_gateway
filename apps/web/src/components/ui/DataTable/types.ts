/**
 * DataTable type definitions.
 *
 * Provides comprehensive TypeScript interfaces for the DataTable component system.
 */

import type { ReactNode } from "react";

// ============================================
// CORE TYPES
// ============================================

/**
 * Sort direction for columns.
 */
export type SortDirection = "asc" | "desc" | null;

/**
 * Column definition for the data table.
 */
export interface Column<T> {
  /** Unique identifier for the column */
  id: string;
  /** Column header label */
  header: string;
  /** Property key to access data (supports dot notation for nested) */
  accessor: keyof T | string;
  /** Custom cell renderer */
  cell?: (row: T, index: number) => ReactNode;
  /** Whether the column is sortable */
  sortable?: boolean;
  /** Custom sort function */
  sortFn?: (a: T, b: T, direction: SortDirection) => number;
  /** Column width (CSS value) */
  width?: string;
  /** Minimum column width */
  minWidth?: string;
  /** Column alignment */
  align?: "left" | "center" | "right";
  /** Whether to hide column on mobile */
  hideOnMobile?: boolean;
  /** Additional CSS class for the column */
  className?: string;
}

/**
 * Filter definition for the data table.
 */
export interface Filter {
  /** Unique identifier for the filter */
  id: string;
  /** Filter label */
  label: string;
  /** Column to filter on */
  columnId: string;
  /** Filter value */
  value: string | string[];
  /** Filter operator */
  operator?: "equals" | "contains" | "startsWith" | "endsWith" | "in";
}

/**
 * Bulk action definition.
 */
export interface BulkAction<T> {
  /** Unique identifier for the action */
  id: string;
  /** Action label */
  label: string;
  /** Icon component */
  icon?: ReactNode;
  /** Action variant for styling */
  variant?: "default" | "primary" | "danger";
  /** Handler for the action */
  onAction: (selectedRows: T[]) => void | Promise<void>;
  /** Whether the action is disabled */
  disabled?: boolean;
  /** Confirmation message (if needed) */
  confirmMessage?: string;
}

/**
 * Pagination state.
 */
export interface PaginationState {
  /** Current page (0-indexed) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Total number of items */
  total: number;
}

/**
 * Sort state.
 */
export interface SortState {
  /** Column ID being sorted */
  columnId: string | null;
  /** Sort direction */
  direction: SortDirection;
}

/**
 * Selection state.
 */
export interface SelectionState<T> {
  /** Set of selected row IDs */
  selected: Set<string>;
  /** Last selected row index (for shift-click) */
  lastSelectedIndex: number | null;
  /** Whether all rows on current page are selected */
  isAllPageSelected: boolean;
  /** Whether all rows are selected */
  isAllSelected: boolean;
}

// ============================================
// DATATABLE PROPS
// ============================================

/**
 * Main DataTable component props.
 */
export interface DataTableProps<T> {
  /** Unique identifier for the table (used for persistence) */
  id?: string;
  /** Data array to display */
  data: T[];
  /** Column definitions */
  columns: Column<T>[];
  /** Function to get unique ID for each row */
  getRowId: (row: T) => string;

  // === Features ===
  /** Enable row selection */
  selectable?: boolean;
  /** Enable global search */
  searchable?: boolean;
  /** Placeholder for search input */
  searchPlaceholder?: string;
  /** Enable pagination */
  paginated?: boolean;
  /** Enable sorting */
  sortable?: boolean;
  /** Enable row expansion */
  expandable?: boolean;

  // === Handlers ===
  /** Handler for row click */
  onRowClick?: (row: T, event: React.MouseEvent) => void;
  /** Handler for row double click */
  onRowDoubleClick?: (row: T, event: React.MouseEvent) => void;
  /** Handler for selection change */
  onSelectionChange?: (selectedRows: T[]) => void;
  /** Handler for sort change */
  onSortChange?: (sort: SortState) => void;
  /** Handler for page change */
  onPageChange?: (pagination: PaginationState) => void;
  /** Handler for search change */
  onSearchChange?: (query: string) => void;

  // === Bulk Actions ===
  /** Bulk actions configuration */
  bulkActions?: BulkAction<T>[];

  // === Filters ===
  /** Active filters */
  filters?: Filter[];
  /** Handler for filter change */
  onFilterChange?: (filters: Filter[]) => void;

  // === Expansion ===
  /** Render function for expanded row content */
  renderExpandedRow?: (row: T) => ReactNode;

  // === Pagination ===
  /** Initial page size */
  initialPageSize?: number;
  /** Available page size options */
  pageSizeOptions?: number[];
  /** External pagination state (for server-side pagination) */
  pagination?: PaginationState;

  // === Sorting ===
  /** Initial sort state */
  initialSort?: SortState;
  /** Default sort column */
  defaultSortColumn?: string;
  /** Default sort direction */
  defaultSortDirection?: SortDirection;

  // === Loading/Error States ===
  /** Whether data is loading */
  loading?: boolean;
  /** Error state */
  error?: Error | string | null;
  /** Custom loading component */
  loadingComponent?: ReactNode;
  /** Custom error component */
  errorComponent?: ReactNode;
  /** Custom empty state component */
  emptyComponent?: ReactNode;
  /** Empty state title */
  emptyTitle?: string;
  /** Empty state message */
  emptyMessage?: string;

  // === Styling ===
  /** Additional CSS class for the table container */
  className?: string;
  /** Whether to show borders between rows */
  bordered?: boolean;
  /** Whether to show striped rows */
  striped?: boolean;
  /** Row density */
  density?: "compact" | "normal" | "comfortable";
  /** Whether rows should highlight on hover */
  hoverable?: boolean;

  // === Accessibility ===
  /** Accessible label for the table */
  ariaLabel?: string;
  /** ID of element that labels the table */
  ariaLabelledBy?: string;
}

// ============================================
// SUBCOMPONENT PROPS
// ============================================

/**
 * DataTableToolbar props.
 */
export interface DataTableToolbarProps {
  searchable?: boolean;
  searchValue: string;
  searchPlaceholder?: string | undefined;
  onSearchChange: (value: string) => void;
  filters?: Filter[];
  onFilterRemove?: (filterId: string) => void;
  onClearFilters?: () => void;
  actions?: ReactNode;
}

/**
 * DataTableHeader props.
 */
export interface DataTableHeaderProps<T> {
  columns: Column<T>[];
  sortable?: boolean;
  sortState: SortState;
  onSort: (columnId: string) => void;
  selectable?: boolean;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  onSelectAll: () => void;
}

/**
 * DataTableBody props.
 */
export interface DataTableBodyProps<T> {
  data: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  selectable?: boolean;
  selectedIds: Set<string>;
  onSelectRow: (id: string, index: number, event: React.MouseEvent) => void;
  onRowClick?: ((row: T, event: React.MouseEvent) => void) | undefined;
  expandable?: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  renderExpandedRow?: ((row: T) => ReactNode) | undefined;
}

/**
 * DataTableRow props.
 */
export interface DataTableRowProps<T> {
  row: T;
  rowId: string;
  index: number;
  columns: Column<T>[];
  selectable?: boolean;
  isSelected: boolean;
  onSelect: (id: string, index: number, event: React.MouseEvent) => void;
  onClick?: ((row: T, event: React.MouseEvent) => void) | undefined;
  expandable?: boolean;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  renderExpandedRow?: ((row: T) => ReactNode) | undefined;
}

/**
 * DataTablePagination props.
 */
export interface DataTablePaginationProps {
  pagination: PaginationState;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * DataTableBulkActions props.
 */
export interface DataTableBulkActionsProps<T> {
  selectedCount: number;
  selectedRows: T[];
  actions: BulkAction<T>[];
  onClearSelection: () => void;
}

/**
 * DataTableEmpty props.
 */
export interface DataTableEmptyProps {
  loading?: boolean;
  error?: Error | string | null;
  emptyTitle?: string | undefined;
  emptyMessage?: string | undefined;
  onRetry?: (() => void) | undefined;
  loadingComponent?: ReactNode;
  errorComponent?: ReactNode;
  emptyComponent?: ReactNode;
  skeletonRows?: number;
  columns?: number;
}

// ============================================
// HOOK RETURN TYPES
// ============================================

/**
 * Return type for useDataTable hook.
 */
export interface UseDataTableReturn<T> {
  // Processed data
  processedData: T[];
  displayedData: T[];

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Sorting
  sortState: SortState;
  setSortState: (state: SortState) => void;
  handleSort: (columnId: string) => void;

  // Pagination
  pagination: PaginationState;
  setPagination: (state: PaginationState) => void;
  handlePageChange: (page: number) => void;
  handlePageSizeChange: (pageSize: number) => void;

  // Selection
  selection: SelectionState<T>;
  selectedRows: T[];
  handleSelectRow: (id: string, index: number, event: React.MouseEvent) => void;
  handleSelectAll: () => void;
  clearSelection: () => void;
  isRowSelected: (id: string) => boolean;

  // Expansion
  expandedIds: Set<string>;
  handleToggleExpand: (id: string) => void;
  isRowExpanded: (id: string) => boolean;

  // Filters
  filters: Filter[];
  addFilter: (filter: Filter) => void;
  removeFilter: (filterId: string) => void;
  clearFilters: () => void;
}

/**
 * Return type for useRowSelection hook.
 */
export interface UseRowSelectionReturn {
  selected: Set<string>;
  lastSelectedIndex: number | null;
  isAllPageSelected: boolean;
  isAllSelected: boolean;
  handleSelect: (id: string, index: number, event: React.MouseEvent) => void;
  handleSelectAll: () => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
}
