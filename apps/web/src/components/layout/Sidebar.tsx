import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Command,
  DollarSign,
  Gauge,
  GitBranch,
  Key,
  LayoutGrid,
  Lock,
  Network,
  Search,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Wand2,
  Workflow,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { mockAgents, mockBeads } from "../../lib/mock-data";
import { useUiStore } from "../../stores/ui";
import { Tooltip } from "../ui/Tooltip";

export interface NavItem {
  label: string;
  icon: typeof Gauge;
  to: string;
  badge?: number | undefined;
}

function useLiveNavCounts() {
  const [counts, setCounts] = useState<{
    agents: number;
    beads: number;
    pendingApprovals: number;
  }>({
    agents: mockAgents.length,
    beads: mockBeads.length,
    pendingApprovals: 0,
  });

  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      try {
        const [agentsRes, beadsRes, approvalsRes] = await Promise.allSettled([
          fetch("/api/agents"),
          fetch("/api/beads"),
          fetch("/api/safety/approvals?status=pending"),
        ]);

        if (cancelled) return;

        setCounts((prev) => {
          const next = { ...prev };
          if (agentsRes.status === "fulfilled" && agentsRes.value.ok) {
            agentsRes.value
              .json()
              .then((body: Record<string, unknown>) => {
                if (cancelled) return;
                const data = (body["data"] ?? body) as Record<string, unknown>;
                const list = Array.isArray(data)
                  ? data
                  : Array.isArray(data["agents"])
                    ? data["agents"]
                    : null;
                if (list) {
                  setCounts((c) => ({ ...c, agents: list.length }));
                }
              })
              .catch(() => undefined);
          }
          if (beadsRes.status === "fulfilled" && beadsRes.value.ok) {
            beadsRes.value
              .json()
              .then((body: Record<string, unknown>) => {
                if (cancelled) return;
                const data = (body["data"] ?? body) as Record<string, unknown>;
                const list = Array.isArray(data)
                  ? data
                  : Array.isArray(data["beads"])
                    ? data["beads"]
                    : Array.isArray(data["issues"])
                      ? data["issues"]
                      : null;
                if (list) {
                  setCounts((c) => ({ ...c, beads: list.length }));
                }
              })
              .catch(() => undefined);
          }
          if (approvalsRes.status === "fulfilled" && approvalsRes.value.ok) {
            approvalsRes.value
              .json()
              .then((body: Record<string, unknown>) => {
                if (cancelled) return;
                const data = (body["data"] ?? body) as unknown;
                const list = Array.isArray(data) ? data : null;
                if (list) {
                  setCounts((c) => ({ ...c, pendingApprovals: list.length }));
                }
              })
              .catch(() => undefined);
          }
          return next;
        });
      } catch {
        // Keep fallback counts when offline
      }
    }

    fetchCounts();
    return () => {
      cancelled = true;
    };
  }, []);

  return counts;
}

function buildNavItems(counts: {
  agents: number;
  beads: number;
  pendingApprovals: number;
}): NavItem[] {
  return [
    { label: "Dashboard", icon: Gauge, to: "/" },
    { label: "Dashboards", icon: LayoutGrid, to: "/dashboards" },
    { label: "Setup", icon: Wand2, to: "/setup" },
    { label: "Agents", icon: Bot, to: "/agents", badge: counts.agents },
    { label: "Beads", icon: CircleDot, to: "/beads", badge: counts.beads },
    { label: "Accounts", icon: Key, to: "/accounts" },
    { label: "Costs", icon: DollarSign, to: "/cost-analytics" },
    {
      label: "DCG",
      icon: Shield,
      to: "/dcg",
      badge: counts.pendingApprovals > 0 ? counts.pendingApprovals : undefined,
    },
    { label: "SLB", icon: Lock, to: "/slb" },
    { label: "NTM", icon: Terminal, to: "/ntm" },
    { label: "CASS", icon: Search, to: "/cass" },
    { label: "CM", icon: BookOpen, to: "/cm" },
    { label: "Fleet", icon: GitBranch, to: "/fleet" },
    { label: "Pipelines", icon: Workflow, to: "/pipelines" },
    { label: "Velocity", icon: Activity, to: "/velocity" },
    { label: "Utilities", icon: Wrench, to: "/utilities" },
    { label: "Collab", icon: Network, to: "/collaboration" },
    { label: "Settings", icon: Settings, to: "/settings" },
  ];
}

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { location } = useRouterState();
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const counts = useLiveNavCounts();
  const navItems = useMemo(() => buildNavItems(counts), [counts]);

  return (
    <aside
      className={`sidebar sidebar--collapsible ${collapsed ? "sidebar--collapsed" : ""}`}
    >
      <div className="sidebar__brand">
        <div className="brand-mark">
          <Sparkles size={20} />
        </div>
        <div className="sidebar__brand-text">
          <div className="brand-title">Flywheel</div>
          <div className="brand-subtitle">Gateway</div>
        </div>
      </div>

      <nav className="sidebar__nav">
        {navItems.map((item) => {
          const active = location.pathname === item.to;
          const Icon = item.icon;

          const linkContent = (
            <Link
              key={item.label}
              to={item.to}
              className={active ? "nav-link nav-link--active" : "nav-link"}
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span className="nav-badge">{item.badge}</span>
              )}
            </Link>
          );

          // Show tooltip when collapsed
          if (collapsed) {
            return (
              <Tooltip key={item.label} content={item.label} position="right">
                {linkContent}
              </Tooltip>
            );
          }

          return linkContent;
        })}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <button
          type="button"
          className="sidebar__hint"
          onClick={() => setPaletteOpen(true)}
          aria-label="Open command palette"
        >
          <Command size={16} />
          <span>Command palette</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
    </aside>
  );
}

/**
 * Mobile navigation content for the drawer.
 */
interface MobileNavContentProps {
  onNavigate?: () => void;
}

export function MobileNavContent({ onNavigate }: MobileNavContentProps) {
  const { location } = useRouterState();
  const counts = useLiveNavCounts();
  const navItems = useMemo(() => buildNavItems(counts), [counts]);

  return (
    <nav className="sidebar__nav">
      {navItems.map((item) => {
        const active = location.pathname === item.to;
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            to={item.to}
            className={active ? "nav-link nav-link--active" : "nav-link"}
            onClick={onNavigate}
          >
            <Icon size={18} />
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span className="nav-badge">{item.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
