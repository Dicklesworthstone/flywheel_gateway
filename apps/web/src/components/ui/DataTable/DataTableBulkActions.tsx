/**
 * DataTable Bulk Actions component.
 *
 * Renders action bar when rows are selected.
 */

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { expandVariants } from "../../../lib/animations";
import type { DataTableBulkActionsProps } from "./types";

/**
 * DataTable Bulk Actions component.
 */
export function DataTableBulkActions<T>({
  selectedCount,
  selectedRows,
  actions,
  onClearSelection,
}: DataTableBulkActionsProps<T>) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <motion.div
      className="data-table__bulk-actions"
      variants={expandVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <span className="data-table__bulk-actions__count">
        {selectedCount} {selectedCount === 1 ? "item" : "items"} selected
      </span>

      <div className="data-table__bulk-actions__buttons">
        {actions.map((action) => (
          <button
            key={action.id}
            className={`btn btn--sm ${
              action.variant === "danger"
                ? "btn--danger"
                : action.variant === "primary"
                  ? "btn--primary"
                  : "btn--secondary"
            }`}
            onClick={() => action.onAction(selectedRows)}
            disabled={action.disabled}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      <button
        className="btn btn--ghost btn--icon btn--sm"
        onClick={onClearSelection}
        aria-label="Clear selection"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}
