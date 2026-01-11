/**
 * DataTable Row component.
 *
 * Renders a single data row with selection and expansion support.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight } from "lucide-react";
import { expandVariants } from "../../../lib/animations";
import type { Column, DataTableRowProps } from "./types";

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
 * Row checkbox component.
 */
function RowCheckbox({
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
        aria-label={`Select row ${rowId}`}
      />
      <span className="checkbox__box">
        {checked && <Check size={12} className="checkbox__icon" />}
      </span>
    </label>
  );
}

/**
 * Render cell content.
 */
function CellContent<T>({
  row,
  column,
  index,
}: {
  row: T;
  column: Column<T>;
  index: number;
}) {
  if (column.cell) {
    return <>{column.cell(row, index)}</>;
  }

  const value = getNestedValue(row, String(column.accessor));

  if (value === null || value === undefined) {
    return <span className="data-table__td--muted">—</span>;
  }

  return <>{String(value)}</>;
}

/**
 * DataTable Row component.
 */
export function DataTableRow<T>({
  row,
  rowId,
  index,
  columns,
  selectable = false,
  isSelected,
  onSelect,
  onClick,
  expandable = false,
  isExpanded,
  onToggleExpand,
  renderExpandedRow,
}: DataTableRowProps<T>) {
  const handleClick = (event: React.MouseEvent) => {
    // Don't trigger row click if clicking on checkbox or expand button
    const target = event.target as HTMLElement;
    if (
      target.closest(".checkbox") ||
      target.closest(".data-table__expand-btn")
    ) {
      return;
    }
    onClick?.(row, event);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.(row, event as unknown as React.MouseEvent);
    }
  };

  return (
    <>
      <tr
        className={`data-table__tr ${
          isSelected ? "data-table__tr--selected" : ""
        } ${onClick ? "data-table__tr--clickable" : ""}`}
        onClick={handleClick}
        onKeyDown={onClick ? handleKeyDown : undefined}
        tabIndex={onClick ? 0 : undefined}
        role={onClick ? "button" : undefined}
        aria-selected={selectable ? isSelected : undefined}
      >
        {selectable && (
          <td className="data-table__td">
            <RowCheckbox
              checked={isSelected}
              onChange={(e) => onSelect(rowId, index, e)}
              rowId={rowId}
            />
          </td>
        )}
        {columns.map((column, colIndex) => (
          <td
            key={column.id}
            className={`data-table__td ${column.className || ""}`}
            style={{ textAlign: column.align || "left" }}
          >
            {expandable && colIndex === 0 && (
              <button
                className="data-table__expand-btn btn btn--ghost btn--icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(rowId);
                }}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? "Collapse row" : "Expand row"}
                style={{ marginRight: 8 }}
              >
                <ChevronRight
                  size={16}
                  style={{
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                />
              </button>
            )}
            <CellContent row={row} column={column} index={index} />
          </td>
        ))}
      </tr>
      <AnimatePresence>
        {expandable && isExpanded && renderExpandedRow && (
          <tr className="data-table__expand-row">
            <td colSpan={columns.length + (selectable ? 1 : 0)}>
              <motion.div
                variants={expandVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="data-table__expand-content"
              >
                {renderExpandedRow(row)}
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}
