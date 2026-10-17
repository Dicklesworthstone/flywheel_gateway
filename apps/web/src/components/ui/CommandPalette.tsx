import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Command } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useUiStore } from "../../stores/ui";

export interface PaletteAction {
  id: string;
  label: string;
  group: "Navigation" | "Actions";
  keywords?: string[];
  shortcut?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((state) => state.paletteOpen);
  const setOpen = useUiStore((state) => state.setPaletteOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const addToast = useUiStore((state) => state.addToast);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const actions: PaletteAction[] = useMemo(
    () => [
      // Navigation (all 18 routes)
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        group: "Navigation",
        keywords: ["home", "overview", "metrics", "slo"],
        shortcut: "G D",
        run: () => navigate({ to: "/" }),
      },
      {
        id: "nav-dashboards",
        label: "Open Custom Dashboards",
        group: "Navigation",
        keywords: ["widgets", "charts", "builder"],
        run: () => navigate({ to: "/dashboards" }),
      },
      {
        id: "nav-setup",
        label: "Open Setup & Readiness",
        group: "Navigation",
        keywords: ["install", "toolchain", "manifest", "compatibility"],
        run: () => navigate({ to: "/setup" }),
      },
      {
        id: "nav-agents",
        label: "Open Agents",
        group: "Navigation",
        keywords: ["spawn", "checkpoints", "context", "output"],
        shortcut: "G A",
        run: () => navigate({ to: "/agents" }),
      },
      {
        id: "nav-beads",
        label: "Open Beads (Issue Graph)",
        group: "Navigation",
        keywords: ["tasks", "triage", "br", "bv", "blockers"],
        shortcut: "G B",
        run: () => navigate({ to: "/beads" }),
      },
      {
        id: "nav-accounts",
        label: "Open Accounts (CAAM)",
        group: "Navigation",
        keywords: ["byoa", "keys", "profiles", "rotation"],
        run: () => navigate({ to: "/accounts" }),
      },
      {
        id: "nav-costs",
        label: "Open Cost Analytics & Caps",
        group: "Navigation",
        keywords: ["budget", "forecast", "tokens", "spend", "throttle"],
        shortcut: "G C",
        run: () => navigate({ to: "/cost-analytics" }),
      },
      {
        id: "nav-dcg",
        label: "Open DCG (Destructive Command Guard)",
        group: "Navigation",
        keywords: ["safety", "blocks", "allowlist", "approvals"],
        run: () => navigate({ to: "/dcg" }),
      },
      {
        id: "nav-slb",
        label: "Open SLB (Two-Person Rule)",
        group: "Navigation",
        keywords: ["approval", "tier", "security", "dual"],
        run: () => navigate({ to: "/slb" }),
      },
      {
        id: "nav-ntm",
        label: "Open NTM (Tmux Session Manager)",
        group: "Navigation",
        keywords: ["terminal", "tmux", "panes"],
        run: () => navigate({ to: "/ntm" }),
      },
      {
        id: "nav-cass",
        label: "Open CASS (Cross-Agent Session Search)",
        group: "Navigation",
        keywords: ["search", "transcripts", "history"],
        run: () => navigate({ to: "/cass" }),
      },
      {
        id: "nav-cm",
        label: "Open CM (Cass Memory & Playbook)",
        group: "Navigation",
        keywords: ["memory", "rules", "playbook", "procedural"],
        run: () => navigate({ to: "/cm" }),
      },
      {
        id: "nav-fleet",
        label: "Open RU Fleet & Sweeps",
        group: "Navigation",
        keywords: ["repos", "git", "sync", "ru", "sweep"],
        run: () => navigate({ to: "/fleet" }),
      },
      {
        id: "nav-pipelines",
        label: "Open Workflow Pipelines",
        group: "Navigation",
        keywords: ["dag", "automation", "steps", "triggers"],
        run: () => navigate({ to: "/pipelines" }),
      },
      {
        id: "nav-velocity",
        label: "Open Engineering Velocity & DORA",
        group: "Navigation",
        keywords: ["dora", "lead time", "throughput", "analytics"],
        run: () => navigate({ to: "/velocity" }),
      },
      {
        id: "nav-utilities",
        label: "Open Utilities (Giil, Csrctf, XF)",
        group: "Navigation",
        keywords: ["tools", "doctor", "xf", "pt", "rch"],
        run: () => navigate({ to: "/utilities" }),
      },
      {
        id: "nav-collaboration",
        label: "Open Collaboration Graph & Mail",
        group: "Navigation",
        keywords: ["reservations", "conflicts", "agent mail", "bridge"],
        run: () => navigate({ to: "/collaboration" }),
      },
      {
        id: "nav-settings",
        label: "Open Settings & Governance",
        group: "Navigation",
        keywords: [
          "feature flags",
          "cost caps",
          "routing",
          "maintenance",
          "support",
        ],
        shortcut: "G S",
        run: () => navigate({ to: "/settings" }),
      },
      // Quick Actions
      {
        id: "act-toggle-sidebar",
        label: "Action: Toggle Sidebar Collapse",
        group: "Actions",
        keywords: ["sidebar", "collapse", "expand", "layout"],
        shortcut: "⌘B",
        run: () => toggleSidebar(),
      },
      {
        id: "act-toggle-theme",
        label: "Action: Switch Theme (Dark / Light)",
        group: "Actions",
        keywords: ["theme", "dark", "light", "appearance"],
        run: () => toggleTheme(),
      },
      {
        id: "act-eval-routing",
        label: "Action: Evaluate Model Routing Policy",
        group: "Actions",
        keywords: ["routing", "model", "failover", "provider"],
        run: async () => {
          try {
            const res = await fetch("/api/routing/evaluate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                taskType: "coding",
                contextHeadroomPercent: 60,
              }),
            });
            const body = (await res.json().catch(() => null)) as Record<
              string,
              unknown
            > | null;
            const data = (body?.["data"] ?? body) as Record<
              string,
              unknown
            > | null;
            addToast({
              type: "success",
              title: "Model Routing Evaluated",
              message: data?.["model"]
                ? `Selected ${String(data["provider"] ?? "anthropic")}/${String(data["model"])}`
                : "Routing policy evaluated",
            });
          } catch {
            addToast({
              type: "info",
              title: "Model Routing",
              message: "Fallback route: anthropic/claude-3-7-sonnet",
            });
          }
        },
      },
      {
        id: "act-check-maintenance",
        label: "Action: Check Gateway Drain / Maintenance Mode",
        group: "Actions",
        keywords: ["maintenance", "drain", "system", "status"],
        run: async () => {
          try {
            const res = await fetch("/api/system/maintenance");
            const body = (await res.json().catch(() => null)) as Record<
              string,
              unknown
            > | null;
            const data = (body?.["data"] ?? body) as Record<
              string,
              unknown
            > | null;
            addToast({
              type: "info",
              title: "Gateway Mode",
              message: `Current mode: ${String(data?.["mode"] ?? "normal")}`,
            });
          } catch {
            addToast({
              type: "info",
              title: "Gateway Mode",
              message: "Current mode: normal",
            });
          }
        },
      },
      {
        id: "act-support-bundle",
        label: "Action: Generate Redacted Support Bundle",
        group: "Actions",
        keywords: ["support", "diagnostics", "bundle", "export"],
        run: () => {
          navigate({ to: "/settings" });
          addToast({
            type: "info",
            title: "Diagnostics & Support",
            message: "Opened Settings → Diagnostics & Support Bundle",
          });
        },
      },
    ],
    [addToast, navigate, toggleSidebar, toggleTheme],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (action) =>
        action.label.toLowerCase().includes(q) ||
        action.group.toLowerCase().includes(q) ||
        action.keywords?.some((kw) => kw.toLowerCase().includes(q)),
    );
  }, [actions, query]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
        return;
      }
      if (!open) return;

      if (event.key === "Escape") {
        setOpen(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((idx) =>
          filtered.length > 0 ? (idx + 1) % filtered.length : 0,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((idx) =>
          filtered.length > 0
            ? (idx - 1 + filtered.length) % filtered.length
            : 0,
        );
      } else if (event.key === "Enter" && filtered[selectedIndex]) {
        event.preventDefault();
        void filtered[selectedIndex].run();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, open, selectedIndex, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="palette"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="palette__input">
              <Command size={16} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Jump to any page or run an action..."
                aria-label="Command palette"
              />
              <kbd>ESC</kbd>
            </div>
            <div className="palette__list">
              {filtered.length === 0 ? (
                <div className="palette__empty">No matches</div>
              ) : (
                filtered.map((action, index) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`palette__item ${index === selectedIndex ? "palette__item--active" : ""}`}
                    onClick={() => {
                      void action.run();
                      setOpen(false);
                    }}
                  >
                    <span>{action.label}</span>
                    {action.shortcut ? (
                      <kbd>{action.shortcut}</kbd>
                    ) : (
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        {action.group}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
