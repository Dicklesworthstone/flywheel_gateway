/**
 * Bottom Tab Bar component.
 *
 * Fixed bottom navigation for mobile devices.
 */

import { Link, useLocation } from "@tanstack/react-router";
import { Bot, Database, Home, Settings } from "lucide-react";
import type { ReactNode } from "react";

interface TabItem {
  path: string;
  label: string;
  icon: ReactNode;
}

const DEFAULT_TABS: TabItem[] = [
  { path: "/", label: "Dashboard", icon: <Home size={20} /> },
  { path: "/agents", label: "Agents", icon: <Bot size={20} /> },
  { path: "/beads", label: "Beads", icon: <Database size={20} /> },
  { path: "/settings", label: "Settings", icon: <Settings size={20} /> },
];

interface BottomTabBarProps {
  /** Custom tab items (defaults to main navigation) */
  tabs?: TabItem[];
  /** Additional CSS class */
  className?: string;
}

/**
 * Bottom Tab Bar for mobile navigation.
 */
export function BottomTabBar({
  tabs = DEFAULT_TABS,
  className = "",
}: BottomTabBarProps) {
  const location = useLocation();

  return (
    <nav className={`bottom-tab-bar ${className}`} aria-label="Main navigation">
      <div className="bottom-tab-bar__nav">
        {tabs.map((tab) => {
          const isActive =
            tab.path === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(tab.path);

          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`bottom-tab-bar__item ${
                isActive ? "bottom-tab-bar__item--active" : ""
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="bottom-tab-bar__icon">{tab.icon}</span>
              <span className="bottom-tab-bar__label">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Floating Action Button for mobile.
 */
interface FABProps {
  icon: ReactNode;
  onClick: () => void;
  label: string;
  className?: string;
}

export function FAB({ icon, onClick, label, className = "" }: FABProps) {
  return (
    <button className={`fab ${className}`} onClick={onClick} aria-label={label}>
      <span className="fab__icon">{icon}</span>
    </button>
  );
}
