/**
 * Application entry point.
 *
 * Sequence: paths -> DB -> Hono app -> framework -> user routes -> OpenAPI ->
 * static assets -> serve. Each step is a plain function call; read the
 * source if you need to customize.
 */
import { relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
  connectProject,
  findProjectRootFrom,
  fromProjectRoot,
  setProjectRoot,
  loadSapporta,
  mountOpenApi,
  TsRestApi,
  type SapportaEnv,
} from "@sapporta/server";
import { loadApp } from "./app.js";

// 1. Paths + DB
const projectRoot = findProjectRootFrom(import.meta.dirname);
if (!projectRoot) {
  throw new Error(`Could not find sapporta.json walking up from ${import.meta.dirname}`);
}
setProjectRoot(projectRoot);
const { apiDistDir, frontendDistDir, databasePath } = fromProjectRoot(projectRoot);
const conn = connectProject(databasePath);

// 2. Shared Hono app - framework and user routes mount onto it.
const app = new Hono<SapportaEnv>();

// 3. Framework: schemas, migrations, /api/meta + /api/tables + /api/reports.
//    Order-agnostic relative to step 4.
const sapporta = await loadSapporta(app, { slug: "__SLUG__", apiDistDir, conn });

// 4. User routes. `loadApp()` registers project paths like "/bank";
//    mounting apiApp under /api serves them at /api/bank.
const apiApp = new TsRestApi<SapportaEnv>();
loadApp(apiApp, conn);
app.route("/api", apiApp);

// 5. /api/openapi.json. Must follow steps 3 and 4 - emitters are
//    snapshotted at this call.
mountOpenApi(app, sapporta, apiApp);

// 6. Static assets + SPA fallback. Three deployment shapes work:
//   (a) same-origin via this Hono process (default; `pnpm start`)
//   (b) same-origin behind nginx - nginx serves packages/frontend/dist directly
//       and proxies /api/ here; this block becomes harmless dead code
//   (c) split - SPA on a CDN, API here. Delete this block, set
//       VITE_API_URL in packages/frontend/.env.production, and add CORS:
//       `app.use("/api/*", cors({ origin: process.env.FRONTEND_ORIGIN! }))`
//
// Mounted after /api so API routes match first; everything else falls
// through to index.html for client-side routing on hard reload.
//
// Path is anchored to projectRoot (not "./packages/frontend/dist") so launching
// from any cwd works - systemd, Docker, test harnesses. serveStatic's
// root is relative to process.cwd(); `|| "."` covers the corner case
// where cwd is already inside packages/frontend/dist.
const frontendDist = relative(process.cwd(), frontendDistDir) || ".";
app.use("/*", serveStatic({ root: frontendDist }));
// GET-only - a stray POST to /wat must 404, not return index.html.
app.get("/*", serveStatic({ root: frontendDist, path: "index.html" }));

// 7. Serve
const port = parseInt(process.env.PORT ?? "3000", 10);
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`__SLUG__ API server ready (port ${port})`);
});

// Re-raise the signal after closing so the process exits with the
// signal's status code rather than 0.
const shutdown = (signal: NodeJS.Signals) => {
  server.close();
  conn.sqlite.close();
  process.kill(process.pid, signal);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
