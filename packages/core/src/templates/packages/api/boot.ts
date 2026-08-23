/**
 * Application entry point.
 *
 * `runtime.ts` opens the database, loads the table schema, and configures auth
 * and mail. This file mounts Hono on top of that: Sapporta's generated APIs and
 * the application's custom APIs, OpenAPI, and the built frontend.
 */
import { relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
  installExactOriginCors,
  installRequestLogging,
  installSapportaRequestContext,
  installSapportaErrorHandler,
  mountHealth,
  mountOpenApi,
  mountSapportaFramework,
  TsRestApi,
  type SapportaEnv,
} from "@sapporta/server";
import { loadApp, publicApiRoutes } from "./app.js";
import { openProjectRuntime } from "./runtime.js";

// The runtime finds the project root itself, so the app starts from any
// working directory. Database migrations remain a separate development and
// deployment step.
const {
  conn,
  sapporta,
  env: projectEnv,
  mailer,
  projectAuth,
  frontendDistDir,
  close: closeDatabase,
} = await openProjectRuntime({ publicRoutes: publicApiRoutes });

// All HTTP behavior for this app is mounted on one Hono server.
const app = new Hono<SapportaEnv>();

// Browser sign-in lives under /api/auth/*. Other API routes are private unless
// they are listed in `publicApiRoutes`.
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

// Create the standard table APIs from the loaded schema.
// `openapiPolicy` decides who may read the generated contract at
// /api/openapi.json. It is `public` in development so `sapporta endpoints
// list` works with no access token, and `authenticated` when unset.
const sapportaApi = mountSapportaFramework(app, sapporta, {
  conn,
  auth: {
    requireAuthContext: projectAuth.requireAuthContext,
  },
  openapiPolicy: projectAuth.env.openapiPolicy,
});

// Mount the application's custom APIs under /api.
const apiApp = new TsRestApi<SapportaEnv>();
loadApp(apiApp, { conn, mailer });
app.route("/api", apiApp);

// Mount the auth-context, workspace, and access-token APIs.
app.route("/api", projectAuth.routes);

// Describe all mounted APIs at /api/openapi.json.
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
  console.log(`%%SAPPORTA:SLUG%% API server ready on http://localhost:${port}`);
});

// A port already taken by another process would otherwise end the run with a
// bare EADDRINUSE stack trace, which does not say which setting to change.
server.on("error", (error: Error) => {
  if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
  console.error(
    `Port ${port} is already in use. Set SAPPORTA_API_PORT to a free port and start again.`,
  );
  process.exit(1);
});

// Close SQLite cleanly when the process receives a termination signal.
const shutdown = (signal: NodeJS.Signals) => {
  server.close();
  closeDatabase();
  process.kill(process.pid, signal);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
