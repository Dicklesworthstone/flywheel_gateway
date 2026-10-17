import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Tooltip } from "../Tooltip";

try {
  GlobalRegistrator.register();
} catch {
  // Already registered by another test file
}

type ScheduledTimeout = {
  handle: ReturnType<typeof setTimeout>;
  delay: number | undefined;
};

describe("Tooltip", () => {
  const scheduled: ScheduledTimeout[] = [];
  const cleared: unknown[] = [];
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;

  beforeEach(() => {
    scheduled.length = 0;
    cleared.length = 0;

    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;

    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handle = originalSetTimeout(...args);
      scheduled.push({
        handle,
        delay: typeof args[1] === "number" ? args[1] : undefined,
      });
      return handle;
    }) as typeof setTimeout;

    globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
      cleared.push(args[0]);
      return originalClearTimeout(...args);
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  it("clears pending show timeout on unmount", () => {
    const delay = 1234;
    const { getByRole, unmount } = render(
      <Tooltip content="tip" delay={delay}>
        <button type="button">Hover</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(getByRole("button", { name: "Hover" }));

    const scheduledShow = scheduled.filter((t) => t.delay === delay).at(-1);

    expect(scheduledShow).toBeDefined();

    unmount();

    expect(cleared).toContain(scheduledShow!.handle);
  });
});

describe("Wave 7 UI Upgrades: DashboardPage, SettingsPage, AgentsPage (bd-7ojci.7–bd-7ojci.10)", () => {
  it("renders DashboardPage with SLO Error Budget, Safety Approvals Queue, and Gateway Mode & Runbooks panels", async () => {
    const { QueryClient, QueryClientProvider } = await import(
      "@tanstack/react-query"
    );
    const { DashboardPage } = await import("../../../pages/Dashboard");
    const { useUiStore } = await import("../../../stores/ui");
    useUiStore.setState({ mockMode: true });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { getByText, unmount } = render(
      <QueryClientProvider client={qc}>
        <DashboardPage />
      </QueryClientProvider>,
    );

    expect(getByText("SLO Error Budget")).toBeInTheDocument();
    expect(getByText("Safety Approvals Queue")).toBeInTheDocument();
    expect(getByText("Gateway Mode & Runbooks")).toBeInTheDocument();
    unmount();
  });

  it("renders SettingsPage with Feature Flags & Kill Switches and Maintenance, Routing & Support Bundle panels", async () => {
    const { QueryClient, QueryClientProvider } = await import(
      "@tanstack/react-query"
    );
    const { SettingsPage } = await import("../../../pages/Settings");
    const { useUiStore } = await import("../../../stores/ui");
    useUiStore.setState({ mockMode: true });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { getByText, unmount } = render(
      <QueryClientProvider client={qc}>
        <SettingsPage />
      </QueryClientProvider>,
    );

    expect(getByText("Feature Flags & Kill Switches")).toBeInTheDocument();
    expect(
      getByText("Maintenance, Routing & Support Bundle"),
    ).toBeInTheDocument();
    expect(getByText("Export Support Bundle")).toBeInTheDocument();
    unmount();
  });

  it("renders AgentsPage with Session Lifecycle & Compaction and Pending Safety Approvals panels", async () => {
    const { QueryClient, QueryClientProvider } = await import(
      "@tanstack/react-query"
    );
    const { AgentsPage } = await import("../../../pages/Agents");
    const { useUiStore } = await import("../../../stores/ui");
    useUiStore.setState({ mockMode: true });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { getByText, unmount } = render(
      <QueryClientProvider client={qc}>
        <AgentsPage />
      </QueryClientProvider>,
    );

    expect(getByText("Session Lifecycle & Compaction")).toBeInTheDocument();
    expect(getByText("Compact Checkpoints")).toBeInTheDocument();
    expect(getByText("Rotate Context Window")).toBeInTheDocument();
    expect(getByText("Pending Safety Approvals")).toBeInTheDocument();
    unmount();
  });
});
