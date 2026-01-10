import { StatusPill } from "../components/ui/StatusPill";
import { useUiStore } from "../stores/ui";

export function SettingsPage() {
  const theme = useUiStore((state) => state.theme);
  const mockMode = useUiStore((state) => state.mockMode);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const toggleMockMode = useUiStore((state) => state.toggleMockMode);

  return (
    <div className="page">
      <div className="grid grid--2">
        <div className="card">
          <div className="card__header">
            <h3>Theme</h3>
            <StatusPill tone="muted">{theme}</StatusPill>
          </div>
          <p className="muted">Switch between dawn and dusk palettes.</p>
          <button
            className="primary-button"
            type="button"
            onClick={toggleTheme}
          >
            Toggle theme
          </button>
        </div>
        <div className="card">
          <div className="card__header">
            <h3>Mock data mode</h3>
            <StatusPill tone={mockMode ? "positive" : "muted"}>
              {mockMode ? "enabled" : "disabled"}
            </StatusPill>
          </div>
          <p className="muted">
            Keep the UI interactive when the backend is offline.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={toggleMockMode}
          >
            Toggle mock mode
          </button>
        </div>
      </div>
      <div className="card card--wide">
        <h3>Workspace signals</h3>
        <p className="muted">
          This shell is wired for future providers (WebSocket, audit, and
          router). Replace mock signals with live telemetry as endpoints come
          online.
        </p>
      </div>
    </div>
  );
}
