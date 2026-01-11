import { useRouterState } from "@tanstack/react-router";
import { Menu, MoonStar, Sun, ToggleLeft } from "lucide-react";

import { useUiStore } from "../../stores/ui";
import { StatusPill } from "../ui/StatusPill";

/**
 * Hamburger menu button for mobile.
 */
function HamburgerButton() {
  const { drawerOpen, toggleDrawer } = useUiStore();

  return (
    <button
      className={`hamburger ${drawerOpen ? "hamburger--open" : ""}`}
      onClick={toggleDrawer}
      aria-label={drawerOpen ? "Close menu" : "Open menu"}
      aria-expanded={drawerOpen}
    >
      <span className="hamburger__line" />
      <span className="hamburger__line" />
      <span className="hamburger__line" />
    </button>
  );
}

export function Topbar() {
  const { location } = useRouterState();
  const theme = useUiStore((state) => state.theme);
  const mockMode = useUiStore((state) => state.mockMode);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const toggleMockMode = useUiStore((state) => state.toggleMockMode);

  const title =
    location.pathname === "/"
      ? "Dashboard"
      : location.pathname
          .replace("/", "")
          .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <header className="topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Mobile hamburger menu */}
        <HamburgerButton />
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="topbar__actions">
        <StatusPill tone={mockMode ? "positive" : "muted"}>
          <ToggleLeft size={16} />
          {mockMode ? "Mock mode on" : "Mock mode off"}
        </StatusPill>
        <button className="icon-button" type="button" onClick={toggleMockMode}>
          Toggle mock
        </button>
        <button className="icon-button" type="button" onClick={toggleTheme}>
          {theme === "dusk" ? <Sun size={16} /> : <MoonStar size={16} />}
          {theme === "dusk" ? "Light" : "Dusk"}
        </button>
      </div>
    </header>
  );
}
