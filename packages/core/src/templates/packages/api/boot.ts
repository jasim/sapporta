/**
 * Application entry point.
 *
 * Sequence: paths -> DB -> Sapporta project metadata -> auth -> Hono app ->
 * middleware -> framework routes -> user routes -> OpenAPI -> static assets ->
 * serve. Each step is a plain function call; read the source if you need to
 * customize.
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
  installExactOriginCors,
  installRequestLogging,
  installSapportaRequestContext,
  installSapportaErrorHandler,
  assertAuthSchemaDefinitions,
  loadSapportaProject,
  mountHealth,
  mountOpenApi,
  mountSapportaFramework,
  TsRestApi,
  type SapportaEnv,
} from "@sapporta/server";
import { loadApp } from "./app.js";
import { createSapportaMailer } from "./mailer.js";
import { createProjectAuth, readProjectAuthEnv } from "./project-auth/index.js";

// 1. Paths + DB + Sapporta project metadata. Loading the Sapporta project reads
//    schema/report modules and checks migration readiness; it does not mutate
//    the Hono app.
const projectRoot = findProjectRootFrom(import.meta.dirname);
if (!projectRoot) {
  throw new Error(
    `Could not find sapporta.json walking up from ${import.meta.dirname}`,
  );
}
setProjectRoot(projectRoot);
const { apiDistDir, frontendDistDir, databasePath } =
  fromProjectRoot(projectRoot);
const conn = connectProject(databasePath);
const sapporta = await loadSapportaProject({
  slug: "__SLUG__",
  projectRoot,
  apiDistDir,
  conn,
});

// 2. Auth can boot after loaded tables exist, so request auth contexts contain
//    row-security guards from the start.
assertAuthSchemaDefinitions(sapporta.catalog.tables);
const projectEnv = readProjectAuthEnv();
const mailer = createSapportaMailer(projectEnv.mail);
const projectAuth = createProjectAuth({
  conn,
  env: projectEnv,
  catalog: sapporta.catalog,
  mailer,
});

// 3. Shared Hono app - framework and user routes mount onto it.
const app = new Hono<SapportaEnv>();

// 4. Request middleware and public health. Auth projects mount Better Auth at
//    /api/auth/* before installing project-auth middleware.
installRequestLogging(app);
installExactOriginCors(app, {
  origins: projectAuth.env.trustedOrigins,
  credentials: true,
});
installSapportaErrorHandler(app);
mountHealth(
  app,
  projectAuth.env.healthPolicy,
  projectAuth.requireWorkspaceUser,
);
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  projectAuth.auth.handler(c.req.raw),
);
installSapportaRequestContext(app, conn);
app.use("/api/*", projectAuth.middleware);

// 5. Framework: /api/meta + /api/tables + /api/reports.
const sapportaApi = mountSapportaFramework(app, sapporta, {
  conn,
  auth: {
    requireFrameworkAccess: projectAuth.requireWorkspaceOwner,
  },
});

// 6. User routes. `loadApp()` registers project paths like "/bank";
//    mounting apiApp under /api serves them at /api/bank.
const apiApp = new TsRestApi<SapportaEnv>();
loadApp(apiApp, { conn, mailer });
app.route("/api", apiApp);
app.route("/api", projectAuth.routes);

// 7. /api/openapi.json. Must follow framework and user routes - emitters are
//    snapshotted at this call.
mountOpenApi(app, sapporta, sapportaApi, apiApp, projectAuth.routes);

// 8. Static assets + SPA fallback. Three deployment shapes work:
//   (a) same-origin via this Hono process (default; `pnpm start`)
//   (b) same-origin behind nginx - nginx serves packages/frontend/dist directly
//       and proxies /api/ here; this block becomes harmless dead code
//   (c) split - SPA on a CDN, API here. Delete this block, set VITE_API_URL
//       for the SPA build, and set SAPPORTA_FRONTEND_ORIGINS on the API host.
//
// Mounted after /api so API routes match first; everything else falls
// through to index.html for client-side routing on hard reload.
//
// Path is anchored to projectRoot (not "./packages/frontend/dist") so launching
// from any cwd works - systemd, Docker, test harnesses. serveStatic's
// root is relative to process.cwd(); `|| "."` covers the corner case
// where cwd is already inside packages/frontend/dist.
const frontendDist = relative(process.cwd(), frontendDistDir) || ".";
// Vite assets are content-hashed, so they can be cached for a year.
app.use("/assets/*", async (c, next) => {
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  await next();
});
app.use("/assets/*", serveStatic({ root: frontendDist }));

// HTML must revalidate because it points at the latest asset hashes.
app.get("/index.html", async (c, next) => {
  c.header("Cache-Control", "no-cache");
  await next();
});
app.get("/index.html", serveStatic({ root: frontendDist }));

// Root files and SPA fallbacks stay fresh across deploys.
app.use("/*", async (c, next) => {
  c.header("Cache-Control", "no-cache");
  await next();
});
app.use("/*", serveStatic({ root: frontendDist }));
// GET-only - a stray POST to /wat must 404, not return index.html.
app.get("/*", serveStatic({ root: frontendDist, path: "index.html" }));

// 9. Serve
const port = projectEnv.port;
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
