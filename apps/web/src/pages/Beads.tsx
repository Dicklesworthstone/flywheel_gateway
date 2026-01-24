import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { StatusPill } from "../components/ui/StatusPill";
import { mockBeads } from "../lib/mock-data";
import { useUiStore } from "../stores/ui";

const API_BASE = "/api";

type Bead = {
  id: string;
  title: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
};

const statusTone: Record<string, "positive" | "warning" | "danger" | "muted"> =
  {
    open: "muted",
    in_progress: "warning",
    blocked: "danger",
    closed: "positive",
  };

const statusOptions = ["open", "in_progress", "blocked", "closed"] as const;
// Common types for quick selection, but custom types are also supported
const defaultTypeOptions = ["task", "bug", "feature", "chore", "epic"] as const;

const tableGridTemplate =
  "minmax(120px, 1.1fr) 140px minmax(240px, 2fr) 120px 140px 200px";

async function fetchBeads(): Promise<Bead[]> {
  const res = await fetch(`${API_BASE}/beads`);
  if (!res.ok) {
    throw new Error(`Failed to fetch beads: ${res.statusText}`);
  }
  const json = await res.json();
  return json.data?.beads ?? [];
}

async function createBead(payload: Record<string, unknown>): Promise<Bead> {
  const res = await fetch(`${API_BASE}/beads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "Failed to create bead");
  }
  return json.data;
}

async function updateBead(
  id: string,
  payload: Record<string, unknown>,
): Promise<Bead> {
  const res = await fetch(`${API_BASE}/beads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "Failed to update bead");
  }
  return json.data;
}

async function claimBead(id: string): Promise<Bead> {
  const res = await fetch(`${API_BASE}/beads/${id}/claim`, {
    method: "POST",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "Failed to claim bead");
  }
  return json.data;
}

async function closeBead(id: string, reason?: string): Promise<Bead> {
  const res = await fetch(`${API_BASE}/beads/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || "Failed to close bead");
  }
  return json.data;
}

export function BeadsPage() {
  const mockMode = useUiStore((state) => state.mockMode);
  const [beads, setBeads] = useState<Bead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPriority, setCreatePriority] = useState("2");
  const [createType, setCreateType] = useState("task");
  const [createLoading, setCreateLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Bead | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] =
    useState<(typeof statusOptions)[number]>("open");
  const [editPriority, setEditPriority] = useState("");
  const [editType, setEditType] = useState("task");
  const [editLoading, setEditLoading] = useState(false);

  const [closeTarget, setCloseTarget] = useState<Bead | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeLoading, setCloseLoading] = useState(false);

  const totalCount = useMemo(() => beads.length, [beads.length]);

  // Compute available types: default options + any custom types found in beads
  const typeOptions = useMemo(() => {
    const customTypes = beads
      .map((b) => b.issue_type)
      .filter((t): t is string => !!t && !defaultTypeOptions.includes(t as typeof defaultTypeOptions[number]));
    const uniqueCustomTypes = [...new Set(customTypes)];
    return [...defaultTypeOptions, ...uniqueCustomTypes.sort()];
  }, [beads]);

  const loadBeads = useCallback(async () => {
    setError(null);
    if (mockMode) {
      setBeads(mockBeads);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchBeads();
      setBeads(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch beads");
    } finally {
      setLoading(false);
    }
  }, [mockMode]);

  useEffect(() => {
    loadBeads();
  }, [loadBeads]);

  const applyBeadUpdate = useCallback((updated: Bead) => {
    setBeads((prev) => {
      const found = prev.some((bead) => bead.id === updated.id);
      if (!found) return [updated, ...prev];
      return prev.map((bead) => (bead.id === updated.id ? updated : bead));
    });
  }, []);

  const handleCreate = useCallback(async () => {
    setActionError(null);
    setCreateLoading(true);
    try {
      const parsedPriority = Number.parseInt(createPriority, 10);
      const priorityValue = Number.isNaN(parsedPriority)
        ? undefined
        : parsedPriority;
      if (mockMode) {
        const newBead: Bead = {
          id: `mock-${Date.now()}`,
          title: createTitle.trim(),
          status: "open",
          issue_type: createType,
        };
        if (priorityValue !== undefined) newBead.priority = priorityValue;
        setBeads((prev) => [newBead, ...prev]);
      } else {
        const payload: Record<string, unknown> = {
          title: createTitle.trim(),
          type: createType,
        };
        if (createDescription.trim())
          payload["description"] = createDescription.trim();
        if (priorityValue !== undefined) payload["priority"] = priorityValue;
        const created = await createBead(payload);
        applyBeadUpdate(created);
      }
      setCreateOpen(false);
      setCreateTitle("");
      setCreateDescription("");
      setCreatePriority("2");
      setCreateType("task");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to create bead",
      );
    } finally {
      setCreateLoading(false);
    }
  }, [
    applyBeadUpdate,
    createDescription,
    createPriority,
    createTitle,
    createType,
    mockMode,
  ]);

  const openEdit = useCallback((bead: Bead) => {
    setEditTarget(bead);
    setEditTitle(bead.title);
    setEditStatus((bead.status as (typeof statusOptions)[number]) ?? "open");
    setEditPriority(bead.priority !== undefined ? String(bead.priority) : "");
    setEditType(bead.issue_type ?? "task");
    setEditOpen(true);
  }, []);

  const handleEdit = useCallback(async () => {
    if (!editTarget) return;
    setActionError(null);
    setEditLoading(true);
    try {
      const parsedPriority = Number.parseInt(editPriority, 10);
      const priorityValue = Number.isNaN(parsedPriority)
        ? undefined
        : parsedPriority;
      if (mockMode) {
        const updated: Bead = {
          id: editTarget.id,
          title: editTitle.trim(),
          issue_type: editType,
        };
        if (editStatus) updated.status = editStatus;
        if (priorityValue !== undefined) updated.priority = priorityValue;
        if (editTarget.assignee) updated.assignee = editTarget.assignee;
        applyBeadUpdate(updated);
      } else {
        const payload: Record<string, unknown> = {};
        if (editTitle.trim() !== editTarget.title)
          payload["title"] = editTitle.trim();
        if (editStatus !== editTarget.status) payload["status"] = editStatus;
        if (priorityValue !== undefined) payload["priority"] = priorityValue;
        if (editType !== editTarget.issue_type) payload["type"] = editType;
        if (Object.keys(payload).length === 0) {
          setEditOpen(false);
          return;
        }
        const updated = await updateBead(editTarget.id, payload);
        applyBeadUpdate(updated);
      }
      setEditOpen(false);
      setEditTarget(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to update bead",
      );
    } finally {
      setEditLoading(false);
    }
  }, [
    applyBeadUpdate,
    editPriority,
    editStatus,
    editTarget,
    editTitle,
    editType,
    mockMode,
  ]);

  const handleClaim = useCallback(
    async (bead: Bead) => {
      setActionError(null);
      try {
        if (mockMode) {
          applyBeadUpdate({ ...bead, status: "in_progress" });
          return;
        }
        const updated = await claimBead(bead.id);
        applyBeadUpdate(updated);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to claim bead",
        );
      }
    },
    [applyBeadUpdate, mockMode],
  );

  const handleClose = useCallback(async () => {
    if (!closeTarget) return;
    setActionError(null);
    setCloseLoading(true);
    try {
      if (mockMode) {
        applyBeadUpdate({ ...closeTarget, status: "closed" });
      } else {
        const updated = await closeBead(
          closeTarget.id,
          closeReason.trim() || undefined,
        );
        applyBeadUpdate(updated);
      }
      setCloseTarget(null);
      setCloseReason("");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to close bead",
      );
    } finally {
      setCloseLoading(false);
    }
  }, [applyBeadUpdate, closeReason, closeTarget, mockMode]);

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h3>Beads</h3>
            <p className="card__subtitle">
              {mockMode ? "Mock data mode" : "Live br data"} · {totalCount}{" "}
              tracked
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={loadBeads}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setCreateOpen(true)}
            >
              New Bead
            </button>
          </div>
        </div>

        {error && (
          <p style={{ color: "var(--color-danger)", marginTop: 8 }}>{error}</p>
        )}
        {actionError && (
          <p style={{ color: "var(--color-warning)", marginTop: 8 }}>
            {actionError}
          </p>
        )}

        <div className="table">
          <div
            className="table__row table__row--header"
            style={{ gridTemplateColumns: tableGridTemplate }}
          >
            <span>Bead</span>
            <span>Status</span>
            <span>Title</span>
            <span>Priority</span>
            <span>Type</span>
            <span>Actions</span>
          </div>
          {beads.map((bead) => (
            <div
              key={bead.id}
              className="table__row"
              style={{ gridTemplateColumns: tableGridTemplate }}
            >
              <span className="mono">{bead.id}</span>
              <StatusPill tone={statusTone[bead.status ?? ""] ?? "muted"}>
                {(bead.status ?? "unknown").replace("_", " ")}
              </StatusPill>
              <span>{bead.title}</span>
              <span>{bead.priority ?? "—"}</span>
              <span>{bead.issue_type ?? "—"}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => openEdit(bead)}
                >
                  Edit
                </button>
                {bead.status !== "in_progress" && bead.status !== "closed" && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => handleClaim(bead)}
                  >
                    Claim
                  </button>
                )}
                {bead.status !== "closed" && (
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => setCloseTarget(bead)}
                  >
                    Close
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Bead"
        footer={
          <>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleCreate}
              disabled={!createTitle.trim() || createLoading}
            >
              {createLoading ? "Creating..." : "Create"}
            </button>
          </>
        }
      >
        <div className="modal__field">
          <label htmlFor="bead-title">Title</label>
          <input
            id="bead-title"
            value={createTitle}
            onChange={(event) => setCreateTitle(event.target.value)}
            placeholder="Describe the task"
          />
        </div>
        <div className="modal__field">
          <label htmlFor="bead-description">Description</label>
          <textarea
            id="bead-description"
            style={{ minHeight: 80 }}
            value={createDescription}
            onChange={(event) => setCreateDescription(event.target.value)}
            placeholder="Optional details"
          />
        </div>
        <div className="modal__field">
          <label htmlFor="bead-priority">Priority</label>
          <input
            id="bead-priority"
            value={createPriority}
            onChange={(event) => setCreatePriority(event.target.value)}
            placeholder="0-4"
          />
        </div>
        <div className="modal__field">
          <label htmlFor="bead-type">Type</label>
          <select
            id="bead-type"
            value={createType}
            onChange={(event) => setCreateType(event.target.value)}
          >
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Bead"
        footer={
          <>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleEdit}
              disabled={!editTitle.trim() || editLoading}
            >
              {editLoading ? "Saving..." : "Save"}
            </button>
          </>
        }
      >
        <div className="modal__field">
          <label htmlFor="bead-edit-title">Title</label>
          <input
            id="bead-edit-title"
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
          />
        </div>
        <div className="modal__field">
          <label htmlFor="bead-edit-status">Status</label>
          <select
            id="bead-edit-status"
            value={editStatus}
            onChange={(event) =>
              setEditStatus(
                event.target.value as (typeof statusOptions)[number],
              )
            }
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="modal__field">
          <label htmlFor="bead-edit-priority">Priority</label>
          <input
            id="bead-edit-priority"
            value={editPriority}
            onChange={(event) => setEditPriority(event.target.value)}
          />
        </div>
        <div className="modal__field">
          <label htmlFor="bead-edit-type">Type</label>
          <select
            id="bead-edit-type"
            value={editType}
            onChange={(event) => setEditType(event.target.value)}
          >
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {/* Show current type if it's not in the list (custom type from another source) */}
            {editType && !typeOptions.includes(editType) && (
              <option value={editType}>{editType}</option>
            )}
          </select>
        </div>
      </Modal>

      <Modal
        open={closeTarget !== null}
        onClose={() => setCloseTarget(null)}
        title="Close Bead"
        footer={
          <>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setCloseTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={handleClose}
              disabled={closeLoading}
            >
              {closeLoading ? "Closing..." : "Close"}
            </button>
          </>
        }
      >
        <p>
          Close bead <span className="mono">{closeTarget?.id ?? ""}</span>?
        </p>
        <div className="modal__field">
          <label htmlFor="bead-close-reason">Reason (optional)</label>
          <input
            id="bead-close-reason"
            value={closeReason}
            onChange={(event) => setCloseReason(event.target.value)}
            placeholder="Completed, duplicate, etc."
          />
        </div>
      </Modal>
    </div>
  );
}
