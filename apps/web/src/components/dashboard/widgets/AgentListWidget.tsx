/**
 * AgentListWidget - Agent status list visualization.
 *
 * Data shape expected:
 * {
 *   agents: Array<{
 *     id: string,
 *     name: string,
 *     status: 'active' | 'idle' | 'error' | 'offline',
 *     lastActivity?: string,
 *     currentTask?: string,
 *     metrics?: { requests?: number, tokens?: number },
 *   }>
 * }
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import "./AgentListWidget.css";

interface Agent {
  id: string;
  name: string;
  status: "active" | "idle" | "error" | "offline";
  lastActivity?: string;
  currentTask?: string;
  metrics?: {
    requests?: number;
    tokens?: number;
  };
}

interface AgentListData {
  agents: Agent[];
}

interface AgentListWidgetProps {
  widget: Widget;
  data: WidgetData;
}

const STATUS_CONFIG = {
  active: { label: "Active", className: "agent-list-widget__status--active" },
  idle: { label: "Idle", className: "agent-list-widget__status--idle" },
  error: { label: "Error", className: "agent-list-widget__status--error" },
  offline: {
    label: "Offline",
    className: "agent-list-widget__status--offline",
  },
};

export function AgentListWidget({
  widget: _widget,
  data,
}: AgentListWidgetProps) {
  const listData = data.data as AgentListData | null;

  if (!listData?.agents?.length) {
    return (
      <div className="agent-list-widget agent-list-widget--empty">
        No agents found
      </div>
    );
  }

  return (
    <div className="agent-list-widget">
      <ul className="agent-list-widget__list">
        {listData.agents.map((agent) => {
          const statusConfig =
            STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline;

          return (
            <li key={agent.id} className="agent-list-widget__item">
              <div className="agent-list-widget__info">
                <div className="agent-list-widget__header">
                  <span
                    className={`agent-list-widget__status ${statusConfig.className}`}
                  />
                  <span className="agent-list-widget__name">{agent.name}</span>
                </div>

                {agent.currentTask && (
                  <div className="agent-list-widget__task">
                    {agent.currentTask}
                  </div>
                )}

                {agent.lastActivity && (
                  <div className="agent-list-widget__activity">
                    Last: {formatTimeAgo(agent.lastActivity)}
                  </div>
                )}
              </div>

              {agent.metrics && (
                <div className="agent-list-widget__metrics">
                  {agent.metrics.requests !== undefined && (
                    <span className="agent-list-widget__metric">
                      {agent.metrics.requests.toLocaleString()} reqs
                    </span>
                  )}
                  {agent.metrics.tokens !== undefined && (
                    <span className="agent-list-widget__metric">
                      {formatTokens(agent.metrics.tokens)}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M tok`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K tok`;
  }
  return `${tokens} tok`;
}
