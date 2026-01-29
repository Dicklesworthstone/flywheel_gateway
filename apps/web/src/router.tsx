/**
 * Application Router with lazy-loaded routes.
 *
 * Uses React.lazy for code splitting and TanStack Router's pendingComponent
 * for skeleton loading states during route transitions.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { Shell } from "./components/layout/Shell";
import {
  AccountsSkeleton,
  AgentsSkeleton,
  BeadsSkeleton,
  CollaborationGraphSkeleton,
  CostAnalyticsSkeleton,
  DashboardSkeleton,
  DashboardsSkeleton,
  DCGSkeleton,
  FleetSkeleton,
  PipelinesSkeleton,
  SettingsSkeleton,
  SetupSkeleton,
  UtilitiesSkeleton,
  VelocitySkeleton,
  NTMSkeleton,
  CASSSkeleton,
  SLBSkeleton,
  CMSkeleton,
} from "./components/skeletons";

// ============================================================================
// Lazy-loaded Page Components
// ============================================================================

const DashboardPage = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })),
);
const AgentsPage = lazy(() =>
  import("./pages/Agents").then((m) => ({ default: m.AgentsPage })),
);
const BeadsPage = lazy(() =>
  import("./pages/Beads").then((m) => ({ default: m.BeadsPage })),
);
const AccountsPage = lazy(() =>
  import("./pages/Accounts").then((m) => ({ default: m.AccountsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/Settings").then((m) => ({ default: m.SettingsPage })),
);
const DashboardsPage = lazy(() =>
  import("./pages/Dashboards").then((m) => ({ default: m.DashboardsPage })),
);
const DCGPage = lazy(() =>
  import("./pages/DCG").then((m) => ({ default: m.DCGPage })),
);
const FleetPage = lazy(() =>
  import("./pages/Fleet").then((m) => ({ default: m.FleetPage })),
);
const PipelinesPage = lazy(() =>
  import("./pages/Pipelines").then((m) => ({ default: m.PipelinesPage })),
);
const VelocityPage = lazy(() =>
  import("./pages/Velocity").then((m) => ({ default: m.VelocityPage })),
);
const CollaborationGraphPage = lazy(() =>
  import("./pages/CollaborationGraph").then((m) => ({
    default: m.CollaborationGraphPage,
  })),
);
const CostAnalyticsPage = lazy(() =>
  import("./pages/CostAnalytics").then((m) => ({
    default: m.CostAnalyticsPage,
  })),
);
const SetupPage = lazy(() =>
  import("./pages/Setup").then((m) => ({ default: m.SetupPage })),
);
const UtilitiesPage = lazy(() =>
  import("./pages/Utilities").then((m) => ({ default: m.UtilitiesPage })),
);
const NTMPage = lazy(() =>
  import("./pages/NTM").then((m) => ({ default: m.NTMPage })),
);
const CASSPage = lazy(() =>
  import("./pages/CASS").then((m) => ({ default: m.CASSPage })),
);
const SLBPage = lazy(() =>
  import("./pages/SLB").then((m) => ({ default: m.SLBPage })),
);
const CMPage = lazy(() =>
  import("./pages/CM").then((m) => ({ default: m.CMPage })),
);

// NotFoundPage stays static (small, always needed)
import { NotFoundPage } from "./pages/NotFound";

// ============================================================================
// Route Definitions
// ============================================================================

const rootRoute = createRootRoute({
  component: Shell,
});

// Helper to wrap lazy component with Suspense
// Returns RouteComponent-compatible function for TanStack Router
function withSuspense<P extends object>(
  LazyComponent: React.LazyExoticComponent<React.ComponentType<P>>,
  Fallback: React.ComponentType,
) {
  return function SuspenseWrapper(props: P) {
    return (
      <Suspense fallback={<Fallback />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: withSuspense(DashboardPage, DashboardSkeleton),
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: withSuspense(AgentsPage, AgentsSkeleton),
});

const beadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/beads",
  component: withSuspense(BeadsPage, BeadsSkeleton),
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: withSuspense(AccountsPage, AccountsSkeleton),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: withSuspense(SettingsPage, SettingsSkeleton),
});

const dashboardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboards",
  component: withSuspense(DashboardsPage, DashboardsSkeleton),
});

const dashboardViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboards/$dashboardId",
  component: withSuspense(DashboardsPage, DashboardsSkeleton),
});

const dcgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dcg",
  component: withSuspense(DCGPage, DCGSkeleton),
});

const fleetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fleet",
  component: withSuspense(FleetPage, FleetSkeleton),
});

const pipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pipelines",
  component: withSuspense(PipelinesPage, PipelinesSkeleton),
});

const velocityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/velocity",
  component: withSuspense(VelocityPage, VelocitySkeleton),
});

const collaborationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collaboration",
  component: withSuspense(CollaborationGraphPage, CollaborationGraphSkeleton),
});

const costAnalyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cost-analytics",
  component: withSuspense(CostAnalyticsPage, CostAnalyticsSkeleton),
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: withSuspense(SetupPage, SetupSkeleton),
});

const utilitiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/utilities",
  component: withSuspense(UtilitiesPage, UtilitiesSkeleton),
});

const ntmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ntm",
  component: withSuspense(NTMPage, NTMSkeleton),
});

const cassRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cass",
  component: withSuspense(CASSPage, CASSSkeleton),
});

const slbRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/slb",
  component: withSuspense(SLBPage, SLBSkeleton),
});

const cmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cm",
  component: withSuspense(CMPage, CMSkeleton),
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: NotFoundPage,
});

// ============================================================================
// Route Tree & Router
// ============================================================================

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  agentsRoute,
  beadsRoute,
  accountsRoute,
  costAnalyticsRoute,
  dashboardsRoute,
  dashboardViewRoute,
  dcgRoute,
  fleetRoute,
  pipelinesRoute,
  setupRoute,
  utilitiesRoute,
  velocityRoute,
  collaborationRoute,
  ntmRoute,
  cassRoute,
  slbRoute,
  cmRoute,
  settingsRoute,
  notFoundRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent", // Preload on hover/focus
  defaultPreloadStaleTime: 0,
});

// ============================================================================
// Router Type Registration
// ============================================================================

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ============================================================================
// Development Logging
// ============================================================================

if (import.meta.env["DEV"]) {
  // Log route loading timing in development
  const _originalLazy = lazy;
  (globalThis as unknown as { __lazyImportCount?: number }).__lazyImportCount =
    0;

  console.debug("[Router] Lazy loading enabled with Suspense boundaries");
}
