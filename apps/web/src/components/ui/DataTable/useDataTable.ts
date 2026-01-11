/**
 * Core DataTable state management hook.
 *
 * Handles sorting, filtering, pagination, search, and data processing.
 */

import { useCallback, useMemo, useState } from "react";
import type {
  Column,
  Filter,
  PaginationState,
  SelectionState,
  SortDirection,
  SortState,
  UseDataTableReturn,
} from "./types";

interface UseDataTableOptions<T> {
  data: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  initialPageSize?: number;
  initialSort?: SortState;
  externalPagination?: PaginationState;
  onSortChange?: (sort: SortState) => void;
  onPageChange?: (pagination: PaginationState) => void;
  onSearchChange?: (query: string) => void;
  onSelectionChange?: (selectedRows: T[]) => void;
}

/**
 * Get nested value from object using dot notation.
 */
function getNestedValue<T>(obj: T, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Default sort comparison function.
 */
function defaultSort<T>(
  a: T,
  b: T,
  accessor: string,
  direction: SortDirection,
): number {
  if (!direction) return 0;

  const aVal = getNestedValue(a, accessor);
  const bVal = getNestedValue(b, accessor);

  // Handle null/undefined
  if (aVal == null && bVal == null) return 0;
  if (aVal == null) return direction === "asc" ? 1 : -1;
  if (bVal == null) return direction === "asc" ? -1 : 1;

  // Compare values
  let comparison = 0;
  if (typeof aVal === "string" && typeof bVal === "string") {
    comparison = aVal.localeCompare(bVal);
  } else if (typeof aVal === "number" && typeof bVal === "number") {
    comparison = aVal - bVal;
  } else if (aVal instanceof Date && bVal instanceof Date) {
    comparison = aVal.getTime() - bVal.getTime();
  } else {
    comparison = String(aVal).localeCompare(String(bVal));
  }

  return direction === "asc" ? comparison : -comparison;
}

/**
 * Match filter against row value.
 */
function matchFilter<T>(row: T, filter: Filter, columns: Column<T>[]): boolean {
  const column = columns.find((c) => c.id === filter.columnId);
  if (!column) return true;

  const value = getNestedValue(row, String(column.accessor));
  const filterValue = filter.value;
  const operator = filter.operator || "contains";

  if (value == null) return false;

  const strValue = String(value).toLowerCase();
  const filterStr = Array.isArray(filterValue)
    ? filterValue.map((v) => v.toLowerCase())
    : filterValue.toLowerCase();

  switch (operator) {
    case "equals":
      return strValue === filterStr;
    case "contains":
      return typeof filterStr === "string" && strValue.includes(filterStr);
    case "startsWith":
      return typeof filterStr === "string" && strValue.startsWith(filterStr);
    case "endsWith":
      return typeof filterStr === "string" && strValue.endsWith(filterStr);
    case "in":
      return Array.isArray(filterStr) && filterStr.includes(strValue);
    default:
      return true;
  }
}

/**
 * Main DataTable state management hook.
 */
export function useDataTable<T>(
  options: UseDataTableOptions<T>,
): UseDataTableReturn<T> {
  const {
    data,
    columns,
    getRowId,
    initialPageSize = 10,
    initialSort = { columnId: null, direction: null },
    externalPagination,
    onSortChange,
    onPageChange,
    onSearchChange,
    onSelectionChange,
  } = options;

  // Search state
  const [searchQuery, setSearchQueryInternal] = useState("");

  // Sort state
  const [sortState, setSortStateInternal] = useState<SortState>(initialSort);

  // Pagination state
  const [internalPagination, setInternalPagination] = useState<PaginationState>(
    {
      page: 0,
      pageSize: initialPageSize,
      total: data.length,
    },
  );

  // Use external pagination if provided
  const pagination = externalPagination || internalPagination;

  // Selection state
  const [selection, setSelection] = useState<SelectionState<T>>({
    selected: new Set(),
    lastSelectedIndex: null,
    isAllPageSelected: false,
    isAllSelected: false,
  });

  // Expansion state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Filters state
  const [filters, setFilters] = useState<Filter[]>([]);

  // Handle search change with callback
  const setSearchQuery = useCallback(
    (query: string) => {
      setSearchQueryInternal(query);
      onSearchChange?.(query);
      // Reset to first page on search
      if (!externalPagination) {
        setInternalPagination((prev) => ({ ...prev, page: 0 }));
      }
    },
    [onSearchChange, externalPagination],
  );

  // Handle sort change with callback
  const setSortState = useCallback(
    (state: SortState) => {
      setSortStateInternal(state);
      onSortChange?.(state);
    },
    [onSortChange],
  );

  // Handle sort toggle
  const handleSort = useCallback(
    (columnId: string) => {
      setSortState({
        columnId,
        direction:
          sortState.columnId === columnId
            ? sortState.direction === "asc"
              ? "desc"
              : sortState.direction === "desc"
                ? null
                : "asc"
            : "asc",
      });
    },
    [sortState, setSortState],
  );

  // Handle pagination
  const setPagination = useCallback(
    (state: PaginationState) => {
      if (!externalPagination) {
        setInternalPagination(state);
      }
      onPageChange?.(state);
    },
    [externalPagination, onPageChange],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      setPagination({ ...pagination, page });
    },
    [pagination, setPagination],
  );

  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      setPagination({ ...pagination, pageSize, page: 0 });
    },
    [pagination, setPagination],
  );

  // Process data: filter, search, sort
  const processedData = useMemo(() => {
    let result = [...data];

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((row) =>
        columns.some((col) => {
          const value = getNestedValue(row, String(col.accessor));
          return value != null && String(value).toLowerCase().includes(query);
        }),
      );
    }

    // Apply filters
    if (filters.length > 0) {
      result = result.filter((row) =>
        filters.every((filter) => matchFilter(row, filter, columns)),
      );
    }

    // Apply sorting
    if (sortState.columnId && sortState.direction) {
      const column = columns.find((c) => c.id === sortState.columnId);
      if (column) {
        result.sort((a, b) => {
          if (column.sortFn) {
            return column.sortFn(a, b, sortState.direction);
          }
          return defaultSort(
            a,
            b,
            String(column.accessor),
            sortState.direction,
          );
        });
      }
    }

    return result;
  }, [data, searchQuery, filters, sortState, columns]);

  // Update pagination total when processed data changes
  useMemo(() => {
    if (!externalPagination && processedData.length !== pagination.total) {
      setInternalPagination((prev) => ({
        ...prev,
        total: processedData.length,
        page: Math.min(
          prev.page,
          Math.max(0, Math.ceil(processedData.length / prev.pageSize) - 1),
        ),
      }));
    }
  }, [processedData.length, externalPagination, pagination.total]);

  // Paginated data
  const displayedData = useMemo(() => {
    if (externalPagination) {
      // Server-side pagination - data is already paginated
      return processedData;
    }
    const start = pagination.page * pagination.pageSize;
    const end = start + pagination.pageSize;
    return processedData.slice(start, end);
  }, [processedData, pagination, externalPagination]);

  // Selection handlers
  const handleSelectRow = useCallback(
    (id: string, index: number, event: React.MouseEvent) => {
      setSelection((prev) => {
        const newSelected = new Set(prev.selected);

        if (event.shiftKey && prev.lastSelectedIndex !== null) {
          // Shift-click: select range
          const start = Math.min(prev.lastSelectedIndex, index);
          const end = Math.max(prev.lastSelectedIndex, index);
          for (let i = start; i <= end; i++) {
            const rowId = getRowId(displayedData[i]);
            newSelected.add(rowId);
          }
        } else if (event.ctrlKey || event.metaKey) {
          // Ctrl/Cmd-click: toggle single
          if (newSelected.has(id)) {
            newSelected.delete(id);
          } else {
            newSelected.add(id);
          }
        } else {
          // Regular click: toggle single
          if (newSelected.has(id)) {
            newSelected.delete(id);
          } else {
            newSelected.add(id);
          }
        }

        const newState: SelectionState<T> = {
          selected: newSelected,
          lastSelectedIndex: index,
          isAllPageSelected: displayedData.every((row) =>
            newSelected.has(getRowId(row)),
          ),
          isAllSelected: processedData.every((row) =>
            newSelected.has(getRowId(row)),
          ),
        };

        // Trigger callback
        const selectedRows = processedData.filter((row) =>
          newSelected.has(getRowId(row)),
        );
        onSelectionChange?.(selectedRows);

        return newState;
      });
    },
    [displayedData, processedData, getRowId, onSelectionChange],
  );

  const handleSelectAll = useCallback(() => {
    setSelection((prev) => {
      const newSelected = new Set(prev.selected);

      if (prev.isAllPageSelected) {
        // Deselect all on current page
        displayedData.forEach((row) => {
          newSelected.delete(getRowId(row));
        });
      } else {
        // Select all on current page
        displayedData.forEach((row) => {
          newSelected.add(getRowId(row));
        });
      }

      const newState: SelectionState<T> = {
        selected: newSelected,
        lastSelectedIndex: prev.lastSelectedIndex,
        isAllPageSelected: !prev.isAllPageSelected,
        isAllSelected: processedData.every((row) =>
          newSelected.has(getRowId(row)),
        ),
      };

      // Trigger callback
      const selectedRows = processedData.filter((row) =>
        newSelected.has(getRowId(row)),
      );
      onSelectionChange?.(selectedRows);

      return newState;
    });
  }, [displayedData, processedData, getRowId, onSelectionChange]);

  const clearSelection = useCallback(() => {
    setSelection({
      selected: new Set(),
      lastSelectedIndex: null,
      isAllPageSelected: false,
      isAllSelected: false,
    });
    onSelectionChange?.([]);
  }, [onSelectionChange]);

  const isRowSelected = useCallback(
    (id: string) => selection.selected.has(id),
    [selection.selected],
  );

  // Selected rows
  const selectedRows = useMemo(
    () => processedData.filter((row) => selection.selected.has(getRowId(row))),
    [processedData, selection.selected, getRowId],
  );

  // Expansion handlers
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const isRowExpanded = useCallback(
    (id: string) => expandedIds.has(id),
    [expandedIds],
  );

  // Filter handlers
  const addFilter = useCallback(
    (filter: Filter) => {
      setFilters((prev) => {
        const existing = prev.findIndex((f) => f.id === filter.id);
        if (existing >= 0) {
          const newFilters = [...prev];
          newFilters[existing] = filter;
          return newFilters;
        }
        return [...prev, filter];
      });
      // Reset to first page on filter change
      if (!externalPagination) {
        setInternalPagination((prev) => ({ ...prev, page: 0 }));
      }
    },
    [externalPagination],
  );

  const removeFilter = useCallback((filterId: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters([]);
  }, []);

  return {
    // Processed data
    processedData,
    displayedData,

    // Search
    searchQuery,
    setSearchQuery,

    // Sorting
    sortState,
    setSortState,
    handleSort,

    // Pagination
    pagination: {
      ...pagination,
      total: externalPagination ? pagination.total : processedData.length,
    },
    setPagination,
    handlePageChange,
    handlePageSizeChange,

    // Selection
    selection,
    selectedRows,
    handleSelectRow,
    handleSelectAll,
    clearSelection,
    isRowSelected,

    // Expansion
    expandedIds,
    handleToggleExpand,
    isRowExpanded,

    // Filters
    filters,
    addFilter,
    removeFilter,
    clearFilters,
  };
}
