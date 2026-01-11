/**
 * DataTable Header component.
 *
 * Renders sortable column headers with checkbox for bulk selection.
 */

import { Check, ChevronDown, ChevronUp, Minus } from "lucide-react";
import type { DataTableHeaderProps } from "./types";

/**
 * Checkbox component for header selection.
 */
function HeaderCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={onChange}
        aria-label={checked ? "Deselect all" : "Select all"}
      />
      <span className="checkbox__box">
        {indeterminate ? (
          <Minus size={12} className="checkbox__icon" />
        ) : checked ? (
          <Check size={12} className="checkbox__icon" />
        ) : null}
      </span>
    </label>
  );
}

/**
 * Sort icon component.
 */
function SortIcon({ direction }: { direction: "asc" | "desc" | null }) {
  if (!direction) {
    return (
      <span className="data-table__sort-icon" aria-hidden="true">
        <ChevronUp size={14} style={{ opacity: 0.3 }} />
      </span>
    );
  }

  return (
    <span className="data-table__sort-icon" aria-hidden="true">
      {direction === "asc" ? (
        <ChevronUp size={14} />
      ) : (
        <ChevronDown size={14} />
      )}
    </span>
  );
}

/**
 * DataTable Header component.
 */
export function DataTableHeader<T>({
  columns,
  sortable = true,
  sortState,
  onSort,
  selectable = false,
  isAllSelected,
  isIndeterminate,
  onSelectAll,
}: DataTableHeaderProps<T>) {
  return (
    <thead className="data-table__head">
      <tr>
        {selectable && (
          <th className="data-table__th data-table__th--checkbox">
            <HeaderCheckbox
              checked={isAllSelected}
              indeterminate={isIndeterminate}
              onChange={onSelectAll}
            />
          </th>
        )}
        {columns.map((column) => {
          const isSorted = sortState.columnId === column.id;
          const isSortable = sortable && column.sortable !== false;

          return (
            <th
              key={column.id}
              className={`data-table__th ${
                isSortable ? "data-table__th--sortable" : ""
              } ${isSorted ? "data-table__th--sorted" : ""}`}
              style={{
                width: column.width,
                minWidth: column.minWidth,
                textAlign: column.align || "left",
              }}
              onClick={isSortable ? () => onSort(column.id) : undefined}
              onKeyDown={
                isSortable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSort(column.id);
                      }
                    }
                  : undefined
              }
              tabIndex={isSortable ? 0 : undefined}
              role={isSortable ? "button" : undefined}
              aria-sort={
                isSorted
                  ? sortState.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined
              }
            >
              <span>{column.header}</span>
              {isSortable && (
                <SortIcon direction={isSorted ? sortState.direction : null} />
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
