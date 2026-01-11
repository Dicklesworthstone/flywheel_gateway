/**
 * DataTable Body component.
 *
 * Renders the table body with rows.
 */

import { DataTableRow } from "./DataTableRow";
import type { DataTableBodyProps } from "./types";

/**
 * DataTable Body component.
 */
export function DataTableBody<T>({
  data,
  columns,
  getRowId,
  selectable = false,
  selectedIds,
  onSelectRow,
  onRowClick,
  expandable = false,
  expandedIds,
  onToggleExpand,
  renderExpandedRow,
}: DataTableBodyProps<T>) {
  return (
    <tbody className="data-table__body">
      {data.map((row, index) => {
        const rowId = getRowId(row);
        return (
          <DataTableRow
            key={rowId}
            row={row}
            rowId={rowId}
            index={index}
            columns={columns}
            selectable={selectable}
            isSelected={selectedIds.has(rowId)}
            onSelect={onSelectRow}
            onClick={onRowClick}
            expandable={expandable}
            isExpanded={expandedIds.has(rowId)}
            onToggleExpand={onToggleExpand}
            renderExpandedRow={renderExpandedRow}
          />
        );
      })}
    </tbody>
  );
}
