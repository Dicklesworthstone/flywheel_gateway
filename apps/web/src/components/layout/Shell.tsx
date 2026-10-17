import { Outlet } from "@tanstack/react-router";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useUiStore } from "../../stores/ui";
import { BottomTabBar } from "../ui/BottomTabBar";
import { CommandPalette } from "../ui/CommandPalette";
import { Drawer } from "../ui/Drawer";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { Toaster } from "../ui/Toaster";
import { MobileNavContent, Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function Shell() {
  const { drawerOpen, setDrawerOpen, sidebarCollapsed } = useUiStore();

  // Initialize global keyboard shortcuts
  useKeyboardShortcuts();

  return (
    <div className="app-shell">
      {/* Desktop Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} />

      <div className="app-main">
        <Topbar />
        <main className="app-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile Drawer Navigation */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Navigation"
      >
        <MobileNavContent onNavigate={() => setDrawerOpen(false)} />
      </Drawer>

      {/* Mobile Bottom Tab Bar */}
      <BottomTabBar />

      {/* Overlays */}
      <CommandPalette />
      <Toaster />
    </div>
  );
}
