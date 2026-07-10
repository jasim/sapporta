/**
 * Application entry point.
 *
 * Start here when you need to change how the app is hosted. This file chooses
 * the database, loads your table/report definitions, installs auth, mounts
 * `/api/...` routes, exposes `/api/openapi.json` for CLI discovery, and serves
 * the built frontend.
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
import { publicApiRoutes } from "./app.js";
import { buildAbility } from "./authz/ability.js";
import { resolveRequestDataAuthority } from "./authz/request-data-authority.js";
import { createSapportaMailer } from "./mailer.js";
import { createProjectAuth, readProjectAuthEnv } from "./project-auth/index.js";

// Find the project root first so the app can start from any working directory.
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
  name: "%%SAPPORTA:NAME%%",
  slug: "%%SAPPORTA:SLUG%%",
  projectRoot,
  apiDistDir,
  conn,
});

// Auth needs the loaded table catalog so every request can apply row security
// before a handler reads or writes table-backed data.
assertAuthSchemaDefinitions(sapporta.catalog.tables);
const projectEnv = readProjectAuthEnv();
const mailer = createSapportaMailer(projectEnv.mail);
const projectAuth = createProjectAuth({
  conn,
  env: projectEnv,
  catalog: sapporta.catalog,
  mailer,
  buildAbility,
  resolveRequestDataAuthority,
  publicRoutes: publicApiRoutes,
});

// All HTTP behavior for this app is mounted on one Hono server.
const app = new Hono<SapportaEnv>();

// Browser sign-in lives under /api/auth/*. All other /api routes receive a
// Sapporta auth context and are private unless explicitly allow-listed.
installRequestLogging(app);
installExactOriginCors(app, {
  origins: projectAuth.env.trustedOrigins,
  credentials: true,
});
installSapportaErrorHandler(app);
if (projectAuth.env.healthPolicy === "authenticated") {
  app.use("/health", projectAuth.resolveMiddleware);
}
mountHealth(
  app,
  projectAuth.env.healthPolicy,
  projectAuth.requirePrincipalUser,
);
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  projectAuth.auth.handler(c.req.raw),
);
installSapportaRequestContext(app, conn);
app.use("/api/*", projectAuth.resolveMiddleware);
app.use("/api/*", projectAuth.rejectAnonymousMiddleware);

// Built-in app APIs: table metadata, CRUD rows, and SQL tools.
const sapportaApi = mountSapportaFramework(app, sapporta, {
  conn,
  auth: {
    requireAuthContext: projectAuth.requireAuthContext,
  },
});

// Custom app APIs. `loadApp()` registers paths like "/bank"; mounting under
// /api serves them at /api/bank.
const apiApp = new TsRestApi<SapportaEnv>();
loadApp(apiApp, { conn, mailer });
app.route("/api", apiApp);
app.route("/api", projectAuth.routes);

// CLI clients use this contract to discover the live API. Because /api routes
// above are private by default, protected apps require the same credentials for
// discovery that they require for data commands.
mountOpenApi(app, sapporta, sapportaApi, apiApp, projectAuth.routes);

// Serve the frontend from the same process by default. Three deployment shapes work:
//   (a) same-origin via this Hono process (default; `pnpm start`)
//   (b) same-origin behind nginx - nginx serves packages/frontend/dist directly
//       and proxies /api/ here; this block becomes harmless dead code
//   (c) split - SPA on a CDN, API here. Delete this block, set VITE_API_URL
//       for the SPA build, set SAPPORTA_PUBLIC_APP_URL on the API host, and
//       route public /api/auth/* requests to this API process.
//
// API routes have already matched above. Remaining browser requests fall
// through to index.html so client-side routes survive hard reloads.
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

// Start the API server.
const port = projectEnv.apiPort;
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`%%SAPPORTA:SLUG%% API server ready (port ${port})`);
});

// Close SQLite cleanly when the process receives a termination signal.
const shutdown = (signal: NodeJS.Signals) => {
  server.close();
  conn.sqlite.close();
  process.kill(process.pid, signal);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
