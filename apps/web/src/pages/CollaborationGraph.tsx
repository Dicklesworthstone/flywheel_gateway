/**
 * Collaboration Graph Page.
 *
 * Provides a real-time visualization of agent coordination:
 * - Interactive force-directed graph of agents and resources
 * - View mode switching (agents, files, full)
 * - Real-time WebSocket updates
 * - Node selection for detailed info
 * - Statistics panel
 * - Graph legend
 */

import {
  AlertTriangle,
  Bot,
  Circle,
  Eye,
  File,
  Folder,
  GitBranch,
  Lock,
  MessageSquare,
  RefreshCw,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "../components/ui/Skeleton";
import { StatusPill } from "../components/ui/StatusPill";
import { Tooltip } from "../components/ui/Tooltip";
import {
  type AgentNode,
  type CollabGraphData,
  type ConflictNode,
  formatRelativeTime,
  formatTimeRemaining,
  getAgentStatusColor,
  getConflictSeverityColor,
  type ReservationNode,
  useCollabGraphData,
  useGraphSelection,
  useGraphSubscription,
  type ViewMode,
} from "../hooks/useCollabGraph";

// ============================================================================
// View Mode Types
// ============================================================================

interface ViewModeOption {
  id: ViewMode;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const viewModeOptions: ViewModeOption[] = [
  {
    id: "agents",
    label: "Agents",
    icon: <Users size={16} />,
    description: "Show agent communication flow",
  },
  {
    id: "files",
    label: "Files",
    icon: <FileText size={16} />,
    description: "Show file reservations",
  },
  {
    id: "full",
    label: "Full",
    icon: <Eye size={16} />,
    description: "Show complete graph",
  },
];

// ============================================================================
// Graph Visualization Component (SVG-based)
// ============================================================================

interface GraphPosition {
  x: number;
  y: number;
}

interface PositionedNode {
  id: string;
  type: "agent" | "reservation" | "conflict";
  data: AgentNode | ReservationNode | ConflictNode;
  position: GraphPosition;
}

function calculateNodePositions(
  data: CollabGraphData | null,
  viewMode: ViewMode,
  width: number,
  height: number,
): PositionedNode[] {
  if (!data) return [];

  const nodes: PositionedNode[] = [];
  const centerX = width / 2;
  const centerY = height / 2;

  // Position agents in a circle
  const agents = data.agents;
  const agentRadius = Math.min(width, height) * 0.3;
  agents.forEach((agent, i) => {
    const angle = (2 * Math.PI * i) / agents.length - Math.PI / 2;
    nodes.push({
      id: agent.id,
      type: "agent",
      data: agent,
      position: {
        x: centerX + agentRadius * Math.cos(angle),
        y: centerY + agentRadius * Math.sin(angle),
      },
    });
  });

  if (viewMode === "files" || viewMode === "full") {
    // Position reservations in an outer ring
    const reservations = data.reservations;
    const resRadius = Math.min(width, height) * 0.45;
    reservations.forEach((res, i) => {
      const angle = (2 * Math.PI * i) / reservations.length - Math.PI / 2;
      nodes.push({
        id: res.id,
        type: "reservation",
        data: res,
        position: {
          x: centerX + resRadius * Math.cos(angle),
          y: centerY + resRadius * Math.sin(angle),
        },
      });
    });
  }

  if (viewMode === "full") {
    // Position conflicts near center
    const conflicts = data.conflicts;
    const conflictRadius = Math.min(width, height) * 0.15;
    conflicts.forEach((conflict, i) => {
      const angle =
        (2 * Math.PI * i) / Math.max(conflicts.length, 1) - Math.PI / 2;
      nodes.push({
        id: conflict.id,
        type: "conflict",
        data: conflict,
        position: {
          x: centerX + conflictRadius * Math.cos(angle),
          y: centerY + conflictRadius * Math.sin(angle),
        },
      });
    });
  }

  return nodes;
}

interface GraphVisualizationProps {
  data: CollabGraphData | null;
  viewMode: ViewMode;
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  width: number;
  height: number;
}

function GraphVisualization({
  data,
  viewMode,
  selectedNodeId,
  onNodeClick,
  width,
  height,
}: GraphVisualizationProps) {
  const nodes = useMemo(
    () => calculateNodePositions(data, viewMode, width, height),
    [data, viewMode, width, height],
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);

  // Build edges from data
  const edges = useMemo(() => {
    if (!data) return [];

    const result: Array<{
      id: string;
      source: GraphPosition;
      target: GraphPosition;
      type: string;
      animated: boolean;
    }> = [];

    // Reservation ownership edges
    if (viewMode === "files" || viewMode === "full") {
      for (const res of data.reservations) {
        const holder = nodes.find(
          (n) =>
            n.type === "agent" &&
            (n.data as AgentNode).agentId === res.holderId,
        );
        const resNode = nodeMap.get(res.id);
        if (holder && resNode) {
          result.push({
            id: `edge-res-${res.id}`,
            source: holder.position,
            target: resNode.position,
            type: "reservation",
            animated: false,
          });
        }

        // Waiting edges
        for (const waiter of res.waiters) {
          const waiterNode = nodes.find(
            (n) =>
              n.type === "agent" && (n.data as AgentNode).agentId === waiter,
          );
          if (waiterNode && resNode) {
            result.push({
              id: `edge-wait-${res.id}-${waiter}`,
              source: waiterNode.position,
              target: resNode.position,
              type: "waiting",
              animated: true,
            });
          }
        }
      }
    }

    // Message edges (agent-to-agent)
    if (viewMode === "agents" || viewMode === "full") {
      for (const msg of data.recentMessages.slice(0, 5)) {
        if (msg.toAgentId === "all") continue;

        const fromNode = nodes.find(
          (n) =>
            n.type === "agent" &&
            (n.data as AgentNode).agentId === msg.fromAgentId,
        );
        const toNode = nodes.find(
          (n) =>
            n.type === "agent" &&
            (n.data as AgentNode).agentId === msg.toAgentId,
        );
        if (fromNode && toNode) {
          result.push({
            id: `edge-msg-${msg.id}`,
            source: fromNode.position,
            target: toNode.position,
            type: "message",
            animated: true,
          });
        }
      }
    }

    return result;
  }, [data, nodes, nodeMap, viewMode]);

  const getEdgeColor = (type: string) => {
    switch (type) {
      case "reservation":
        return "var(--positive)";
      case "waiting":
        return "var(--warning)";
      case "message":
        return "var(--primary)";
      case "dependency":
        return "var(--danger)";
      default:
        return "var(--border)";
    }
  };

  return (
    <svg
      width={width}
      height={height}
      className="collab-graph__svg"
      role="img"
      aria-label="Agent collaboration graph showing agents, reservations, and their relationships"
    >
      <title>Agent Collaboration Graph</title>
      {/* Edges */}
      <g className="collab-graph__edges">
        {edges.map((edge) => (
          <line
            key={edge.id}
            x1={edge.source.x}
            y1={edge.source.y}
            x2={edge.target.x}
            y2={edge.target.y}
            stroke={getEdgeColor(edge.type)}
            strokeWidth={2}
            strokeDasharray={
              edge.type === "waiting" || edge.type === "message"
                ? "5,5"
                : undefined
            }
            opacity={0.6}
            className={edge.animated ? "collab-graph__edge--animated" : ""}
          />
        ))}
      </g>

      {/* Nodes */}
      <g className="collab-graph__nodes">
        {nodes.map((node) => {
          const isSelected = node.id === selectedNodeId;
          const nodeSize =
            node.type === "agent" ? 24 : node.type === "reservation" ? 18 : 20;

          let fillColor = "var(--surface-elevated)";
          let strokeColor = "var(--border)";
          let icon: React.ReactNode = null;

          if (node.type === "agent") {
            const agent = node.data as AgentNode;
            strokeColor = getAgentStatusColor(agent.status);
            icon = <Bot size={14} />;
          } else if (node.type === "reservation") {
            const res = node.data as ReservationNode;
            strokeColor =
              res.mode === "exclusive" ? "var(--warning)" : "var(--positive)";
            icon =
              res.resourceType === "directory" ? (
                <Folder size={12} />
              ) : (
                <File size={12} />
              );
          } else if (node.type === "conflict") {
            const conflict = node.data as ConflictNode;
            strokeColor = getConflictSeverityColor(conflict.severity);
            fillColor = getConflictSeverityColor(conflict.severity);
            icon = <AlertTriangle size={12} />;
          }

          const nodeLabel =
            node.type === "agent"
              ? (node.data as AgentNode).name
              : node.type === "reservation"
                ? (node.data as ReservationNode).resourcePath
                : `Conflict: ${(node.data as ConflictNode).conflictType}`;

          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG groups cannot be replaced with semantic HTML elements
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={nodeLabel}
              className={`collab-graph__node ${isSelected ? "collab-graph__node--selected" : ""}`}
              transform={`translate(${node.position.x}, ${node.position.y})`}
              onClick={() => onNodeClick(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  onNodeClick(node.id);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <circle
                r={nodeSize}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={isSelected ? 3 : 2}
              />
              <foreignObject
                x={-nodeSize / 2}
                y={-nodeSize / 2}
                width={nodeSize}
                height={nodeSize}
                style={{ pointerEvents: "none" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "100%",
                    color: node.type === "conflict" ? "white" : strokeColor,
                  }}
                >
                  {icon}
                </div>
              </foreignObject>
              {node.type === "agent" && (
                <text
                  y={nodeSize + 14}
                  textAnchor="middle"
                  className="collab-graph__node-label"
                  fill="var(--text)"
                  fontSize={11}
                >
                  {(node.data as AgentNode).name.split(" - ")[1] ||
                    (node.data as AgentNode).agentId}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ============================================================================
// Stats Panel Component
// ============================================================================

interface StatsPanelProps {
  data: CollabGraphData | null;
  isLoading: boolean;
}

function StatsPanel({ data, isLoading }: StatsPanelProps) {
  if (isLoading || !data) {
    return (
      <div className="collab-stats">
        <Skeleton height={100} />
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="collab-stats">
      <div className="collab-stats__item">
        <div className="collab-stats__value">{stats.totalAgents}</div>
        <div className="collab-stats__label">Total Agents</div>
      </div>
      <div className="collab-stats__item collab-stats__item--positive">
        <div className="collab-stats__value">{stats.activeAgents}</div>
        <div className="collab-stats__label">Active</div>
      </div>
      <div className="collab-stats__item collab-stats__item--danger">
        <div className="collab-stats__value">{stats.blockedAgents}</div>
        <div className="collab-stats__label">Blocked</div>
      </div>
      <div className="collab-stats__item">
        <div className="collab-stats__value">{stats.totalReservations}</div>
        <div className="collab-stats__label">Reservations</div>
      </div>
      <div className="collab-stats__item collab-stats__item--warning">
        <div className="collab-stats__value">{stats.activeConflicts}</div>
        <div className="collab-stats__label">Conflicts</div>
      </div>
      <div className="collab-stats__item">
        <div className="collab-stats__value">{stats.messagesLast5m}</div>
        <div className="collab-stats__label">Msgs (5m)</div>
      </div>
    </div>
  );
}

// ============================================================================
// Legend Component
// ============================================================================

function GraphLegend() {
  return (
    <div className="collab-legend">
      <div className="collab-legend__title">Legend</div>
      <div className="collab-legend__section">
        <div className="eyebrow">Nodes</div>
        <div className="collab-legend__item">
          <Circle size={12} fill="var(--positive)" stroke="var(--positive)" />
          <span>Active Agent</span>
        </div>
        <div className="collab-legend__item">
          <Circle
            size={12}
            fill="var(--surface-elevated)"
            stroke="var(--warning)"
          />
          <span>Waiting Agent</span>
        </div>
        <div className="collab-legend__item">
          <Circle
            size={12}
            fill="var(--surface-elevated)"
            stroke="var(--danger)"
          />
          <span>Blocked Agent</span>
        </div>
        <div className="collab-legend__item">
          <Circle
            size={10}
            fill="var(--surface-elevated)"
            stroke="var(--positive)"
          />
          <span>Shared Reservation</span>
        </div>
        <div className="collab-legend__item">
          <Circle
            size={10}
            fill="var(--surface-elevated)"
            stroke="var(--warning)"
          />
          <span>Exclusive Reservation</span>
        </div>
        <div className="collab-legend__item">
          <Circle size={10} fill="var(--danger)" stroke="var(--danger)" />
          <span>Conflict</span>
        </div>
      </div>
      <div className="collab-legend__section">
        <div className="eyebrow">Edges</div>
        <div className="collab-legend__item">
          <svg width={24} height={12} aria-hidden="true">
            <line
              x1={0}
              y1={6}
              x2={24}
              y2={6}
              stroke="var(--positive)"
              strokeWidth={2}
            />
          </svg>
          <span>Owns Resource</span>
        </div>
        <div className="collab-legend__item">
          <svg width={24} height={12} aria-hidden="true">
            <line
              x1={0}
              y1={6}
              x2={24}
              y2={6}
              stroke="var(--warning)"
              strokeWidth={2}
              strokeDasharray="5,5"
            />
          </svg>
          <span>Waiting for Resource</span>
        </div>
        <div className="collab-legend__item">
          <svg width={24} height={12} aria-hidden="true">
            <line
              x1={0}
              y1={6}
              x2={24}
              y2={6}
              stroke="var(--primary)"
              strokeWidth={2}
              strokeDasharray="5,5"
            />
          </svg>
          <span>Message Flow</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Node Detail Panel
// ============================================================================

interface NodeDetailPanelProps {
  node: PositionedNode | null;
  data: CollabGraphData | null;
  onClose: () => void;
}

function NodeDetailPanel({ node, data, onClose }: NodeDetailPanelProps) {
  if (!node) return null;

  return (
    <div className="collab-detail">
      <div className="collab-detail__header">
        <h3>
          {node.type === "agent"
            ? "Agent Details"
            : node.type === "reservation"
              ? "Reservation Details"
              : "Conflict Details"}
        </h3>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="collab-detail__content">
        {node.type === "agent" && (
          <AgentDetailContent agent={node.data as AgentNode} data={data} />
        )}
        {node.type === "reservation" && (
          <ReservationDetailContent
            reservation={node.data as ReservationNode}
            data={data}
          />
        )}
        {node.type === "conflict" && (
          <ConflictDetailContent
            conflict={node.data as ConflictNode}
            data={data}
          />
        )}
      </div>
    </div>
  );
}

function AgentDetailContent({
  agent,
  data: _data,
}: {
  agent: AgentNode;
  data: CollabGraphData | null;
}) {
  const statusTone =
    agent.status === "active"
      ? "positive"
      : agent.status === "blocked"
        ? "danger"
        : agent.status === "waiting"
          ? "warning"
          : "muted";

  return (
    <>
      <div className="collab-detail__field">
        <div className="eyebrow">Name</div>
        <div>{agent.name}</div>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Status</div>
        <StatusPill tone={statusTone}>{agent.status}</StatusPill>
      </div>
      {agent.currentTask && (
        <div className="collab-detail__field">
          <div className="eyebrow">Current Task</div>
          <div>{agent.currentTask}</div>
        </div>
      )}
      <div className="collab-detail__field">
        <div className="eyebrow">Last Active</div>
        <div>{formatRelativeTime(agent.lastActiveAt)}</div>
      </div>
      <div className="collab-detail__stats">
        <div className="collab-detail__stat">
          <Lock size={14} />
          <span>{agent.reservationCount} reservations</span>
        </div>
        <div className="collab-detail__stat">
          <MessageSquare size={14} />
          <span>
            {agent.messagesSent} sent / {agent.messagesReceived} received
          </span>
        </div>
      </div>
    </>
  );
}

function ReservationDetailContent({
  reservation,
  data,
}: {
  reservation: ReservationNode;
  data: CollabGraphData | null;
}) {
  const holder = data?.agents.find((a) => a.agentId === reservation.holderId);

  return (
    <>
      <div className="collab-detail__field">
        <div className="eyebrow">Resource Path</div>
        <code className="collab-detail__code">{reservation.resourcePath}</code>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Type</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {reservation.resourceType === "directory" ? (
            <Folder size={14} />
          ) : (
            <File size={14} />
          )}
          <span>{reservation.resourceType}</span>
        </div>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Mode</div>
        <StatusPill
          tone={reservation.mode === "exclusive" ? "warning" : "positive"}
        >
          {reservation.mode}
        </StatusPill>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Held By</div>
        <div>{holder?.name || reservation.holderId}</div>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Acquired</div>
        <div>{formatRelativeTime(reservation.acquiredAt)}</div>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Expires</div>
        <div>{formatTimeRemaining(reservation.expiresAt)}</div>
      </div>
      {reservation.waiters.length > 0 && (
        <div className="collab-detail__field">
          <div className="eyebrow">Waiters ({reservation.waiters.length})</div>
          <div className="collab-detail__list">
            {reservation.waiters.map((w) => {
              const waiter = data?.agents.find((a) => a.agentId === w);
              return (
                <div key={w} className="collab-detail__list-item">
                  <Bot size={12} />
                  <span>{waiter?.name || w}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function ConflictDetailContent({
  conflict,
  data,
}: {
  conflict: ConflictNode;
  data: CollabGraphData | null;
}) {
  return (
    <>
      <div className="collab-detail__field">
        <div className="eyebrow">Type</div>
        <StatusPill tone="danger">{conflict.conflictType}</StatusPill>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Severity</div>
        <StatusPill
          tone={conflict.severity === "critical" ? "danger" : "warning"}
        >
          {conflict.severity}
        </StatusPill>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Detected</div>
        <div>{formatRelativeTime(conflict.detectedAt)}</div>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Involved Agents</div>
        <div className="collab-detail__list">
          {conflict.involvedAgents.map((agentId) => {
            const agent = data?.agents.find((a) => a.agentId === agentId);
            return (
              <div key={agentId} className="collab-detail__list-item">
                <Bot size={12} />
                <span>{agent?.name || agentId}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="collab-detail__field">
        <div className="eyebrow">Involved Resources</div>
        <div className="collab-detail__list">
          {conflict.involvedResources.map((res) => (
            <div key={res} className="collab-detail__list-item">
              <File size={12} />
              <code>{res}</code>
            </div>
          ))}
        </div>
      </div>
      {conflict.resolution && (
        <div className="collab-detail__field">
          <div className="eyebrow">Suggested Resolution</div>
          <div>{conflict.resolution}</div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export function CollaborationGraphPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Fetch graph data
  const { data, isLoading, error, refetch } = useCollabGraphData();

  // Selection state
  const { selectedNodeId, selectNode, clearSelection } = useGraphSelection();

  // WebSocket subscription for real-time updates
  const subscription = useGraphSubscription({
    onAgentStatus: () => refetch(),
    onReservationAcquired: () => refetch(),
    onReservationReleased: () => refetch(),
    onConflictDetected: () => refetch(),
    onConflictResolved: () => refetch(),
  });

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: Math.max(rect.height, 400),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Get selected node
  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !data) return null;

    // Check agents
    for (const agent of data.agents) {
      if (agent.id === selectedNodeId) {
        return {
          id: agent.id,
          type: "agent" as const,
          data: agent,
          position: { x: 0, y: 0 },
        };
      }
    }

    // Check reservations
    for (const res of data.reservations) {
      if (res.id === selectedNodeId) {
        return {
          id: res.id,
          type: "reservation" as const,
          data: res,
          position: { x: 0, y: 0 },
        };
      }
    }

    // Check conflicts
    for (const conflict of data.conflicts) {
      if (conflict.id === selectedNodeId) {
        return {
          id: conflict.id,
          type: "conflict" as const,
          data: conflict,
          position: { x: 0, y: 0 },
        };
      }
    }

    return null;
  }, [selectedNodeId, data]);

  return (
    <div className="page collab-page">
      <div className="page__header">
        <div className="page__title-group">
          <h1 className="page__title">
            <GitBranch size={24} />
            Collaboration Graph
          </h1>
          <p className="muted">Real-time visualization of agent coordination</p>
        </div>
        <div className="page__actions">
          <div className="collab-connection">
            {subscription.connected ? (
              <Tooltip content="Connected - Real-time updates active">
                <span className="collab-connection__status collab-connection__status--connected">
                  <Wifi size={14} />
                  <span>Live</span>
                </span>
              </Tooltip>
            ) : (
              <Tooltip content="Disconnected - Click to reconnect">
                <button
                  type="button"
                  className="collab-connection__status collab-connection__status--disconnected"
                  onClick={subscription.reconnect}
                >
                  <WifiOff size={14} />
                  <span>Offline</span>
                </button>
              </Tooltip>
            )}
          </div>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={refetch}
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Panel */}
      <StatsPanel data={data} isLoading={isLoading} />

      {/* View Mode Selector */}
      <div className="collab-toolbar">
        <div className="collab-toolbar__view-modes">
          {viewModeOptions.map((option) => (
            <Tooltip key={option.id} content={option.description}>
              <button
                type="button"
                className={`btn btn--sm ${viewMode === option.id ? "btn--primary" : "btn--secondary"}`}
                onClick={() => setViewMode(option.id)}
              >
                {option.icon}
                {option.label}
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="collab-toolbar__info">
          {subscription.eventCount > 0 && (
            <span className="muted">
              <Zap size={12} />
              {subscription.eventCount} events
            </span>
          )}
          {data?.lastUpdated && (
            <span className="muted">
              Updated {formatRelativeTime(data.lastUpdated)}
            </span>
          )}
        </div>
      </div>

      {/* Graph Container */}
      <div className="collab-container">
        <div className="collab-graph" ref={containerRef}>
          {isLoading ? (
            <div className="collab-graph__loading">
              <Skeleton height={dimensions.height} />
            </div>
          ) : error && !data ? (
            <div className="collab-graph__error">
              <AlertTriangle size={48} />
              <p>Failed to load graph data</p>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={refetch}
              >
                Try Again
              </button>
            </div>
          ) : (
            <GraphVisualization
              data={data}
              viewMode={viewMode}
              selectedNodeId={selectedNodeId}
              onNodeClick={selectNode}
              width={dimensions.width}
              height={dimensions.height}
            />
          )}
        </div>

        {/* Side Panels */}
        <div className="collab-sidepanel">
          <GraphLegend />
          {selectedNode && (
            <NodeDetailPanel
              node={selectedNode}
              data={data}
              onClose={clearSelection}
            />
          )}
        </div>
      </div>

      {/* Styles */}
      <style>{`
        .collab-page {
          display: flex;
          flex-direction: column;
          gap: 16px;
          height: 100%;
        }

        .collab-stats {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .collab-stats__item {
          flex: 1;
          min-width: 100px;
          padding: 12px 16px;
          background: var(--surface-elevated);
          border-radius: 8px;
          border: 1px solid var(--border);
          text-align: center;
        }

        .collab-stats__item--positive .collab-stats__value {
          color: var(--positive);
        }

        .collab-stats__item--warning .collab-stats__value {
          color: var(--warning);
        }

        .collab-stats__item--danger .collab-stats__value {
          color: var(--danger);
        }

        .collab-stats__value {
          font-size: 24px;
          font-weight: 600;
          line-height: 1.2;
        }

        .collab-stats__label {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .collab-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .collab-toolbar__view-modes {
          display: flex;
          gap: 8px;
        }

        .collab-toolbar__info {
          display: flex;
          gap: 16px;
          align-items: center;
          font-size: 12px;
        }

        .collab-toolbar__info span {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .collab-container {
          display: flex;
          gap: 16px;
          flex: 1;
          min-height: 400px;
        }

        .collab-graph {
          flex: 1;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          position: relative;
        }

        .collab-graph__svg {
          display: block;
        }

        .collab-graph__loading,
        .collab-graph__error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 16px;
          color: var(--text-muted);
        }

        .collab-graph__node {
          transition: transform 0.15s ease;
        }

        .collab-graph__node:hover {
          transform: scale(1.1);
        }

        .collab-graph__node--selected circle {
          filter: drop-shadow(0 0 6px var(--primary));
        }

        .collab-graph__node-label {
          font-family: var(--font-mono);
        }

        .collab-graph__edge--animated {
          animation: dash 1s linear infinite;
        }

        @keyframes dash {
          to {
            stroke-dashoffset: -10;
          }
        }

        .collab-sidepanel {
          width: 280px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex-shrink: 0;
        }

        .collab-legend {
          background: var(--surface-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
        }

        .collab-legend__title {
          font-weight: 600;
          margin-bottom: 12px;
        }

        .collab-legend__section {
          margin-bottom: 12px;
        }

        .collab-legend__section:last-child {
          margin-bottom: 0;
        }

        .collab-legend__item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          padding: 4px 0;
          color: var(--text-muted);
        }

        .collab-detail {
          background: var(--surface-elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          flex: 1;
        }

        .collab-detail__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
        }

        .collab-detail__header h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
        }

        .collab-detail__content {
          padding: 16px;
        }

        .collab-detail__field {
          margin-bottom: 12px;
        }

        .collab-detail__field:last-child {
          margin-bottom: 0;
        }

        .collab-detail__code {
          font-size: 12px;
          background: var(--surface);
          padding: 4px 8px;
          border-radius: 4px;
          display: inline-block;
          word-break: break-all;
        }

        .collab-detail__stats {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
        }

        .collab-detail__stat {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .collab-detail__list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 4px;
        }

        .collab-detail__list-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          padding: 4px 8px;
          background: var(--surface);
          border-radius: 4px;
        }

        .collab-detail__list-item code {
          font-size: 11px;
        }

        .collab-connection {
          margin-right: 8px;
        }

        .collab-connection__status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 4px;
          border: none;
          cursor: default;
        }

        .collab-connection__status--connected {
          background: rgba(var(--positive-rgb), 0.1);
          color: var(--positive);
        }

        .collab-connection__status--disconnected {
          background: rgba(var(--danger-rgb), 0.1);
          color: var(--danger);
          cursor: pointer;
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
          .collab-container {
            flex-direction: column;
          }

          .collab-sidepanel {
            width: 100%;
            flex-direction: row;
            flex-wrap: wrap;
          }

          .collab-legend {
            flex: 1;
            min-width: 200px;
          }

          .collab-detail {
            flex: 2;
            min-width: 280px;
          }
        }
      `}</style>
    </div>
  );
}
