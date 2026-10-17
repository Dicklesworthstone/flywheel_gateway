/**
 * Collaboration Graph Routes - REST API endpoints for real-time agent coordination visualization.
 *
 * Aggregates live agent states, file reservations, conflict records, and
 * coordination events into the graph structure consumed by CollaborationGraph.tsx.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { sqlite } from "../db";
import { getLogger } from "../middleware/correlation";
import { listAgents } from "../services/agent";
import { getGraphBridgeService } from "../services/graph-bridge";
import { getGraphEventsService } from "../services/graph-events";
import {
  listConflicts,
  listReservations,
} from "../services/reservation.service";
import {
  sendInternalError,
  sendResource,
  sendValidationError,
} from "../utils/response";
import { transformZodError } from "../utils/validation";
import { getHub } from "../ws/hub";

const collaboration = new Hono();

export type AgentStatus = "active" | "idle" | "waiting" | "blocked";
export type ConflictType = "deadlock" | "contention" | "timeout";
export type ConflictSeverity = "warning" | "critical";
export type ResourceType = "file" | "directory" | "lock";
export type EdgeType =
  | "message"
  | "handoff"
  | "dependency"
  | "reservation"
  | "waiting";

export interface AgentNode {
  id: string;
  agentId: string;
  name: string;
  status: AgentStatus;
  currentTask?: string;
  reservationCount: number;
  messagesSent: number;
  messagesReceived: number;
  lastActiveAt: string;
}

export interface ReservationNode {
  id: string;
  resourcePath: string;
  resourceType: ResourceType;
  holderId: string;
  waiters: string[];
  acquiredAt: string;
  expiresAt: string;
  mode: "exclusive" | "shared";
}

export interface ConflictNode {
  id: string;
  conflictType: ConflictType;
  involvedAgents: string[];
  involvedResources: string[];
  severity: ConflictSeverity;
  detectedAt: string;
  resolution?: string;
}

export interface MessageEvent {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  subject: string;
  timestamp: string;
  threadId?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  animated?: boolean;
  label?: string;
  data?: Record<string, unknown>;
}

export interface GraphStats {
  totalAgents: number;
  activeAgents: number;
  blockedAgents: number;
  totalReservations: number;
  activeConflicts: number;
  messagesLast5m: number;
}

export interface CollabGraphData {
  agents: AgentNode[];
  reservations: ReservationNode[];
  conflicts: ConflictNode[];
  recentMessages: MessageEvent[];
  edges: GraphEdge[];
  stats: GraphStats;
  lastUpdated: string;
}

const MessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function mapLifecycleStatus(state: string): AgentStatus {
  const normalized = state.toLowerCase();
  if (
    normalized === "working" ||
    normalized === "running" ||
    normalized === "executing" ||
    normalized === "active"
  ) {
    return "active";
  }
  if (normalized === "paused" || normalized === "waiting") {
    return "waiting";
  }
  if (
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "blocked"
  ) {
    return "blocked";
  }
  return "idle";
}

async function gatherReservations(
  projectId?: string,
): Promise<ReservationNode[]> {
  const nodes: ReservationNode[] = [];
  const seenIds = new Set<string>();

  try {
    const projectIds = projectId ? [projectId] : ["default", "project-1"];
    for (const pid of projectIds) {
      const resList = await listReservations({ projectId: pid, limit: 100 });
      for (const r of resList.reservations) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
        const primaryPattern = r.patterns[0] ?? "*";
        const resourceType: ResourceType =
          primaryPattern.includes("*") || primaryPattern.endsWith("/")
            ? "directory"
            : "file";
        nodes.push({
          id: r.id,
          resourcePath: primaryPattern,
          resourceType,
          holderId: r.agentId,
          waiters: [],
          acquiredAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          mode: r.mode,
        });
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const rows = sqlite
      .query(`SELECT * FROM file_reservations WHERE expires_at > ? LIMIT 100`)
      .all(nowSec) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const id = String(row["id"]);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      let patterns: string[] = [];
      try {
        patterns = JSON.parse(String(row["patterns"] ?? "[]"));
      } catch {}
      const primaryPattern = patterns[0] ?? "*";
      const resourceType: ResourceType =
        primaryPattern.includes("*") || primaryPattern.endsWith("/")
          ? "directory"
          : "file";
      nodes.push({
        id,
        resourcePath: primaryPattern,
        resourceType,
        holderId: String(row["agent_id"]),
        waiters: [],
        acquiredAt: new Date(Number(row["created_at"]) * 1000).toISOString(),
        expiresAt: new Date(Number(row["expires_at"]) * 1000).toISOString(),
        mode: row["mode"] === "shared" ? "shared" : "exclusive",
      });
    }
  } catch {
    // Ignore if sqlite table is unavailable
  }

  return nodes;
}

async function gatherConflicts(
  reservations: ReservationNode[],
  projectId?: string,
): Promise<ConflictNode[]> {
  const conflicts: ConflictNode[] = [];
  const seenIds = new Set<string>();
  const projectIds = projectId ? [projectId] : ["default", "project-1"];

  for (const pid of projectIds) {
    try {
      const openList = await listConflicts({
        projectId: pid,
        status: "open",
        limit: 100,
      });
      for (const c of openList.conflicts) {
        if (seenIds.has(c.conflictId)) continue;
        seenIds.add(c.conflictId);
        const holderId = c.conflict.existingReservation.requesterId;
        const waiterId = c.requesterId;
        const resNode = reservations.find(
          (r) => r.id === c.existingReservationId,
        );
        if (resNode && !resNode.waiters.includes(waiterId)) {
          resNode.waiters.push(waiterId);
        }
        conflicts.push({
          id: c.conflictId,
          conflictType: "contention",
          involvedAgents: [holderId, waiterId],
          involvedResources: [c.overlappingPattern],
          severity: "warning",
          detectedAt: c.detectedAt.toISOString(),
        });
      }
    } catch {
      // Ignore error
    }
  }

  try {
    const predRows = sqlite
      .query(
        `SELECT * FROM conflict_predictions WHERE has_conflicts = 1 ORDER BY predicted_at DESC LIMIT 25`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of predRows) {
      const id = String(row["id"]);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      let files: string[] = [];
      try {
        files = JSON.parse(String(row["conflicting_files"] ?? "[]"));
      } catch {}
      conflicts.push({
        id,
        conflictType: "contention",
        involvedAgents: [String(row["branch_a"]), String(row["branch_b"])],
        involvedResources: files,
        severity: row["severity"] === "high" ? "critical" : "warning",
        detectedAt: new Date(Number(row["predicted_at"])).toISOString(),
        ...(typeof row["recommendation"] === "string" && {
          resolution: row["recommendation"],
        }),
      });
    }
  } catch {
    // Ignore if table not created yet
  }

  return conflicts;
}

async function gatherAgents(
  reservations: ReservationNode[],
  conflicts: ConflictNode[],
): Promise<AgentNode[]> {
  const nodesByAgentId = new Map<string, AgentNode>();

  const countReservations = (agentId: string) =>
    reservations.filter((r) => r.holderId === agentId).length;

  const isAgentBlocked = (agentId: string) =>
    conflicts.some(
      (c) => c.severity === "critical" && c.involvedAgents.includes(agentId),
    );
  const isAgentWaiting = (agentId: string) =>
    reservations.some((r) => r.waiters.includes(agentId));

  try {
    const liveResult = await listAgents({ limit: 100 });
    for (const a of liveResult.agents) {
      let status = mapLifecycleStatus(a.state);
      if (isAgentBlocked(a.agentId)) status = "blocked";
      else if (isAgentWaiting(a.agentId)) status = "waiting";

      nodesByAgentId.set(a.agentId, {
        id: `agent-node-${a.agentId}`,
        agentId: a.agentId,
        name: `${a.driver}:${a.agentId}`,
        status,
        reservationCount: countReservations(a.agentId),
        messagesSent: 0,
        messagesReceived: 0,
        lastActiveAt: a.lastActivityAt,
      });
    }
  } catch {
    // Ignore
  }

  try {
    const dbAgents = sqlite
      .query(`SELECT * FROM agents ORDER BY updated_at DESC LIMIT 100`)
      .all() as Array<Record<string, unknown>>;
    for (const row of dbAgents) {
      const agentId = String(row["id"]);
      if (nodesByAgentId.has(agentId)) continue;
      let status = mapLifecycleStatus(String(row["status"] ?? "idle"));
      if (isAgentBlocked(agentId)) status = "blocked";
      else if (isAgentWaiting(agentId)) status = "waiting";

      const updatedAtVal = row["updated_at"] ?? row["created_at"];
      const lastActiveAt =
        typeof updatedAtVal === "number"
          ? new Date(
              updatedAtVal > 1e11 ? updatedAtVal : updatedAtVal * 1000,
            ).toISOString()
          : new Date().toISOString();

      nodesByAgentId.set(agentId, {
        id: `agent-node-${agentId}`,
        agentId,
        name: String(row["name"] ?? row["type"] ?? agentId),
        status,
        reservationCount: countReservations(agentId),
        messagesSent: 0,
        messagesReceived: 0,
        lastActiveAt,
      });
    }
  } catch {
    // Ignore
  }

  // Ensure any agent holding or waiting on a reservation is represented as a node
  for (const res of reservations) {
    if (!nodesByAgentId.has(res.holderId)) {
      nodesByAgentId.set(res.holderId, {
        id: `agent-node-${res.holderId}`,
        agentId: res.holderId,
        name: res.holderId,
        status: isAgentBlocked(res.holderId) ? "blocked" : "active",
        reservationCount: countReservations(res.holderId),
        messagesSent: 0,
        messagesReceived: 0,
        lastActiveAt: res.acquiredAt,
      });
    }
    for (const waiterId of res.waiters) {
      if (!nodesByAgentId.has(waiterId)) {
        nodesByAgentId.set(waiterId, {
          id: `agent-node-${waiterId}`,
          agentId: waiterId,
          name: waiterId,
          status: "waiting",
          currentTask: `Waiting for ${res.resourcePath}`,
          reservationCount: countReservations(waiterId),
          messagesSent: 0,
          messagesReceived: 0,
          lastActiveAt: new Date().toISOString(),
        });
      }
    }
  }

  return Array.from(nodesByAgentId.values());
}

function gatherMessages(
  agents: AgentNode[],
  reservations: ReservationNode[],
  limit = 20,
): MessageEvent[] {
  const messages: MessageEvent[] = [];

  try {
    const auditRows = sqlite
      .query(
        `SELECT id, user_id, action, resource, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;

    for (const row of auditRows) {
      const fromId = String(row["user_id"] ?? agents[0]?.agentId ?? "system");
      const toId = String(row["resource"] ?? "all");
      const tsVal = Number(row["created_at"] ?? Date.now());
      const timestamp = new Date(
        tsVal > 1e11 ? tsVal : tsVal * 1000,
      ).toISOString();
      messages.push({
        id: String(row["id"]),
        fromAgentId: fromId,
        toAgentId: toId,
        subject: String(row["action"] ?? "coordination.event"),
        timestamp,
      });
    }
  } catch {
    // Ignore if audit_logs table is empty or unavailable
  }

  if (messages.length === 0 && reservations.length > 0) {
    for (const res of reservations.slice(0, limit)) {
      messages.push({
        id: `msg-res-${res.id}`,
        fromAgentId: res.holderId,
        toAgentId: res.waiters[0] ?? "all",
        subject: `Reserved ${res.resourcePath} (${res.mode})`,
        timestamp: res.acquiredAt,
        threadId: res.id,
      });
    }
  }

  return messages.slice(0, limit);
}

function buildEdges(
  agents: AgentNode[],
  reservations: ReservationNode[],
  conflicts: ConflictNode[],
  messages: MessageEvent[],
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const nodeByAgentId = new Map(agents.map((a) => [a.agentId, a.id]));

  for (const msg of messages) {
    if (msg.toAgentId !== "all") {
      const source = nodeByAgentId.get(msg.fromAgentId);
      const target = nodeByAgentId.get(msg.toAgentId);
      if (source && target) {
        edges.push({
          id: `edge-msg-${msg.id}`,
          source,
          target,
          type: "message",
          animated: true,
          label: msg.subject,
        });
      }
    }
  }

  for (const res of reservations) {
    const holderNodeId = nodeByAgentId.get(res.holderId);
    if (holderNodeId) {
      edges.push({
        id: `edge-res-${res.id}`,
        source: holderNodeId,
        target: res.id,
        type: "reservation",
        animated: false,
      });
    }
    for (const waiter of res.waiters) {
      const waiterNodeId = nodeByAgentId.get(waiter);
      if (waiterNodeId) {
        edges.push({
          id: `edge-wait-${res.id}-${waiter}`,
          source: waiterNodeId,
          target: res.id,
          type: "waiting",
          animated: true,
        });
      }
    }
  }

  for (const conflict of conflicts) {
    const firstAgent = conflict.involvedAgents[0];
    if (!firstAgent) continue;
    const srcNodeId = nodeByAgentId.get(firstAgent);
    if (!srcNodeId) continue;

    for (let i = 1; i < conflict.involvedAgents.length; i++) {
      const otherAgent = conflict.involvedAgents[i];
      if (!otherAgent) continue;
      const tgtNodeId = nodeByAgentId.get(otherAgent);
      if (tgtNodeId) {
        edges.push({
          id: `edge-dep-${conflict.id}-${i}`,
          source: srcNodeId,
          target: tgtNodeId,
          type: "dependency",
          animated: true,
          data: { conflictId: conflict.id, severity: conflict.severity },
        });
      }
    }
  }

  return edges;
}

async function buildCollabGraphData(
  projectId?: string,
): Promise<CollabGraphData> {
  const reservations = await gatherReservations(projectId);
  const conflicts = await gatherConflicts(reservations, projectId);
  const agents = await gatherAgents(reservations, conflicts);
  const recentMessages = gatherMessages(agents, reservations, 20);
  const edges = buildEdges(agents, reservations, conflicts, recentMessages);

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const messagesLast5m = recentMessages.filter(
    (m) => new Date(m.timestamp).getTime() >= fiveMinAgo,
  ).length;

  const stats: GraphStats = {
    totalAgents: agents.length,
    activeAgents: agents.filter((a) => a.status === "active").length,
    blockedAgents: agents.filter((a) => a.status === "blocked").length,
    totalReservations: reservations.length,
    activeConflicts: conflicts.length,
    messagesLast5m,
  };

  return {
    agents,
    reservations,
    conflicts,
    recentMessages,
    edges,
    stats,
    lastUpdated: new Date().toISOString(),
  };
}

function handleError(error: unknown, c: Context) {
  const log = getLogger();
  if (error instanceof z.ZodError) {
    return sendValidationError(c, transformZodError(error));
  }
  log.error({ error }, "Unexpected error in collaboration route");
  return sendInternalError(c);
}

/**
 * GET /collaboration/graph - Full collaboration graph state
 */
collaboration.get("/graph", async (c) => {
  try {
    const projectId = c.req.query("projectId");
    const graphData = await buildCollabGraphData(projectId);
    return sendResource(c, "collaboration_graph", graphData);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /collaboration/graph/stats - Graph summary statistics
 */
collaboration.get("/graph/stats", async (c) => {
  try {
    const projectId = c.req.query("projectId");
    const graphData = await buildCollabGraphData(projectId);
    return sendResource(c, "collaboration_graph_stats", graphData.stats);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /collaboration/agents - Agent nodes in collaboration graph
 */
collaboration.get("/agents", async (c) => {
  try {
    const projectId = c.req.query("projectId");
    const graphData = await buildCollabGraphData(projectId);
    return sendResource(c, "collaboration_agents", graphData.agents);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /collaboration/reservations - Active file/directory reservation nodes
 */
collaboration.get("/reservations", async (c) => {
  try {
    const projectId = c.req.query("projectId");
    const reservations = await gatherReservations(projectId);
    return sendResource(c, "collaboration_reservations", reservations);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /collaboration/conflicts - Active conflict nodes
 */
collaboration.get("/conflicts", async (c) => {
  try {
    const projectId = c.req.query("projectId");
    const reservations = await gatherReservations(projectId);
    const conflicts = await gatherConflicts(reservations, projectId);
    return sendResource(c, "collaboration_conflicts", conflicts);
  } catch (error) {
    return handleError(error, c);
  }
});

/**
 * GET /collaboration/messages - Recent coordination messages
 */
collaboration.get("/messages", async (c) => {
  try {
    const parsed = MessagesQuerySchema.safeParse({
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      return sendValidationError(c, transformZodError(parsed.error));
    }
    const projectId = c.req.query("projectId");
    const reservations = await gatherReservations(projectId);
    const conflicts = await gatherConflicts(reservations, projectId);
    const agents = await gatherAgents(reservations, conflicts);
    const messages = gatherMessages(agents, reservations, parsed.data.limit);
    return sendResource(c, "collaboration_messages", messages);
  } catch (error) {
    return handleError(error, c);
  }
});

let bridgeRunning = false;

/**
 * GET /collaboration/bridge/status - Get Collaboration Graph Bridge status
 */
collaboration.get("/bridge/status", (c) => {
  const bridge = getGraphBridgeService({
    controlPlaneUrl:
      process.env["CONTROL_PLANE_URL"] ?? "http://localhost:8787",
    apiKey: process.env["CONTROL_PLANE_API_KEY"] ?? "local-dev-key",
    defaultWorkspaceId: "default",
    useSSE: false,
  });
  return sendResource(c, "collaboration_bridge_status", {
    initialized: Boolean(bridge),
    running: bridgeRunning,
    defaultWorkspaceId: "default",
    checkedAt: new Date().toISOString(),
  });
});

/**
 * POST /collaboration/bridge/control - Start or stop the Collaboration Graph Bridge
 */
collaboration.post("/bridge/control", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const action = body.action === "start" ? "start" : "stop";
    const bridge = getGraphBridgeService({
      controlPlaneUrl:
        process.env["CONTROL_PLANE_URL"] ?? "http://localhost:8787",
      apiKey: process.env["CONTROL_PLANE_API_KEY"] ?? "local-dev-key",
      defaultWorkspaceId: "default",
      useSSE: false,
    });

    if (action === "start" && !bridgeRunning) {
      const graphEvents = getGraphEventsService(getHub());
      await bridge.start(graphEvents);
      // Immediately stop background polling if no external control_plane URL is configured
      if (!process.env["CONTROL_PLANE_URL"]) {
        bridge.stop();
        bridgeRunning = false;
      } else {
        bridgeRunning = true;
      }
    } else if (action === "stop") {
      bridge.stop();
      bridgeRunning = false;
    }

    return sendResource(c, "collaboration_bridge_status", {
      action,
      running: bridgeRunning,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, c);
  }
});

export { collaboration };
