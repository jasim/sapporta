import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev topology: Vite serves the SPA on :5173 and transparently proxies
// /api/* to the Hono backend on PORT (default 3000) — frontend code uses
// relative URLs and never sees the backend port. In prod, Hono alone
// serves both the built SPA (packages/frontend/dist/) and the API from one origin,
// so the same relative URLs keep working. No .env, no VITE_API_URL, no CORS.
//
// Multi-project on one machine: start each project with its own backend
// port (e.g. `PORT=3001 pnpm dev`, `PORT=3002 pnpm dev`). boot.ts reads
// PORT to bind Hono; this config reads the same var to point the proxy.
// Vite's own dev port (5173) auto-increments on collision, so the frontend
// side takes care of itself.
//
// __SLUG__-shared is aliased to its source so HMR works without rebuilding
// the shared package's dist/ on every edit. Backend imports the same
// package via the pnpm symlink and reads dist/ (Node can't run TS).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "__SLUG__-shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${process.env.PORT ?? "3000"}`,
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
