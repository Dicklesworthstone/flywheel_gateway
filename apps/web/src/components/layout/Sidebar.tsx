import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  CircleDot,
  Command,
  Gauge,
  Settings,
  Sparkles,
} from "lucide-react";

import { mockAgents, mockBeads } from "../../lib/mock-data";

const navItems = [
  { label: "Dashboard", icon: Gauge, to: "/" },
  { label: "Agents", icon: Bot, to: "/agents", badge: mockAgents.length },
  { label: "Beads", icon: CircleDot, to: "/beads", badge: mockBeads.length },
  { label: "Settings", icon: Settings, to: "/settings" },
];

export function Sidebar() {
  const { location } = useRouterState();

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand-mark">
          <Sparkles size={20} />
        </div>
        <div>
          <div className="brand-title">Flywheel</div>
          <div className="brand-subtitle">Gateway</div>
        </div>
      </div>
      <nav className="sidebar__nav">
        {navItems.map((item) => {
          const active = location.pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              className={active ? "nav-link nav-link--active" : "nav-link"}
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.badge !== undefined ? (
                <span className="nav-badge">{item.badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar__footer">
        <div className="sidebar__hint">
          <Command size={16} />
          <span>Command palette</span>
          <kbd>Cmd K</kbd>
        </div>
      </div>
    </aside>
  );
}
