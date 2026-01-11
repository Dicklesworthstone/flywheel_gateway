/**
 * Row selection hook with shift-click range selection support.
 *
 * Provides specialized selection logic for DataTable rows.
 */

import { useCallback, useMemo, useState } from "react";
import type { UseRowSelectionReturn } from "./types";

interface UseRowSelectionOptions<T> {
  /** All data items */
  data: T[];
  /** Function to get unique ID for each row */
  getRowId: (row: T) => string;
  /** Currently displayed data (for page selection) */
  displayedData?: T[];
  /** Callback when selection changes */
  onSelectionChange?: (selectedRows: T[]) => void;
  /** Initial selected IDs */
  initialSelected?: Set<string>;
}

/**
 * Row selection hook with shift-click support.
 */
export function useRowSelection<T>(
  options: UseRowSelectionOptions<T>,
): UseRowSelectionReturn {
  const {
    data,
    getRowId,
    displayedData = data,
    onSelectionChange,
    initialSelected = new Set(),
  } = options;

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null,
  );

  // Compute derived state
  const isAllPageSelected = useMemo(() => {
    if (displayedData.length === 0) return false;
    return displayedData.every((row) => selected.has(getRowId(row)));
  }, [displayedData, selected, getRowId]);

  const isAllSelected = useMemo(() => {
    if (data.length === 0) return false;
    return data.every((row) => selected.has(getRowId(row)));
  }, [data, selected, getRowId]);

  // Handle individual row selection
  const handleSelect = useCallback(
    (id: string, index: number, event: React.MouseEvent) => {
      setSelected((prev) => {
        const newSelected = new Set(prev);

        if (event.shiftKey && lastSelectedIndex !== null) {
          // Shift-click: select range from last selected to current
          const start = Math.min(lastSelectedIndex, index);
          const end = Math.max(lastSelectedIndex, index);

          // Determine if we're selecting or deselecting based on the clicked row
          const shouldSelect = !prev.has(id);

          for (let i = start; i <= end; i++) {
            if (i < displayedData.length) {
              const rowId = getRowId(displayedData[i]);
              if (shouldSelect) {
                newSelected.add(rowId);
              } else {
                newSelected.delete(rowId);
              }
            }
          }
        } else if (event.ctrlKey || event.metaKey) {
          // Ctrl/Cmd-click: toggle single item without clearing others
          if (newSelected.has(id)) {
            newSelected.delete(id);
          } else {
            newSelected.add(id);
          }
        } else {
          // Regular click: toggle single item
          if (newSelected.has(id)) {
            newSelected.delete(id);
          } else {
            newSelected.add(id);
          }
        }

        // Trigger callback
        if (onSelectionChange) {
          const selectedRows = data.filter((row) =>
            newSelected.has(getRowId(row)),
          );
          onSelectionChange(selectedRows);
        }

        return newSelected;
      });

      // Update last selected index for shift-click
      setLastSelectedIndex(index);
    },
    [lastSelectedIndex, displayedData, data, getRowId, onSelectionChange],
  );

  // Handle select all (current page)
  const handleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const newSelected = new Set(prev);

      if (isAllPageSelected) {
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

      // Trigger callback
      if (onSelectionChange) {
        const selectedRows = data.filter((row) =>
          newSelected.has(getRowId(row)),
        );
        onSelectionChange(selectedRows);
      }

      return newSelected;
    });
  }, [isAllPageSelected, displayedData, data, getRowId, onSelectionChange]);

  // Clear all selection
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setLastSelectedIndex(null);
    onSelectionChange?.([]);
  }, [onSelectionChange]);

  // Check if a row is selected
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return {
    selected,
    lastSelectedIndex,
    isAllPageSelected,
    isAllSelected,
    handleSelect,
    handleSelectAll,
    clearSelection,
    isSelected,
  };
}

/**
 * Utility: Select all items in data.
 */
export function selectAll<T>(
  data: T[],
  getRowId: (row: T) => string,
): Set<string> {
  return new Set(data.map(getRowId));
}

/**
 * Utility: Get selected rows from data.
 */
export function getSelectedRows<T>(
  data: T[],
  selected: Set<string>,
  getRowId: (row: T) => string,
): T[] {
  return data.filter((row) => selected.has(getRowId(row)));
}

/**
 * Utility: Check if selection is indeterminate (some but not all selected).
 */
export function isIndeterminate(
  selectedCount: number,
  totalCount: number,
): boolean {
  return selectedCount > 0 && selectedCount < totalCount;
}
