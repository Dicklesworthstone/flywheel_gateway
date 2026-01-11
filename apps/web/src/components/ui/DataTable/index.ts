/**
 * DataTable component exports.
 *
 * A comprehensive data table system with sorting, filtering,
 * pagination, row selection, and responsive mobile view.
 *
 * @example
 * ```tsx
 * import { DataTable, type Column } from '@/components/ui/DataTable';
 *
 * interface Agent {
 *   id: string;
 *   name: string;
 *   status: string;
 * }
 *
 * const columns: Column<Agent>[] = [
 *   { id: 'name', header: 'Name', accessor: 'name', sortable: true },
 *   { id: 'status', header: 'Status', accessor: 'status' },
 * ];
 *
 * <DataTable
 *   data={agents}
 *   columns={columns}
 *   getRowId={(a) => a.id}
 *   selectable
 *   searchable
 *   paginated
 * />
 * ```
 */

// Main component
export { DataTable } from "./DataTable";
export { DataTableBody } from "./DataTableBody";
export { DataTableBulkActions } from "./DataTableBulkActions";
export { DataTableCards } from "./DataTableCards";
export { DataTableEmpty } from "./DataTableEmpty";
// Sub-components (for advanced customization)
export { DataTableHeader } from "./DataTableHeader";
export { DataTablePagination } from "./DataTablePagination";
export { DataTableRow } from "./DataTableRow";
export { DataTableToolbar } from "./DataTableToolbar";
// Types
export type {
  BulkAction,
  // Core types
  Column,
  DataTableBodyProps,
  DataTableBulkActionsProps,
  DataTableEmptyProps,
  DataTableHeaderProps,
  DataTablePaginationProps,
  // Component props
  DataTableProps,
  DataTableRowProps,
  DataTableToolbarProps,
  Filter,
  PaginationState,
  SelectionState,
  SortDirection,
  SortState,
  // Hook return types
  UseDataTableReturn,
  UseRowSelectionReturn,
} from "./types";
// Hooks
export { useDataTable } from "./useDataTable";
export {
  getSelectedRows,
  isIndeterminate,
  selectAll,
  useRowSelection,
} from "./useRowSelection";
