/**
 * TableWidget - Tabular data visualization.
 *
 * Data shape expected:
 * {
 *   columns: Array<{
 *     key: string,
 *     label: string,
 *     align?: 'left' | 'center' | 'right',
 *     format?: 'number' | 'currency' | 'percent' | 'date',
 *   }>,
 *   rows: Array<Record<string, unknown>>,
 *   sortable?: boolean,
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import { useState } from "react";
import "./TableWidget.css";

interface Column {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  format?: "number" | "currency" | "percent" | "date";
}

interface TableData {
  columns: Column[];
  rows: Record<string, unknown>[];
  sortable?: boolean;
}

interface TableWidgetProps {
  widget: Widget;
  data: WidgetData;
}

export function TableWidget({ widget: _widget, data }: TableWidgetProps) {
  const tableData = data.data as TableData | null;
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  if (!tableData?.columns?.length) {
    return (
      <div className="table-widget table-widget--empty">No data available</div>
    );
  }

  const { columns, rows, sortable = true } = tableData;

  // Sort rows
  const sortedRows = [...rows];
  if (sortKey) {
    sortedRows.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let comparison = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortDir === "asc" ? comparison : -comparison;
    });
  }

  const handleSort = (key: string) => {
    if (!sortable) return;

    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="table-widget">
      <table className="table-widget__table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`table-widget__th table-widget__th--${col.align || "left"} ${sortable ? "table-widget__th--sortable" : ""}`}
                onClick={() => handleSort(col.key)}
              >
                <span>{col.label}</span>
                {sortable && sortKey === col.key && (
                  <span className="table-widget__sort-icon">
                    {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-widget__empty-row">
                No data
              </td>
            </tr>
          ) : (
            sortedRows.map((row, i) => (
              <tr
                key={row["id"] != null ? String(row["id"]) : `row-${i}`}
                className="table-widget__tr"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`table-widget__td table-widget__td--${col.align || "left"}`}
                  >
                    {formatValue(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(
  value: unknown,
  format?: "number" | "currency" | "percent" | "date",
): string {
  if (value == null) return "-";

  switch (format) {
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);

    case "currency":
      return typeof value === "number"
        ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : String(value);

    case "percent":
      return typeof value === "number"
        ? `${(value * 100).toFixed(1)}%`
        : String(value);

    case "date":
      if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleDateString();
        }
      }
      return String(value);

    default:
      return String(value);
  }
}
