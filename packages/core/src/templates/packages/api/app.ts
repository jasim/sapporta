/**
 * App-specific API routes.
 *
 * Mount each `packages/api/app/*.ts` sub-app here. `app` is already scoped to
 * `/api`, so `app.route("/bank", bankApi)` is served at `/api/bank`; do not
 * repeat the `/api` prefix.
 *
 * Add a route here when you want it available from the browser, CLI, or API
 * clients. New files under `packages/api/app/` are not exposed until you mount
 * them here.
 */
import type {
  ProjectDbConnection,
  SapportaEnv,
  TsRestApi,
} from "@sapporta/server";
import helloApi from "./app/hello.js";
import publicApiSample from "./app/public-api-sample.js";
import type { SapportaMailer } from "./mailer.js";
import type { PublicRoutePattern } from "./project-auth/index.js";

export interface LoadAppOptions {
  conn: ProjectDbConnection;
  mailer: SapportaMailer;
}

export function loadApp(app: TsRestApi<SapportaEnv>, _options: LoadAppOptions) {
  app.route("/", helloApi);
  app.route("/", publicApiSample);
}

export const publicApiRoutes = [
  { method: "GET", path: "/api/public-api-sample" },
] as const satisfies readonly PublicRoutePattern[];

/**
 * PUBLIC ROUTE WARNING
 *
 * Routes in `publicApiRoutes` can be reached by anonymous visitors. Add a path
 * here only when the feature is intentionally public. The handler must still
 * read `c.get("auth")`, call `forbidUnless(c, auth.ability.can(...))`, and use
 * row security for any table-backed data.
 *
 * For table-backed public pages, import the table definition and compose the
 * route predicate with row security:
 *
 *   const auth = c.get("auth");
 *   forbidUnless(c, auth.ability.can("read-published", "quotes"));
 *   const access = auth.rowSecurity.forTable(quotes);
 *   const where = access.ownedRows(eq(quotesTable.published, true));
 */
