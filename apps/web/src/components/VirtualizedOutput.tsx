/**
 * VirtualizedOutput Component
 *
 * Efficiently renders large lists of log lines using windowing/virtualization.
 * Only renders visible items plus a small overscan buffer for smooth scrolling.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface OutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: "stdout" | "stderr" | "system" | "tool" | "thinking";
  metadata?: {
    toolName?: string;
    agentId?: string;
    correlationId?: string;
  };
}

export interface VirtualizedOutputProps {
  /** Array of log lines to display */
  lines: OutputLine[];
  /** Height of the container (required for virtualization) */
  height: number;
  /** Estimated height of each row (will be measured dynamically) */
  estimatedRowHeight?: number;
  /** Number of rows to render above/below visible area */
  overscan?: number;
  /** Auto-scroll to bottom when new lines arrive */
  autoScroll?: boolean;
  /** Callback when user scrolls away from bottom */
  onScrollAwayFromBottom?: () => void;
  /** Callback when a line is clicked */
  onLineClick?: (line: OutputLine) => void;
  /** Custom class name */
  className?: string;
}

export interface VirtualizedOutputHandle {
  scrollToBottom: () => void;
  scrollToTop: () => void;
  scrollToLine: (index: number) => void;
}

interface RowHeights {
  [index: number]: number;
}

const DEFAULT_ROW_HEIGHT = 24;
const OVERSCAN_COUNT = 20;
const SCROLL_BOTTOM_THRESHOLD = 50;

/**
 * Individual output row component
 */
const OutputRow = memo(function OutputRow({
  line,
  index,
  style,
  onHeightChange,
  onClick,
}: {
  line: OutputLine;
  index: number;
  style: React.CSSProperties;
  onHeightChange?: (index: number, height: number) => void;
  onClick?: () => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (rowRef.current && onHeightChange) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          onHeightChange(index, entry.contentRect.height);
        }
      });
      observer.observe(rowRef.current);
      return () => observer.disconnect();
    }
  }, [onHeightChange, index]);

  const typeStyles: Record<OutputLine["type"], string> = {
    stdout: "text-gray-200",
    stderr: "text-red-400",
    system: "text-blue-400 italic",
    tool: "text-green-400",
    thinking: "text-yellow-400 opacity-70",
  };

  return (
    <button
      type="button"
      ref={rowRef}
      style={style}
      className={`flex items-start px-3 py-0.5 hover:bg-gray-800/50 cursor-pointer font-mono text-sm ${typeStyles[line.type]}`}
      onClick={onClick}
    >
      <span className="text-gray-500 text-xs w-20 flex-shrink-0 mr-2">
        {formatTimestamp(line.timestamp)}
      </span>
      {line.metadata?.toolName && (
        <span className="text-purple-400 mr-2">[{line.metadata.toolName}]</span>
      )}
      <span className="whitespace-pre-wrap break-all flex-1">
        {line.content}
      </span>
    </button>
  );
});

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * VirtualizedOutput main component
 */
export const VirtualizedOutput = forwardRef<
  VirtualizedOutputHandle,
  VirtualizedOutputProps
>(function VirtualizedOutput(
  {
    lines,
    height,
    estimatedRowHeight = DEFAULT_ROW_HEIGHT,
    overscan = OVERSCAN_COUNT,
    autoScroll = true,
    onScrollAwayFromBottom,
    onLineClick,
    className = "",
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowHeights, setRowHeights] = useState<RowHeights>({});
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevLinesLengthRef = useRef(lines.length);

  // Calculate positions and visible range
  const getItemTop = useCallback(
    (index: number): number => {
      let top = 0;
      for (let i = 0; i < index; i++) {
        top += rowHeights[i] || estimatedRowHeight;
      }
      return top;
    },
    [rowHeights, estimatedRowHeight],
  );

  const getItemHeight = useCallback(
    (index: number): number => {
      return rowHeights[index] || estimatedRowHeight;
    },
    [rowHeights, estimatedRowHeight],
  );

  const totalHeight = lines.reduce((sum, _, i) => sum + getItemHeight(i), 0);

  // Find visible range
  const getVisibleRange = useCallback(() => {
    let startIndex = 0;
    let accumulatedHeight = 0;

    // Find start index
    for (let i = 0; i < lines.length; i++) {
      const itemHeight = getItemHeight(i);
      if (accumulatedHeight + itemHeight > scrollTop) {
        startIndex = i;
        break;
      }
      accumulatedHeight += itemHeight;
    }

    // Find end index
    let endIndex = startIndex;
    let visibleHeight = 0;
    for (let i = startIndex; i < lines.length; i++) {
      visibleHeight += getItemHeight(i);
      endIndex = i;
      if (visibleHeight >= height) break;
    }

    // Apply overscan
    const overscanStart = Math.max(0, startIndex - overscan);
    const overscanEnd = Math.min(lines.length - 1, endIndex + overscan);

    return { startIndex: overscanStart, endIndex: overscanEnd };
  }, [scrollTop, height, lines.length, getItemHeight, overscan]);

  const { startIndex, endIndex } = getVisibleRange();

  // Handle scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      setScrollTop(target.scrollTop);

      const isNowAtBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight <
        SCROLL_BOTTOM_THRESHOLD;

      if (!isNowAtBottom && isAtBottom) {
        onScrollAwayFromBottom?.();
      }
      setIsAtBottom(isNowAtBottom);
    },
    [isAtBottom, onScrollAwayFromBottom],
  );

  // Handle row height changes
  const handleRowHeightChange = useCallback((index: number, height: number) => {
    setRowHeights((prev) => {
      if (prev[index] === height) return prev;
      return { ...prev, [index]: height };
    });
  }, []);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && isAtBottom && lines.length > prevLinesLengthRef.current) {
      containerRef.current?.scrollTo({
        top: totalHeight,
        behavior: "smooth",
      });
    }
    prevLinesLengthRef.current = lines.length;
  }, [lines.length, autoScroll, isAtBottom, totalHeight]);

  // Imperative handle for external control
  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      containerRef.current?.scrollTo({
        top: totalHeight,
        behavior: "smooth",
      });
      setIsAtBottom(true);
    },
    scrollToTop: () => {
      containerRef.current?.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    },
    scrollToLine: (index: number) => {
      const top = getItemTop(index);
      containerRef.current?.scrollTo({
        top,
        behavior: "smooth",
      });
    },
  }));

  // Render visible items
  const visibleItems = [];
  for (let i = startIndex; i <= endIndex && i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const top = getItemTop(i);

    visibleItems.push(
      <OutputRow
        key={line.id}
        line={line}
        index={i}
        style={{
          position: "absolute",
          top,
          left: 0,
          right: 0,
          minHeight: estimatedRowHeight,
        }}
        onHeightChange={handleRowHeightChange}
        onClick={() => onLineClick?.(line)}
      />,
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-auto bg-gray-900 ${className}`}
      style={{ height }}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Agent output"
    >
      <div
        style={{
          position: "relative",
          height: totalHeight,
          minHeight: height,
        }}
      >
        {visibleItems}
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && lines.length > 0 && (
        <button
          type="button"
          className="absolute bottom-4 right-4 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-full shadow-lg transition-colors"
          onClick={() => {
            containerRef.current?.scrollTo({
              top: totalHeight,
              behavior: "smooth",
            });
            setIsAtBottom(true);
          }}
          aria-label="Scroll to bottom"
        >
          New output
        </button>
      )}
    </div>
  );
});

/**
 * Empty state component for when there are no lines
 */
export function VirtualizedOutputEmpty({
  message = "No output yet",
}: {
  message?: string;
}) {
  return (
    <div className="flex items-center justify-center h-full text-gray-500 text-sm">
      {message}
    </div>
  );
}

export default VirtualizedOutput;
