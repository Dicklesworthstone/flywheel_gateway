import { Outlet } from "@tanstack/react-router";
import { CommandPalette } from "../ui/CommandPalette";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { Toaster } from "../ui/Toaster";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function Shell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <main className="app-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
