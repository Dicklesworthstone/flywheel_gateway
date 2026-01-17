import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Command,
  DollarSign,
  Gauge,
  GitBranch,
  Key,
  Network,
  Settings,
  Shield,
  Sparkles,
  Wand2,
  Workflow,
} from "lucide-react";

import { mockAgents, mockBeads } from "../../lib/mock-data";
import { useUiStore } from "../../stores/ui";
import { Tooltip } from "../ui/Tooltip";

const navItems = [
  { label: "Dashboard", icon: Gauge, to: "/" },
  { label: "Setup", icon: Wand2, to: "/setup" },
  { label: "Agents", icon: Bot, to: "/agents", badge: mockAgents.length },
  { label: "Beads", icon: CircleDot, to: "/beads", badge: mockBeads.length },
  { label: "Accounts", icon: Key, to: "/accounts" },
  { label: "Costs", icon: DollarSign, to: "/cost-analytics" },
  { label: "DCG", icon: Shield, to: "/dcg" },
  { label: "Fleet", icon: GitBranch, to: "/fleet" },
  { label: "Pipelines", icon: Workflow, to: "/pipelines" },
  { label: "Velocity", icon: Activity, to: "/velocity" },
  { label: "Collab", icon: Network, to: "/collaboration" },
  { label: "Settings", icon: Settings, to: "/settings" },
];

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { location } = useRouterState();
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

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
        <div className="sidebar__hint">
          <Command size={16} />
          <span>Command palette</span>
          <kbd>⌘K</kbd>
        </div>
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
