/**
 * Routes Index - Aggregates all route handlers.
 */

import { Hono } from "hono";
import { accounts } from "./accounts";
import { agents } from "./agents";
import { alerts } from "./alerts";
import { context } from "./context";
import { dcg } from "./dcg";
import { health } from "./health";
import { history } from "./history";
import { metrics } from "./metrics";
import { utilities } from "./utilities";

const routes = new Hono();

// Mount route groups
routes.route("/accounts", accounts);
routes.route("/agents", agents);
routes.route("/alerts", alerts);
routes.route("/dcg", dcg);
routes.route("/health", health);
routes.route("/history", history);
routes.route("/metrics", metrics);
routes.route("/sessions", context);
routes.route("/utilities", utilities);

export { routes };
