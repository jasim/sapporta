# __NAME__

A Sapporta project.

## Commands

- `pnpm dev` — start backend and frontend in watch mode
- `pnpm build` — compile shared + backend (`tsc`) and bundle frontend (`vite build`)
- `pnpm start` — run the production server (serves API and SPA on one port)
- `pnpm --filter ./packages/api db:generate --name add_table` — generate Drizzle SQL migrations from schema changes
- `pnpm --filter ./packages/api db:migrate` — apply pending Drizzle migrations

`pnpm dev` loads `.env.development` with Node's built-in `--env-file` support.
That file contains local-only auth defaults, including a generated
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`, and
`FRONTEND_DEV_PORT=5173`. It also sets `SAPPORTA_MAIL_TRANSPORT=stream`,
so Nodemailer prints the full generated email source to the API console instead
of delivering it. It is ignored by git.

## Project layout

```
packages/api/       backend — boot.ts, app.ts, schema/, app/, reports/
packages/frontend/  SPA — Vite + React, imports @sapporta/frontend and @sapporta/ui CSS
packages/shared/    ts-rest contracts + types shared by backend and frontend
```

`packages/shared/` is a workspace package (`__SLUG__-shared`). Both `packages/api/` and `packages/frontend/src/` depend on it; it depends on neither. See [`packages/shared/CLAUDE.md`](./packages/shared/CLAUDE.md) for what belongs there.

## Adding an API endpoint

The starter `/api/hello` route shows the pattern. Each endpoint is a trio:

1. **`packages/shared/src/contracts/foo.ts`** — declare a ts-rest contract router (request/response schemas, path, method). One source of truth for the wire shape; re-export it from `packages/shared/src/contracts/index.ts` (which `packages/shared/src/index.ts` barrels through).
2. **`packages/api/app/foo.ts`** — `api.register("foo", contract.foo, handler)`, default-exported. Mount it in `packages/api/app.ts`'s `loadApp()` with `app.route("/", fooApi)`; it's served under `/api`.
3. **`packages/frontend/src/api.ts`** — pass the contract to `createApiClient(contract, { baseUrl: getApiBase })`. Frontend code calls `customApi.foo()` and gets a fully typed response or throws `ApiError`.

Because both sides import the same contract, request and response types can never drift — change the contract once and both ends light up red until they match.

Delete the `hello` trio (`packages/shared/src/contracts/hello.ts`, `packages/api/app/hello.ts`, `packages/frontend/src/api.ts` entry, sidebar/Welcome wiring) once your own routes take over.

## Email

Generated projects use Nodemailer. `packages/api/mailer.ts` exports
`createSapportaMailer()`, which returns a small project mailer object containing
the raw Nodemailer `transport`, parsed defaults, and a `sendMail()` helper.
`packages/api/app.ts` receives that mailer in `loadApp()` options, so routes can
use it directly or pass it into domain modules without importing auth internals.

In development, `SAPPORTA_MAIL_TRANSPORT=stream` uses Nodemailer's stream
transport. Every call to `sendMail()` runs through Nodemailer's normal message
pipeline and logs the complete generated email source to the API console,
including Better Auth verification/reset messages and custom app messages.

In production, set `SAPPORTA_MAIL_TRANSPORT=smtp`, `SAPPORTA_MAIL_FROM`, and
either `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`.
Most providers, including SES, Postmark, Resend, SendGrid, Mailgun, and standard
mail hosts, publish SMTP settings. If you prefer a provider SDK, edit
`packages/api/mailer.ts`; Sapporta does not hide email delivery behind a
framework abstraction.

## Schema and migrations

Schema files live in `packages/api/schema/`. Export both the raw Drizzle table object and the Sapporta wrapper:

```ts
export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  name: text("name").notNull(),
});
export const accounts = table({
  drizzle: accountsTable,
  meta: { label: "Accounts" },
});
```

Change schema, run Drizzle Kit generate, review SQL, run Drizzle Kit migrate, start server. The server checks migration readiness at boot but never applies migrations.

## Running multiple projects on one machine

Each backend binds to `PORT` from `.env.development` (default `3000`) and each
Vite dev server binds to `FRONTEND_DEV_PORT` (default `5173`). To run several
Sapporta projects side-by-side, give each project its own pair:

```env
PORT=3001
BETTER_AUTH_URL=http://localhost:3001
FRONTEND_DEV_PORT=5174
```

`packages/frontend/vite.config.ts` reads the same `PORT` variable to point its `/api`
proxy at the right backend, and reads `FRONTEND_DEV_PORT` for its own port. The
API trusts `http://localhost:${FRONTEND_DEV_PORT}` in development. `VITE_API_URL`
is not needed in development because frontend code calls relative `/api/*` URLs
through Vite's proxy.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the three supported deployment
shapes (single process, reverse proxy, split topology with CDN + separate
API host), and the env vars each one needs.
