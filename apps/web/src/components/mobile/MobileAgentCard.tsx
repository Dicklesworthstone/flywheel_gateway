/**
 * Mobile Agent Card Component
 *
 * Touch-optimized agent card for mobile devices with swipe actions.
 */

import {
  Bot,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { memo, type TouchEvent, useCallback, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useMobileGestures } from "../../hooks/useMobileGestures";

export interface AgentInfo {
  id: string;
  name: string;
  status: "running" | "stopped" | "error" | "starting" | "terminating";
  model: "claude" | "codex" | "gemini" | "unknown";
  uptime?: number;
  sessionCount?: number;
  lastActivity?: number;
  currentTask?: string;
}

export interface MobileAgentCardProps {
  agent: AgentInfo;
  onRestart?: (id: string) => void;
  onStop?: (id: string) => void;
  onStart?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSelect?: (id: string) => void;
  className?: string;
}

const STATUS_COLORS: Record<AgentInfo["status"], string> = {
  running: "bg-green-500",
  stopped: "bg-gray-500",
  error: "bg-red-500",
  starting: "bg-yellow-500",
  terminating: "bg-orange-500",
};

const MODEL_COLORS: Record<AgentInfo["model"], string> = {
  claude: "text-amber-400",
  codex: "text-green-400",
  gemini: "text-blue-400",
  unknown: "text-gray-400",
};

function formatUptime(ms?: number): string {
  if (!ms) return "-";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatLastActivity(timestamp?: number): string {
  if (!timestamp) return "-";
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

/**
 * Mobile-optimized agent card with swipe actions
 */
export const MobileAgentCard = memo(function MobileAgentCard({
  agent,
  onRestart,
  onStop,
  onStart,
  onDelete,
  onSelect,
  className = "",
}: MobileAgentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const { isMobile } = useMediaQuery();

  // Swipe to reveal actions
  const { handlers, state } = useMobileGestures({
    swipeThreshold: 30,
    preventDefaultOnHorizontal: true,
    enabled: isMobile,
  });

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      handlers.onTouchMove(e);
      // Show actions on swipe left
      if (state.swipeOffset.x < 0) {
        setSwipeOffset(Math.max(-120, state.swipeOffset.x));
      } else if (state.swipeOffset.x > 0) {
        setSwipeOffset(0);
      }
    },
    [handlers, state.swipeOffset.x],
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      handlers.onTouchEnd(e);
      // Snap to reveal actions or hide
      if (swipeOffset < -60) {
        setSwipeOffset(-120);
      } else {
        setSwipeOffset(0);
      }
    },
    [handlers, swipeOffset],
  );

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleSelect = useCallback(() => {
    onSelect?.(agent.id);
  }, [agent.id, onSelect]);

  const handleAction = useCallback(
    (action: "restart" | "stop" | "start" | "delete") => {
      setSwipeOffset(0);
      switch (action) {
        case "restart":
          onRestart?.(agent.id);
          break;
        case "stop":
          onStop?.(agent.id);
          break;
        case "start":
          onStart?.(agent.id);
          break;
        case "delete":
          onDelete?.(agent.id);
          break;
      }
    },
    [agent.id, onRestart, onStop, onStart, onDelete],
  );

  const isRunning = agent.status === "running";
  const isStopped = agent.status === "stopped";

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Swipe action buttons (revealed on swipe left) */}
      <div className="absolute inset-y-0 right-0 flex items-stretch">
        {isRunning && (
          <button
            type="button"
            className="w-15 bg-yellow-600 flex items-center justify-center text-white"
            onClick={() => handleAction("restart")}
            aria-label="Restart agent"
          >
            <RefreshCw size={20} />
          </button>
        )}
        {isRunning ? (
          <button
            type="button"
            className="w-15 bg-orange-600 flex items-center justify-center text-white"
            onClick={() => handleAction("stop")}
            aria-label="Stop agent"
          >
            <Pause size={20} />
          </button>
        ) : (
          <button
            type="button"
            className="w-15 bg-green-600 flex items-center justify-center text-white"
            onClick={() => handleAction("start")}
            aria-label="Start agent"
          >
            <Play size={20} />
          </button>
        )}
        {isStopped && (
          <button
            type="button"
            className="w-15 bg-red-600 flex items-center justify-center text-white"
            onClick={() => handleAction("delete")}
            aria-label="Delete agent"
          >
            <Trash2 size={20} />
          </button>
        )}
      </div>

      {/* Main card content (slides on swipe) */}
      <div
        className="relative bg-gray-800 rounded-lg transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${swipeOffset}px)` }}
        onTouchStart={handlers.onTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handlers.onTouchCancel}
      >
        {/* Compact view (always visible) */}
        <div className="p-4 flex items-center gap-3 min-h-[72px]">
          <button
            type="button"
            className="flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer bg-transparent border-0 p-0"
            onClick={handleSelect}
          >
            {/* Status indicator */}
            <div
              className={`w-3 h-3 rounded-full ${STATUS_COLORS[agent.status]}`}
            />

            {/* Agent icon and name */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Bot className={`w-5 h-5 ${MODEL_COLORS[agent.model]}`} />
                <span className="font-medium text-white truncate">
                  {agent.name}
                </span>
              </div>
              {agent.currentTask && (
                <p className="text-sm text-gray-400 truncate mt-0.5">
                  {agent.currentTask}
                </p>
              )}
            </div>

            {/* Quick stats */}
            <div className="text-right text-sm">
              <div className="text-gray-400">{formatUptime(agent.uptime)}</div>
              <div className="text-gray-500 text-xs">
                {agent.sessionCount ?? 0} sessions
              </div>
            </div>
          </button>

          {/* Expand button */}
          <button
            type="button"
            className="p-2 text-gray-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
            onClick={toggleExpanded}
            aria-label={isExpanded ? "Collapse details" : "Expand details"}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-700">
            <div className="grid grid-cols-2 gap-4 pt-4">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  Status
                </div>
                <div className="text-sm text-white capitalize">
                  {agent.status}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  Model
                </div>
                <div
                  className={`text-sm capitalize ${MODEL_COLORS[agent.model]}`}
                >
                  {agent.model}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  Uptime
                </div>
                <div className="text-sm text-white">
                  {formatUptime(agent.uptime)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  Last Activity
                </div>
                <div className="text-sm text-white">
                  {formatLastActivity(agent.lastActivity)}
                </div>
              </div>
            </div>

            {/* Action buttons (visible on desktop or when expanded on mobile) */}
            <div className="flex gap-2 mt-4">
              {isRunning && (
                <>
                  <button
                    type="button"
                    className="flex-1 py-2 px-3 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded-lg flex items-center justify-center gap-2 min-h-[44px]"
                    onClick={() => handleAction("restart")}
                  >
                    <RefreshCw size={16} />
                    Restart
                  </button>
                  <button
                    type="button"
                    className="flex-1 py-2 px-3 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg flex items-center justify-center gap-2 min-h-[44px]"
                    onClick={() => handleAction("stop")}
                  >
                    <Pause size={16} />
                    Stop
                  </button>
                </>
              )}
              {isStopped && (
                <>
                  <button
                    type="button"
                    className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg flex items-center justify-center gap-2 min-h-[44px]"
                    onClick={() => handleAction("start")}
                  >
                    <Play size={16} />
                    Start
                  </button>
                  <button
                    type="button"
                    className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg flex items-center justify-center gap-2 min-h-[44px]"
                    onClick={() => handleAction("delete")}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default MobileAgentCard;
