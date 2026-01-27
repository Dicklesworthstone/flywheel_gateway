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
import { costAnalytics } from "./cost-analytics";
import { dashboards } from "./dashboards";
import { dcg } from "./dcg";
import { handoffs } from "./handoffs";
import { health } from "./health";
import { history } from "./history";
import jobs from "./jobs";
import { knowledge } from "./knowledge";
import { mail } from "./mail";
import { memory } from "./memory";
import { metrics } from "./metrics";
import { ms } from "./ms";
import { notifications } from "./notifications";
import openapi from "./openapi";
import { pipelines } from "./pipelines";
import { plans } from "./plans";
import { processes } from "./processes";
import { prompts } from "./prompts";
import { pt } from "./pt";
import { rch } from "./rch";
import { reservations } from "./reservations";
import { ru } from "./ru";
import { safety } from "./safety";
import { scanner } from "./scanner";
import { setup } from "./setup";
import { slb } from "./slb";
import { supervisor } from "./supervisor";
import { system } from "./system";
import { utilities } from "./utilities";
import { xf } from "./xf";

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
routes.route("/cost-analytics", costAnalytics);
routes.route("/dashboards", dashboards);
routes.route("/dcg", dcg);
routes.route("/handoffs", handoffs);
routes.route("/health", health);
routes.route("/history", history);
routes.route("/jobs", jobs);
routes.route("/knowledge", knowledge);
routes.route("/mail", mail);
routes.route("/memory", memory);
routes.route("/metrics", metrics);
routes.route("/ms", ms);
routes.route("/notifications", notifications);
routes.route("/pipelines", pipelines);
routes.route("/pt", pt);
routes.route("/plans", plans);
routes.route("/processes", processes);
routes.route("/prompts", prompts);
routes.route("/rch", rch);
routes.route("/reservations", reservations);
routes.route("/sessions", checkpoints);
routes.route("/sessions", context);
routes.route("/ru", ru);
routes.route("/safety", safety);
routes.route("/scanner", scanner);
routes.route("/setup", setup);
routes.route("/slb", slb);
routes.route("/supervisor", supervisor);
routes.route("/system", system);
routes.route("/utilities", utilities);
routes.route("/xf", xf);

// Mount OpenAPI routes at root level
routes.route("/", openapi);

export { routes };
