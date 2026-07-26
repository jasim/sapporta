/**
 * App-specific API routes.
 *
 * Sapporta creates standard APIs for tables in `schema/`. Mount custom APIs,
 * such as reports and workflows, in `loadApp()` below. The app is already
 * scoped to `/api`, so `app.route("/bank", bankApi)` serves `/api/bank`.
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

// Files in `app/` are not exposed until they are mounted here.
export function loadApp(app: TsRestApi<SapportaEnv>, _options: LoadAppOptions) {
  app.route("/", helloApi);
  app.route("/", publicApiSample);
}

// These custom routes may be called without signing in.
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
