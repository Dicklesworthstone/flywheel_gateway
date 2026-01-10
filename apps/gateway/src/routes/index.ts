/**
 * Routes Index - Aggregates all route handlers.
 */

import { Hono } from "hono";
import { agents } from "./agents";
import { health } from "./health";

const routes = new Hono();

// Mount route groups
routes.route("/agents", agents);
routes.route("/health", health);

export { routes };
