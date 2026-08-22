import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { parseBoundedInteger } from "@sapporta/shared/validation";

// Dev topology: Vite serves the SPA on :5173 and transparently proxies
// /api/* to the Hono backend on SAPPORTA_API_PORT (default 3000) — frontend code uses
// relative URLs and never sees the backend port. In prod, Hono alone
// serves both the built SPA (packages/frontend/dist/) and the API from one origin,
// so the same relative URLs keep working. No VITE_API_URL is needed unless
// production splits the SPA and API across different origins.
//
// Multi-project on one machine: give each project its own SAPPORTA_API_PORT and
// SAPPORTA_FRONTEND_PORT in .env.development. boot.ts reads SAPPORTA_API_PORT
// to bind Hono; this config reads it as the API proxy target and reads
// SAPPORTA_FRONTEND_PORT as Vite's own port. strictPort keeps the trusted dev
// origin exact.
//
// SAPPORTA_PUBLIC_APP_URL is a separate setting, not a restatement of these
// ports: it is the origin the browser loads the app from, which is this Vite
// server in development and the site's own domain in a deployment. While it
// points at this server, its port has to match SAPPORTA_FRONTEND_PORT; keep
// the two in step by hand rather than deriving one from the other.
//
// %%SAPPORTA:SLUG%%-shared is aliased to its source so HMR works without rebuilding
// the shared package's dist/ on every edit. Backend imports the same
// package via the pnpm symlink and reads dist/ (Node can't run TS).
const apiPort = parseIntegerEnv("SAPPORTA_API_PORT", 3000);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // %%SAPPORTA:VITE_SOURCE_LINK_RESOLUTION%%
    alias: {
      "%%SAPPORTA:SLUG%%-shared": path.resolve(
        __dirname,
        "../shared/src/index.ts",
      ),
    },
  },
  server: {
    port: parseIntegerEnv("SAPPORTA_FRONTEND_PORT", 5173),
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@js-temporal/polyfill")) return "temporal";
        },
      },
    },
  },
});

function parseIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return parseBoundedInteger(value, {
    name,
    min: 0,
    defaultValue: fallback,
    makeError: () => new Error(`${name} must be an integer.`),
  });
}
