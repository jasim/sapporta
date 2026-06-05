# Deployment

## Overview

Three production-valid deployment shapes. The code is identical; only SPA/API location and the browser's path to the API differ, so promotion needs no rewrite.

- **(a) Single process** — one Hono process serves SPA and API on one port, via `pnpm start` by default.
- **(b) Reverse proxy** — nginx/Caddy serves the SPA and proxies `/api/` to Hono, appearing same-origin to the browser.
- **(c) Split topology** — SPA on a CDN, API on a separate host, cross-origin.

Start with (a) unless you have a reason not to.

The generated `Dockerfile` implements shape (a): the image contains both
`packages/api/dist/` and `packages/frontend/dist/`, then runs
`node packages/api/dist/boot.js`. Hono serves `/api/*` and the built SPA from
the same container port. There is no nginx/Caddy proxy inside the image; any
proxy is outside the container for TLS, routing, or load balancing.

## Same-origin vs. cross-origin

The shapes split on one question: does the browser see the SPA and API on the same origin?

- (a) and (b) are same-origin; they differ only in who serves the static assets (Hono or a proxy), which the browser can't see.
- (c) is cross-origin.

Same-origin means:

- **No frontend env var for the API location** — relative `fetch("/api/foo")` works.
- **No cross-origin API URL** — the browser does not need to know a separate API host.

Shape (c) loses both; its extra configuration follows from that.

## Environment files

`sapporta init` creates two env files:

- `.env.development` — loaded by `pnpm dev` with Node's built-in `--env-file`.
  It contains local-only values, including a generated `BETTER_AUTH_SECRET`.
- `.env.production.example` — placeholder production values. Copy the values
  into your deployment environment; `pnpm start` does not load development env.

`SAPPORTA_PUBLIC_BASE_URL` is the public browser-facing app origin. Sapporta
uses it as Better Auth's public base URL and as the server-owned return URL for
auth emails. It must be an origin only, such as `https://app.example.com`, and
`/api/auth/*` must be reachable from that origin.

`SAPPORTA_FRONTEND_ORIGINS` is the list of browser origins allowed to make
credentialed API/auth requests in addition to `SAPPORTA_PUBLIC_BASE_URL`.

In development, set `SAPPORTA_PUBLIC_BASE_URL` to the Vite dev-server origin
and `FRONTEND_DEV_PORT` to the same port. Vite proxies `/api/*` to Hono, so
auth links like `/api/auth/verify-email` work from the public dev origin. Set
`SAPPORTA_FRONTEND_ORIGINS` only when you need additional browser origins.

`VITE_API_URL` is different: it is baked into the browser bundle only when the
SPA and API are deployed to different origins. It is not used in development or
same-origin production.

## The `serveStatic` block

`packages/api/boot.ts` serves `packages/frontend/dist/` with an SPA fallback for deep links. Its role shifts by shape:

- **(a):** active — the mechanism that lets one Hono process answer both HTML and API.
- **(b):** inert (the proxy intercepts static requests first), but **keep it** so `pnpm start` alone still works for prod smoke tests, proxy-less Docker images, etc.
- **(c):** dead code — **delete it**; leaving it obscures what the API process does.

## Shape (a) — Single process (default)

One Hono process serves `/api/*` and the built SPA on a single `PORT`; no proxy in front.

```bash
pnpm build                 # tsc → packages/api/dist/, vite build → packages/frontend/dist/
pnpm --filter ./packages/api db:migrate
PORT=3000 pnpm start       # node packages/api/dist/boot.js
```

The browser loads the SPA from `http://your-host:3000/`, and its relative `fetch("/api/foo")` calls hit the same process.

- **Good for:** personal projects, small/medium deployments, Fly.io, Railway, a VPS, a single Docker container.
- **Trade-off:** SPA and API tiers scale together. Rarely an issue; if it becomes one, promote to (b) or (c).

### Docker image

Scaffolded projects include a production `Dockerfile` for this same-origin
shape. It builds the shared package, API, and frontend, installs production
dependencies, copies the built SPA into `packages/frontend/dist/`, exposes
`PORT` defaulting to `3000`, and health-checks `/api/openapi.json`.

```bash
docker build -t %%SAPPORTA:SLUG%% .
docker run --rm -p 3000:3000 -v %%SAPPORTA:SLUG%%-data:/app/data %%SAPPORTA:SLUG%%
```

Then open `http://localhost:3000/`. The SPA and API are same-origin: browser
requests to `/api/*` go to the Hono process in the same container. `VITE_API_URL`
is not needed for this Docker shape.

Keep `/app/data` on a named volume or bind mount. Without that volume, SQLite
data is tied to the container filesystem and disappears when the container is
replaced.

If you put nginx, Caddy, a platform router, or a load balancer in front of the
container, proxy the public origin to the container port. That external proxy
does not change the browser contract: `/` and `/api/*` still share one public
origin, so frontend API calls remain relative.

## Shape (b) — Reverse proxy (nginx, Caddy, etc.)

A reverse proxy serves `packages/frontend/dist/` directly and proxies `/api/` to Hono (still run via `PORT=3000 pnpm start`).

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/%%SAPPORTA:SLUG%%/packages/frontend/dist;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri /index.html;   # SPA fallback for deep links
        add_header Cache-Control "no-cache";
    }
}
```

`/assets/*` is safe to cache immutably because Vite writes content hashes into
asset filenames. `index.html` must revalidate because it points at the latest
hashed JS and CSS files for the current deployment.

- **Good for:** multi-site hosts, TLS via Let's Encrypt, HTTP/2, asset cache headers, gzip/brotli, standard ops hygiene.
- **Trade-off:** extra config surface, but stock nginx carries over to any project.

## Shape (c) — Split topology: SPA on a CDN, API on its own host

The SPA ships to a CDN (Cloudflare Pages, Netlify, Vercel, S3 + CloudFront, …) and the Hono API runs on a separate host — e.g. `https://app.example.com` for the SPA and `https://api.example.com` for the API.

### 1. Public app origin and trusted origins

Set `SAPPORTA_PUBLIC_BASE_URL` on the API server:

```env
SAPPORTA_PUBLIC_BASE_URL=https://app.example.com
```

Sapporta includes that origin in Better Auth `trustedOrigins` and uses it for
verification/reset email return URLs. Set `SAPPORTA_FRONTEND_ORIGINS` only for
additional browser origins:

```env
SAPPORTA_FRONTEND_ORIGINS=https://preview.example.com
```

Sapporta's generated `boot.ts` installs exact-origin credentialed CORS and passes
the public origin plus any extra origins to Better Auth as `trustedOrigins`.

### 2. Absolute backend URL baked into the SPA

Relative requests would hit the CDN and 404. Set `VITE_API_URL` in `packages/frontend/.env.production`:

```
VITE_API_URL=https://api.example.com
```

That's the only change needed in the SPA — application code is untouched. `@sapporta/frontend` reads `VITE_API_URL` at build time and exposes `${VITE_API_URL}/api` via `getApiBase()`; both the framework's `uiClient` and your project's client (`createApiClient(yourContract, { baseUrl: getApiBase })` in `packages/frontend/src/api.ts`) take `getApiBase` as their `baseUrl`, so every typed call becomes absolute automatically. Dev mode keeps using relative URLs through Vite's proxy (`packages/frontend/vite.config.ts`), so only the production bundle is affected.

Only `VITE_`-prefixed env vars reach the client bundle — Vite's rule. Don't smuggle secrets through `VITE_*`; they ship in the JS.

### 3. Route auth callbacks from the public origin

Auth email links are generated on `SAPPORTA_PUBLIC_BASE_URL`, for example
`https://app.example.com/api/auth/verify-email`. In split topology, configure
the CDN or frontend host to proxy `/api/auth/*` to the API host. This keeps
email links and post-verification redirects on the app's public origin while the
SPA can still call the full API at `VITE_API_URL`.

### 4. Delete the `serveStatic` block

Dead code in this shape (see the `serveStatic` section).

### 5. Deploy in two halves

- **SPA:** `vite build` → `packages/frontend/dist/`. Upload to the CDN and configure an SPA fallback (`/* → /index.html`) so React Router handles deep links on hard reload.
- **API:** `tsc` → `packages/api/dist/`. Run `node packages/api/dist/boot.js` with `PORT`, `BETTER_AUTH_SECRET`, `SAPPORTA_PUBLIC_BASE_URL`, and any extra `SAPPORTA_FRONTEND_ORIGINS` set.

Fit:

- **Good for:** global CDN delivery of the SPA, independent scaling of the static and API tiers, edge caching, separate frontend and backend deploy cadences.
- **Trade-offs:** the most moving parts, and CORS misconfiguration is the single most common failure mode. Cookie-based auth gets awkward — `SameSite=None`, `Secure`, and matching origin lists are mandatory and strictly enforced. If you're not sure you need this shape, don't start here.

## Environment variables, by shape

| Variable                          | Read from            | Dev | (a)      | (b)      | (c)      | Purpose                                                                       |
| --------------------------------- | -------------------- | --- | -------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `PORT`                            | API host process env | yes | yes      | yes      | yes      | Port Hono binds to. Defaults to `3000`.                                       |
| `FRONTEND_DEV_PORT`               | Dev process env      | yes | —        | —        | —        | Vite dev-server port. Match it to `SAPPORTA_PUBLIC_BASE_URL` in dev.          |
| `BETTER_AUTH_SECRET`              | API host process env | yes | yes      | yes      | yes      | Better Auth signing secret. Generated only for local development.             |
| `SAPPORTA_PUBLIC_BASE_URL`        | API host process env | yes | yes      | yes      | yes      | Public app origin used for Better Auth links, callbacks, and default trust.   |
| `SAPPORTA_FRONTEND_ORIGINS`       | API host process env | yes | yes      | yes      | yes      | Extra browser origins trusted for credentialed API/auth requests.             |
| `SAPPORTA_REQUIRE_VERIFIED_EMAIL` | API host process env | yes | optional | optional | optional | Whether email/password sign-up requires verified email.                       |
| `SAPPORTA_HEALTH_POLICY`          | API host process env | yes | optional | optional | optional | Access policy for health endpoints: `public`, `authenticated`, or `disabled`. |
| `SAPPORTA_MAIL_TRANSPORT`         | API host process env | yes | yes      | yes      | yes      | Mail transport: `stream`, `smtp`, or `disabled`.                              |
| `SAPPORTA_MAIL_FROM`              | API host process env | yes | yes      | yes      | yes      | Default sender address for Better Auth and custom app emails.                 |
| `SMTP_URL`                        | API host process env | —   | optional | optional | optional | SMTP connection URL. Takes precedence over individual SMTP fields.            |
| `SMTP_HOST`                       | API host process env | —   | optional | optional | optional | SMTP host when `SMTP_URL` is not set and mail transport is `smtp`.            |
| `SMTP_PORT`                       | API host process env | —   | optional | optional | optional | SMTP port when `SMTP_URL` is not set and mail transport is `smtp`.            |
| `SMTP_SECURE`                     | API host process env | —   | optional | optional | optional | Whether SMTP uses TLS from connection start. Must be `true` or `false`.       |
| `SMTP_USER`                       | API host process env | —   | optional | optional | optional | SMTP username.                                                                |
| `SMTP_PASS`                       | API host process env | —   | optional | optional | optional | SMTP password.                                                                |
| `VITE_API_URL`                    | Frontend build env   | —   | —        | —        | yes      | Absolute API origin inlined into the SPA bundle for split deployments.        |

### Email delivery

Generated projects use Nodemailer from `packages/api/mailer.ts`. The development
default is `SAPPORTA_MAIL_TRANSPORT=stream`, which does not deliver mail. It
logs the complete generated email source to the API console for every message,
including Better Auth verification/reset emails and custom app emails.

Production should use `SAPPORTA_MAIL_TRANSPORT=smtp` with `SAPPORTA_MAIL_FROM`
set to an address on a verified sending domain. Configure either `SMTP_URL` or
the individual `SMTP_*` fields. Most providers expose SMTP settings; if you want
a provider-specific SDK, edit `packages/api/mailer.ts` in the generated project.

## Operational concerns (shape-independent)

### Database persistence

`better-sqlite3` stores the database under the project's data directory (resolved by `fromProjectRoot` at boot). In production that directory **must** be on a persistent volume, or the database vanishes on every restart — the single most common deployment bug.

- **Docker:** named volume or bind mount at the data directory.
- **systemd on a VPS:** the default filesystem is already persistent; just don't place the project under `/tmp` or a tmpfs mount.
- **Fly.io / Railway / similar:** attach a persistent volume and point the project root at it.

Back up out-of-band (e.g. `sqlite3 db.sqlite .backup /backups/db-$(date +%F).sqlite`, synced to object storage); SQLite gives a consistent snapshot even while Hono is writing.

### Graceful shutdown

`packages/api/boot.ts` handles `SIGINT` and `SIGTERM`: it closes the HTTP server and the SQLite connection, then re-raises the signal so the process exits with the right status. Docker's stop signal, systemd's `ExecStop`, and `Ctrl-C` all drain in-flight requests cleanly — nothing to change.
