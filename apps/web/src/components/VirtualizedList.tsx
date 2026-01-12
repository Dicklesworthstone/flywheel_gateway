/**
 * VirtualizedList Component
 *
 * A generic virtualized list component for efficiently rendering
 * large lists of any item type.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

export interface VirtualizedListProps<T> {
  /** Array of items to display */
  items: T[];
  /** Height of the container */
  height: number;
  /** Height of each row (fixed height for better performance) */
  rowHeight: number;
  /** Number of rows to render above/below visible area */
  overscan?: number;
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Unique key extractor for each item */
  getItemKey: (item: T, index: number) => string | number;
  /** Custom class name for container */
  className?: string;
  /** Callback when scrolled to bottom */
  onScrollToBottom?: () => void;
  /** Threshold from bottom to trigger onScrollToBottom (px) */
  scrollBottomThreshold?: number;
  /** Empty state component */
  emptyState?: React.ReactNode;
  /** Loading state */
  loading?: boolean;
  /** Loading more state (for infinite scroll) */
  loadingMore?: boolean;
}

export interface VirtualizedListHandle {
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  scrollToTop: (behavior?: ScrollBehavior) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  getScrollTop: () => number;
}

const DEFAULT_OVERSCAN = 5;
const DEFAULT_SCROLL_THRESHOLD = 50;

function VirtualizedListInner<T>(
  {
    items,
    height,
    rowHeight,
    overscan = DEFAULT_OVERSCAN,
    renderItem,
    getItemKey,
    className = '',
    onScrollToBottom,
    scrollBottomThreshold = DEFAULT_SCROLL_THRESHOLD,
    emptyState,
    loading = false,
    loadingMore = false,
  }: VirtualizedListProps<T>,
  ref: React.Ref<VirtualizedListHandle>
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const prevScrollTop = useRef(0);

  // Total height of all items
  const totalHeight = items.length * rowHeight;

  // Calculate visible range
  const visibleCount = Math.ceil(height / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + height) / rowHeight) + overscan
  );

  // Handle scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const newScrollTop = target.scrollTop;
      setScrollTop(newScrollTop);

      // Check if scrolled to bottom (scrolling down only)
      if (newScrollTop > prevScrollTop.current && onScrollToBottom) {
        const distanceFromBottom =
          target.scrollHeight - newScrollTop - target.clientHeight;
        if (distanceFromBottom < scrollBottomThreshold) {
          onScrollToBottom();
        }
      }
      prevScrollTop.current = newScrollTop;
    },
    [onScrollToBottom, scrollBottomThreshold]
  );

  // Imperative handle
  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number, behavior: ScrollBehavior = 'smooth') => {
      const top = index * rowHeight;
      containerRef.current?.scrollTo({ top, behavior });
    },
    scrollToTop: (behavior: ScrollBehavior = 'smooth') => {
      containerRef.current?.scrollTo({ top: 0, behavior });
    },
    scrollToBottom: (behavior: ScrollBehavior = 'smooth') => {
      containerRef.current?.scrollTo({ top: totalHeight, behavior });
    },
    getScrollTop: () => scrollTop,
  }));

  // Loading state
  if (loading) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ height }}
      >
        <div className="animate-spin w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  // Empty state
  if (items.length === 0 && emptyState) {
    return (
      <div className={className} style={{ height }}>
        {emptyState}
      </div>
    );
  }

  // Build visible items
  const visibleItems = [];
  for (let i = startIndex; i <= endIndex && i < items.length; i++) {
    const item = items[i];
    const key = getItemKey(item, i);
    const top = i * rowHeight;

    visibleItems.push(
      <div
        key={key}
        style={{
          position: 'absolute',
          top,
          left: 0,
          right: 0,
          height: rowHeight,
        }}
      >
        {renderItem(item, i)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      style={{ height }}
      onScroll={handleScroll}
    >
      <div
        style={{
          position: 'relative',
          height: totalHeight,
          minHeight: height,
        }}
      >
        {visibleItems}
      </div>

      {/* Loading more indicator */}
      {loadingMore && (
        <div className="absolute bottom-0 left-0 right-0 flex justify-center py-2 bg-gradient-to-t from-gray-900">
          <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-blue-500 rounded-full" />
        </div>
      )}
    </div>
  );
}

// Typed forwardRef wrapper
export const VirtualizedList = forwardRef(VirtualizedListInner) as <T>(
  props: VirtualizedListProps<T> & { ref?: React.Ref<VirtualizedListHandle> }
) => React.ReactElement;

/**
 * Hook for virtualized list with infinite scroll
 */
export function useInfiniteVirtualizedList<T>({
  fetchMore,
  hasMore,
  pageSize = 50,
}: {
  fetchMore: () => Promise<T[]>;
  hasMore: boolean;
  pageSize?: number;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const newItems = await fetchMore();
      setItems((prev) => [...prev, ...newItems]);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchMore, hasMore, loadingMore]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const newItems = await fetchMore();
      setItems(newItems);
    } finally {
      setLoading(false);
    }
  }, [fetchMore]);

  return {
    items,
    loading,
    loadingMore,
    loadMore,
    refresh,
    setItems,
  };
}

export default VirtualizedList;
