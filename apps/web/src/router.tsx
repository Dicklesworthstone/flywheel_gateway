import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { Shell } from "./components/layout/Shell";
import { AgentsPage } from "./pages/Agents";
import { BeadsPage } from "./pages/Beads";
import { CollaborationGraphPage } from "./pages/CollaborationGraph";
import { DashboardPage } from "./pages/Dashboard";
import { DCGPage } from "./pages/DCG";
import { FleetPage } from "./pages/Fleet";
import { NotFoundPage } from "./pages/NotFound";
import { SettingsPage } from "./pages/Settings";
import { VelocityPage } from "./pages/Velocity";

const rootRoute = createRootRoute({
  component: Shell,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsPage,
});

const beadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/beads",
  component: BeadsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const dcgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dcg",
  component: DCGPage,
});

const fleetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fleet",
  component: FleetPage,
});

const velocityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/velocity",
  component: VelocityPage,
});

const collaborationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collaboration",
  component: CollaborationGraphPage,
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: NotFoundPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  agentsRoute,
  beadsRoute,
  dcgRoute,
  fleetRoute,
  velocityRoute,
  collaborationRoute,
  settingsRoute,
  notFoundRoute,
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
