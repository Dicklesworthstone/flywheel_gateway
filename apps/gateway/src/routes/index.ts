/**
 * Routes Index - Aggregates all route handlers.
 */

import { Hono } from "hono";
import { accounts } from "./accounts";
import { agents } from "./agents";
import { alerts } from "./alerts";
import { analytics } from "./analytics";
import audit from "./audit";
import { beads } from "./beads";
import { cass } from "./cass";
import { checkpoints } from "./checkpoints";
import { conflicts } from "./conflicts";
import { context } from "./context";
import { dcg } from "./dcg";
import { handoffs } from "./handoffs";
import { health } from "./health";
import { history } from "./history";
import jobs from "./jobs";
import { mail } from "./mail";
import { memory } from "./memory";
import { metrics } from "./metrics";
import { notifications } from "./notifications";
import { pipelines } from "./pipelines";
import { reservations } from "./reservations";
import { ru } from "./ru";
import { scanner } from "./scanner";
import { supervisor } from "./supervisor";
import { utilities } from "./utilities";

const routes = new Hono();

// Mount route groups
routes.route("/accounts", accounts);
routes.route("/agents", agents);
routes.route("/alerts", alerts);
routes.route("/analytics", analytics);
routes.route("/audit", audit);
routes.route("/beads", beads);
routes.route("/cass", cass);
routes.route("/conflicts", conflicts);
routes.route("/dcg", dcg);
routes.route("/handoffs", handoffs);
routes.route("/health", health);
routes.route("/history", history);
routes.route("/jobs", jobs);
routes.route("/mail", mail);
routes.route("/memory", memory);
routes.route("/metrics", metrics);
routes.route("/notifications", notifications);
routes.route("/pipelines", pipelines);
routes.route("/reservations", reservations);
routes.route("/sessions", checkpoints);
routes.route("/sessions", context);
routes.route("/ru", ru);
routes.route("/scanner", scanner);
routes.route("/supervisor", supervisor);
routes.route("/utilities", utilities);

export { routes };
