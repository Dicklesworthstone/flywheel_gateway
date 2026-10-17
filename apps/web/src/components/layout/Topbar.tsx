import { useRouterState } from "@tanstack/react-router";
import {
  MoonStar,
  RefreshCw,
  Sun,
  ToggleLeft,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useWebSocket, useWebSocketState } from "../../lib/websocket-context";
import { useUiStore } from "../../stores/ui";
import { StatusPill } from "../ui/StatusPill";

/**
 * WebSocket connection status indicator.
 * Shows connection state with visual feedback and manual reconnect option.
 */
function ConnectionStatusIndicator() {
  const { connected, state, connectionHint } = useWebSocketState();
  const { reconnect } = useWebSocket();

  const tone = (() => {
    switch (state) {
      case "connected":
        return "positive" as const;
      case "connecting":
      case "reconnecting":
        return "warning" as const;
      case "failed":
        return "critical" as const;
      default:
        return "muted" as const;
    }
  })();

  const icon = (() => {
    switch (state) {
      case "connected":
        return <Wifi size={14} />;
      case "connecting":
      case "reconnecting":
        return <RefreshCw size={14} className="animate-spin" />;
      default:
        return <WifiOff size={14} />;
    }
  })();

  const canReconnect = state === "failed" || state === "disconnected";
  const statusPill = (
    <StatusPill tone={tone} title={connectionHint}>
      {icon}
      <span className="hidden sm:inline">
        {connected ? "Live" : connectionHint}
      </span>
    </StatusPill>
  );

  // Wrap in button when clickable for manual reconnect
  if (canReconnect) {
    return (
      <button
        type="button"
        onClick={reconnect}
        className="appearance-none bg-transparent border-none p-0 cursor-pointer hover:opacity-80 transition-opacity"
        title="Click to reconnect"
      >
        {statusPill}
      </button>
    );
  }

  return statusPill;
}

/**
 * Hamburger menu button for mobile.
 */
function HamburgerButton() {
  const { drawerOpen, toggleDrawer } = useUiStore();

  return (
    <button
      type="button"
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
        <ConnectionStatusIndicator />
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
