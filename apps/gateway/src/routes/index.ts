/**
 * Routes Index - Aggregates all route handlers.
 */

import { Hono } from "hono";
import { accounts } from "./accounts";
import { agents } from "./agents";
import { alerts } from "./alerts";
import { beads } from "./beads";
import { cass } from "./cass";
import { checkpoints } from "./checkpoints";
import { conflicts } from "./conflicts";
import { context } from "./context";
import { dcg } from "./dcg";
import { health } from "./health";
import { history } from "./history";
import { mail } from "./mail";
import { metrics } from "./metrics";
import { reservations } from "./reservations";
import { ru } from "./ru";
import { scanner } from "./scanner";
import { utilities } from "./utilities";

const routes = new Hono();

// Mount route groups
routes.route("/accounts", accounts);
routes.route("/agents", agents);
routes.route("/alerts", alerts);
routes.route("/beads", beads);
routes.route("/cass", cass);
routes.route("/conflicts", conflicts);
routes.route("/dcg", dcg);
routes.route("/health", health);
routes.route("/history", history);
routes.route("/mail", mail);
routes.route("/metrics", metrics);
routes.route("/reservations", reservations);
routes.route("/sessions", checkpoints);
routes.route("/sessions", context);
routes.route("/ru", ru);
routes.route("/scanner", scanner);
routes.route("/utilities", utilities);

export { routes };
