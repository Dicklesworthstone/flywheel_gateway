/**
 * DataTable Toolbar component.
 *
 * Renders search input and filter chips.
 */

import { Filter, Search, X } from "lucide-react";
import type { DataTableToolbarProps } from "./types";

/**
 * DataTable Toolbar component.
 */
export function DataTableToolbar({
  searchable = true,
  searchValue,
  searchPlaceholder = "Search...",
  onSearchChange,
  filters = [],
  onFilterRemove,
  onClearFilters,
  actions,
}: DataTableToolbarProps) {
  const hasFilters = filters.length > 0;

  return (
    <div className="data-table__toolbar">
      {searchable && (
        <div className="data-table__search">
          <Search size={16} className="data-table__search-icon" />
          <input
            type="text"
            className="data-table__search-input"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search table"
          />
          {searchValue && (
            <button
              className="btn btn--ghost btn--icon"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {hasFilters && (
        <div className="data-table__filters">
          <span className="data-table__filters-label">
            <Filter size={14} style={{ marginRight: 4 }} />
            Filters:
          </span>
          {filters.map((filter) => (
            <button
              key={filter.id}
              className="data-table__filter-chip data-table__filter-chip--active"
              onClick={() => onFilterRemove?.(filter.id)}
            >
              <span>{filter.label}</span>
              <span className="data-table__filter-chip__remove">
                <X size={10} />
              </span>
            </button>
          ))}
          {filters.length > 1 && (
            <button
              className="data-table__filter-chip"
              onClick={onClearFilters}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {actions && <div className="data-table__toolbar-actions">{actions}</div>}
    </div>
  );
}
