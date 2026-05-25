# Deployment

## Overview

Three production-valid deployment shapes. The code is identical; only SPA/API location and the browser's path to the API differ, so promotion needs no rewrite.

- **(a) Single process** — one Hono process serves SPA and API on one port, via `pnpm start` by default.
- **(b) Reverse proxy** — nginx/Caddy serves the SPA and proxies `/api/` to Hono, appearing same-origin to the browser.
- **(c) Split topology** — SPA on a CDN, API on a separate host, cross-origin.

Start with (a) unless you have a reason not to.

## Same-origin vs. cross-origin

The shapes split on one question: does the browser see the SPA and API on the same origin?

- (a) and (b) are same-origin; they differ only in who serves the static assets (Hono or a proxy), which the browser can't see.
- (c) is cross-origin.

Same-origin means:

- **No CORS** — no preflight, middleware, or allowed-origin list.
- **No frontend env var for the API location** — relative `fetch("/api/foo")` works.

Shape (c) loses both; its four configuration changes all follow from that.

## The `serveStatic` block

`packages/api/boot.ts` serves `packages/frontend/dist/` with an SPA fallback for deep links. Its role shifts by shape:

- **(a):** active — the mechanism that lets one Hono process answer both HTML and API.
- **(b):** inert (the proxy intercepts static requests first), but **keep it** so `pnpm start` alone still works for prod smoke tests, proxy-less Docker images, etc.
- **(c):** dead code — **delete it**; leaving it obscures what the API process does.

## Shape (a) — Single process (default)

One Hono process serves `/api/*` and the built SPA on a single `PORT`; no proxy in front.

```bash
pnpm build                 # tsc → packages/api/dist/, vite build → packages/frontend/dist/
PORT=3000 pnpm start       # node packages/api/dist/boot.js
```

The browser loads the SPA from `http://your-host:3000/`, and its relative `fetch("/api/foo")` calls hit the same process.

- **Good for:** personal projects, small/medium deployments, Fly.io, Railway, a VPS, a single Docker container.
- **Trade-off:** SPA and API tiers scale together. Rarely an issue; if it becomes one, promote to (b) or (c).

## Shape (b) — Reverse proxy (nginx, Caddy, etc.)

A reverse proxy serves `packages/frontend/dist/` directly and proxies `/api/` to Hono (still run via `PORT=3000 pnpm start`).

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/__SLUG__/packages/frontend/dist;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri /index.html;   # SPA fallback for deep links
    }
}
```

- **Good for:** multi-site hosts, TLS via Let's Encrypt, HTTP/2, asset cache headers, gzip/brotli, standard ops hygiene.
- **Trade-off:** extra config surface, but stock nginx carries over to any project.

## Shape (c) — Split topology: SPA on a CDN, API on its own host

The SPA ships to a CDN (Cloudflare Pages, Netlify, Vercel, S3 + CloudFront, …) and the Hono API runs on a separate host — e.g. `https://app.example.com` for the SPA and `https://api.example.com` for the API. Four configuration changes follow:

### 1. CORS middleware on the API

Set `FRONTEND_ORIGIN` on the API server and mount the middleware before the API routes in `packages/api/boot.ts`:

```ts
import { cors } from "hono/cors";

app.use("/api/*", cors({
  origin: process.env.FRONTEND_ORIGIN!,   // e.g. "https://app.example.com"
}));
```

For cookie-based auth, also set `credentials: true` and make `FRONTEND_ORIGIN` an exact origin — browsers refuse credentialed requests against a wildcard `*`.

### 2. Absolute backend URL baked into the SPA

Relative requests would hit the CDN and 404. Set `VITE_API_URL` in `packages/frontend/.env.production`:

```
VITE_API_URL=https://api.example.com
```

That's the only change needed in the SPA — application code is untouched. `@sapporta/frontend` reads `VITE_API_URL` at build time and exposes `${VITE_API_URL}/api` via `getApiBase()`; both the framework's `uiClient` and your project's client (`createApiClient(yourContract, { baseUrl: getApiBase })` in `packages/frontend/src/api.ts`) take `getApiBase` as their `baseUrl`, so every typed call becomes absolute automatically. Dev mode keeps using relative URLs through Vite's proxy (`packages/frontend/vite.config.ts`), so only the production bundle is affected.

Only `VITE_`-prefixed env vars reach the client bundle — Vite's rule. Don't smuggle secrets through `VITE_*`; they ship in the JS.

### 3. Delete the `serveStatic` block

Dead code in this shape (see the `serveStatic` section).

### 4. Deploy in two halves

- **SPA:** `vite build` → `packages/frontend/dist/`. Upload to the CDN and configure an SPA fallback (`/* → /index.html`) so React Router handles deep links on hard reload.
- **API:** `tsc` → `packages/api/dist/`. Run `node packages/api/dist/boot.js` with `PORT` and `FRONTEND_ORIGIN` set.

Fit:

- **Good for:** global CDN delivery of the SPA, independent scaling of the static and API tiers, edge caching, separate frontend and backend deploy cadences.
- **Trade-offs:** the most moving parts, and CORS misconfiguration is the single most common failure mode. Cookie-based auth gets awkward — `SameSite=None`, `Secure`, and matching origin lists are mandatory and strictly enforced. If you're not sure you need this shape, don't start here.

## Environment variables, by shape

| Variable          | Read from                  | (a) | (b) | (c) | Purpose                                          |
| ----------------- | -------------------------- | --- | --- | --- | ------------------------------------------------ |
| `PORT`            | API host process env       | yes | yes | yes | Port Hono binds to. Defaults to `3000`.          |
| `FRONTEND_ORIGIN` | API host process env       | —   | —   | yes | Origin allowed by CORS middleware.               |
| `VITE_API_URL`    | `packages/frontend/.env.production` | —   | —   | yes | Absolute API origin inlined into the SPA bundle. |

In (a) and (b), `PORT` is the only variable needed.

## Operational concerns (shape-independent)

### Database persistence

`better-sqlite3` stores the database under the project's data directory (resolved by `fromProjectRoot` at boot). In production that directory **must** be on a persistent volume, or the database vanishes on every restart — the single most common deployment bug.

- **Docker:** named volume or bind mount at the data directory.
- **systemd on a VPS:** the default filesystem is already persistent; just don't place the project under `/tmp` or a tmpfs mount.
- **Fly.io / Railway / similar:** attach a persistent volume and point the project root at it.

Back up out-of-band (e.g. `sqlite3 db.sqlite .backup /backups/db-$(date +%F).sqlite`, synced to object storage); SQLite gives a consistent snapshot even while Hono is writing.

### Graceful shutdown

`packages/api/boot.ts` handles `SIGINT` and `SIGTERM`: it closes the HTTP server and the SQLite connection, then re-raises the signal so the process exits with the right status. Docker's stop signal, systemd's `ExecStop`, and `Ctrl-C` all drain in-flight requests cleanly — nothing to change.
