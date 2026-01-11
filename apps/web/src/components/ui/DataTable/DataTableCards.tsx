/**
 * DataTable Cards component (Mobile view).
 *
 * Renders data as cards on mobile devices.
 */

import { Check } from "lucide-react";
import type { Column } from "./types";

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

interface DataTableCardsProps<T> {
  data: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  selectable?: boolean;
  selectedIds: Set<string>;
  onSelectRow: (id: string, index: number, event: React.MouseEvent) => void;
  onRowClick?: (row: T, event: React.MouseEvent) => void;
}

/**
 * Row checkbox component.
 */
function CardCheckbox({
  checked,
  onChange,
  rowId,
}: {
  checked: boolean;
  onChange: (event: React.MouseEvent) => void;
  rowId: string;
}) {
  return (
    <label className="checkbox" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        onChange={() => {}}
        onClick={onChange}
        aria-label={`Select ${rowId}`}
      />
      <span className="checkbox__box">
        {checked && <Check size={12} className="checkbox__icon" />}
      </span>
    </label>
  );
}

/**
 * DataTable Cards component (Mobile view).
 */
export function DataTableCards<T>({
  data,
  columns,
  getRowId,
  selectable = false,
  selectedIds,
  onSelectRow,
  onRowClick,
}: DataTableCardsProps<T>) {
  // Get primary column (first column) for card title
  const primaryColumn = columns[0];
  // Get secondary column (second column) for subtitle if available
  const secondaryColumn = columns[1];
  // Get remaining columns for card body
  const bodyColumns = columns.slice(2);

  return (
    <div className="data-table__cards">
      {data.map((row, index) => {
        const rowId = getRowId(row);
        const isSelected = selectedIds.has(rowId);

        const primaryValue = primaryColumn
          ? getNestedValue(row, String(primaryColumn.accessor))
          : null;
        const secondaryValue = secondaryColumn
          ? getNestedValue(row, String(secondaryColumn.accessor))
          : null;

        return (
          <div
            key={rowId}
            className={`responsive-card ${isSelected ? "responsive-card--selected" : ""}`}
            onClick={(e) => {
              // Don't trigger if clicking checkbox
              if ((e.target as HTMLElement).closest(".checkbox")) return;
              onRowClick?.(row, e);
            }}
            role={onRowClick ? "button" : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(row, e as unknown as React.MouseEvent);
                    }
                  }
                : undefined
            }
          >
            <div className="responsive-card__header">
              <div>
                {primaryValue && (
                  <div className="responsive-card__title">
                    {primaryColumn?.cell
                      ? primaryColumn.cell(row, index)
                      : String(primaryValue)}
                  </div>
                )}
                {secondaryValue && (
                  <div className="responsive-card__subtitle">
                    {secondaryColumn?.cell
                      ? secondaryColumn.cell(row, index)
                      : String(secondaryValue)}
                  </div>
                )}
              </div>
              {selectable && (
                <CardCheckbox
                  checked={isSelected}
                  onChange={(e) => onSelectRow(rowId, index, e)}
                  rowId={rowId}
                />
              )}
            </div>

            {bodyColumns.length > 0 && (
              <div className="responsive-card__body">
                {bodyColumns.map((column) => {
                  const value = getNestedValue(row, String(column.accessor));
                  return (
                    <div key={column.id} className="responsive-card__row">
                      <span className="responsive-card__label">
                        {column.header}
                      </span>
                      <span>
                        {column.cell
                          ? column.cell(row, index)
                          : value != null
                            ? String(value)
                            : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
