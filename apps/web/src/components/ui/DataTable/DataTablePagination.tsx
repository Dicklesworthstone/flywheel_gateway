/**
 * DataTable Pagination component.
 *
 * Renders pagination controls with page size selector.
 */

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { DataTablePaginationProps } from "./types";

/**
 * Calculate visible page numbers for pagination.
 */
function getVisiblePages(
  currentPage: number,
  totalPages: number,
  maxVisible = 5,
): (number | "ellipsis")[] {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, currentPage - half);
  let end = Math.min(totalPages - 1, currentPage + half);

  // Adjust if we're near the start
  if (currentPage < half) {
    end = Math.min(totalPages - 1, maxVisible - 1);
  }

  // Adjust if we're near the end
  if (currentPage > totalPages - 1 - half) {
    start = Math.max(0, totalPages - maxVisible);
  }

  const pages: (number | "ellipsis")[] = [];

  // Always show first page
  if (start > 0) {
    pages.push(0);
    if (start > 1) {
      pages.push("ellipsis");
    }
  }

  // Middle pages
  for (let i = start; i <= end; i++) {
    if (!pages.includes(i)) {
      pages.push(i);
    }
  }

  // Always show last page
  if (end < totalPages - 1) {
    if (end < totalPages - 2) {
      pages.push("ellipsis");
    }
    pages.push(totalPages - 1);
  }

  return pages;
}

/**
 * DataTable Pagination component.
 */
export function DataTablePagination({
  pagination,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const { page, pageSize, total } = pagination;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  const visiblePages = getVisiblePages(page, totalPages);
  const pageItems = visiblePages.map((pageNum, index) => {
    if (pageNum === "ellipsis") {
      const prevPage = visiblePages[index - 1];
      const nextPage = visiblePages[index + 1];
      return {
        type: "ellipsis" as const,
        key: `ellipsis-${prevPage ?? "start"}-${nextPage ?? "end"}`,
      };
    }

    return {
      type: "page" as const,
      key: `page-${pageNum}`,
      pageNum,
    };
  });

  const canGoPrevious = page > 0;
  const canGoNext = page < totalPages - 1;

  return (
    <div className="data-table__pagination">
      <div className="data-table__pagination-info">
        {total > 0 ? (
          <>
            Showing <strong>{start}</strong> to <strong>{end}</strong> of{" "}
            <strong>{total}</strong> results
          </>
        ) : (
          "No results"
        )}
      </div>

      <div className="data-table__pagination-controls">
        {/* Page size selector */}
        <select
          className="data-table__page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Rows per page"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>

        {/* First page */}
        <button
          type="button"
          className="data-table__page-btn"
          onClick={() => onPageChange(0)}
          disabled={!canGoPrevious}
          aria-label="Go to first page"
        >
          <ChevronsLeft size={16} />
        </button>

        {/* Previous page */}
        <button
          type="button"
          className="data-table__page-btn"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrevious}
          aria-label="Go to previous page"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page numbers */}
        {totalPages > 1 &&
          pageItems.map((item) =>
            item.type === "ellipsis" ? (
              <span
                key={item.key}
                className="data-table__page-ellipsis"
                style={{ padding: "0 4px" }}
              >
                ...
              </span>
            ) : (
              <button
                type="button"
                key={item.key}
                className={`data-table__page-btn ${
                  item.pageNum === page ? "data-table__page-btn--active" : ""
                }`}
                onClick={() => onPageChange(item.pageNum)}
                aria-label={`Go to page ${item.pageNum + 1}`}
                aria-current={item.pageNum === page ? "page" : undefined}
              >
                {item.pageNum + 1}
              </button>
            ),
          )}

        {/* Next page */}
        <button
          type="button"
          className="data-table__page-btn"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
          aria-label="Go to next page"
        >
          <ChevronRight size={16} />
        </button>

        {/* Last page */}
        <button
          type="button"
          className="data-table__page-btn"
          onClick={() => onPageChange(totalPages - 1)}
          disabled={!canGoNext}
          aria-label="Go to last page"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  );
}
