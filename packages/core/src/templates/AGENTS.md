# %%SAPPORTA:NAME%%

This is a Sapporta project. Sapporta is a TypeScript library for building
database applications with schema-as-code table definitions, generated CRUD
APIs, auth-aware row access, and a React app shell.

## Commands

- `pnpm dev` starts the API and frontend in watch mode.
- `pnpm typecheck` typechecks the shared package, API, and frontend. Run it
  after every change. The frontend's `vite build` strips types with esbuild and
  reports no type errors, so `typecheck` is the only check that covers frontend
  code.
- `pnpm build` runs `pnpm typecheck` first, then compiles the shared package,
  API, and frontend.
- `pnpm start` runs the production server after `pnpm build`.
- `pnpm seed` fills the development database with the sample data written in
  `packages/api/seed.ts`. See "Sample data" below.
- `pnpm exec sapporta endpoints list` lists the routes the running API serves.

Prefer the project-local CLI form: `pnpm exec sapporta ...`.

### This project's ports

`pnpm dev` prints both URLs when it starts: the App URL for a browser, and the
API URL for direct HTTP calls. They are also in `.env.development`.

`sapporta init` picks each project's `SAPPORTA_API_PORT` and
`SAPPORTA_FRONTEND_PORT` at random and writes them into `.env.development`, so
projects rarely collide. When a port is taken anyway, `pnpm dev` names the
setting to change: the frontend port is checked before anything starts, and
the API reports its own as it boots. Pick a free port, put it in
`.env.development`, and run `pnpm dev` again.

Changing `SAPPORTA_FRONTEND_PORT` also means changing
`SAPPORTA_PUBLIC_APP_URL`, which is the origin the browser loads the app from
and is what sign-in is accepted from. It carries the frontend port only in
development; a deployment sets it to its own domain.

`pnpm exec sapporta` reads `SAPPORTA_API_PORT` from `.env.development`, so
API-backed commands need no `--api-url`. Pass `--api-url`, or set
`SAPPORTA_API_URL`, only to reach a different deployment.

### What the CLI can reach without an access token

Against the development server started by `pnpm dev`, these read the shape of
the application and need no credential:

- `sapporta endpoints list` — every route, with its method and summary.
- `sapporta endpoints show "POST /api/tables/books"` — one route's parameters,
  request body, and response schemas.

They work because `.env.development` sets `SAPPORTA_OPENAPI_POLICY=public`.
Deployments leave that unset, which keeps the contract behind sign-in.

These read or write data in a workspace, so they need an access token in
`SAPPORTA_API_TOKEN`:

- `sapporta rows list|get|count|create|update|delete`
- `sapporta sql query|execute`
- `sapporta tables list|show|indexes|sample`
- `sapporta api get|post|put|delete`

A token belongs to one user and one workspace, and only a signed-in person can
create one: ask the user to open `/account/profile`, create an agent access
token, and hand you the setup prompt. Do not ask for a token to read the
schema or to change source files — read `packages/api/schema/` directly for
that, or use `endpoints`.

After writing a major code change or addition, use a separate sub-agent or
coding-agent thread to read `CODING-PRINCIPLES.md`, review the written code, and
apply the principles to it. This review and application must happen after the
code has been written, not during the initial implementation.

## Where to make changes

- Tables: add or edit schema files in `packages/api/schema/`, then generate and
  apply a migration.
- Backend routes: add contracts in `packages/shared/src/contracts/`, handlers in
  `packages/api/app/`, and mount them from `packages/api/app.ts`.
- Frontend screens: add routes and navigation in `packages/frontend/src/App.tsx`.
- Browser API calls: add typed clients in `packages/frontend/src/api.ts`.
- Auth and permissions: start in `packages/api/authz/`. Read the auth docs before
  changing row access rules.
- Sample data: write rows in `packages/api/seed.ts`, then run `pnpm seed`.
- Any other command-line script: `openScriptRuntime()` in
  `packages/api/script-runtime.ts`.

## Sample data

`pnpm seed` runs `packages/api/seed.ts` against the development database. It
needs no running server and no access token: it opens the database on this
machine, signs in as the sample-data account named at the top of that file, and
writes through the app's own save path - the same validation, defaults, and row
ownership a request from the browser gets. Apply migrations first, so the
tables being seeded exist.

Write rows by importing a table from `packages/api/schema/` and calling
`demo.rows(table).create({ ... })`. Create parent rows first and take foreign
keys from the returned row. Omit `id`, `created_at`, `updated_at`,
`workspace_id`, and `scoped_to_user_id`: those are generated or stamped from
the account.

The account is created on the first run and signed in to on every run after,
with the password written in `seed.ts`. Guard your own writes so a repeat run
does not add the same rows twice:

```ts
if ((await demo.rows(books).count()) === 0) {
  await demo.rows(books).create({ title: "Dune", author: "Frank Herbert" });
}
```

Sign in as that account to see the seeded data. It lands in the first workspace
the account belongs to, which for a fresh account is the one a browser sign-in
creates for it.

Seeding runs only where `.env.development` sets
`SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING=true` and `NODE_ENV` is not `production`.
Never add that setting to a deployment: the password is in the source, so the
account it creates is a live credential for any database that has it.

Never seed by signing in over HTTP with a hand-written cookie jar or `fetch`
wrapper, and never with raw SQL `INSERT`, which skips validation and ownership
stamping.

## Other command-line scripts

A script that is not sample data - a nightly job, a one-off import, a
maintenance task - uses `openScriptRuntime()` from
`packages/api/script-runtime.ts`:

```ts
const script = await openScriptRuntime({ email, password });
await script.rows(invoices).create({ ... });
script.close();
```

It opens the application with no server around it and signs in as whichever
account that address and password belong to, so the script gets exactly the
row access that person has. It creates nothing and needs no permission
setting: holding the password is the whole credential.

Do not call it from a route, from middleware, or from anything they reach. A
served request already carries the row access it earned, at `c.get("auth")`,
and a route that checks a password is a route that can be asked to check
passwords - the rate limit that protects the sign-in route counts HTTP
requests and does not apply here.

## Reading Sapporta framework source

`@sapporta/*` are installed dependencies; their published declarations carry
every public signature and its doc comments. Resolve a package rather than
writing or globbing a `node_modules` path, and resolve from the workspace
package that declares it — `packages/api` for `@sapporta/server` and
`@sapporta/honest`, `packages/frontend` for `@sapporta/frontend`,
`@sapporta/ui`, and `@sapporta/grid`, either one for `@sapporta/shared`.

```bash
PKG=$(dirname "$(node -p "require.resolve('@sapporta/frontend/package.json', { paths: ['packages/frontend'] })")")
rg -n "tableRecordQueryOptions" "$PKG/dist" --glob '*.d.ts'
```

- Keep `--glob '*.d.ts'`: `dist/` also holds source maps with the whole source
  inlined.
- The `exports` map gives import specifiers, not declaration sites; most symbols
  are re-exported. Grep first, then read the map.
- `frontend`, `ui`, and `grid` also ship `src/`; `server` and `shared` ship only
  `dist/`. The `sapporta:source` entries are for framework development.
- On `ERR_PACKAGE_PATH_NOT_EXPORTED` the install predates that export: resolve
  the bare name and cut at `dist/` instead —
  `node -p "require.resolve('@sapporta/frontend', { paths: ['packages/frontend'] }).replace(/\/dist\/.*/, '')"`
- There is no `node_modules/@sapporta` at the project root, and
  `node_modules/.pnpm/` directory names embed a peer-version hash that changes
  on reinstall.

## Schema and migrations

```bash
pnpm --filter ./packages/api db:generate --name add_table
pnpm --filter ./packages/api db:migrate
pnpm --filter ./packages/api db:check
```

Review generated SQL before applying it. The server checks migration readiness at
startup, validates table definitions, and does not apply migrations
automatically.

## Backend routes

App-owned API routes are served under `/api`.

For a typed custom endpoint, keep the wire shape in `packages/shared`, the
handler in `packages/api/app`, and the browser client in
`packages/frontend/src/api.ts`.

The `/api/hello` example shows the usual route shape:

1. `packages/shared/src/contracts/foo.ts`: declare the request and response
   contract. Re-export it from `packages/shared/src/contracts/index.ts`, which
   is re-exported by `packages/shared/src/index.ts`.
2. `packages/api/app/foo.ts`: register the contract and handler with
   `api.register(...)`, then default-export the route app.
3. `packages/frontend/src/api.ts`: pass the contract to
   `createApiClient(contract, { baseUrl: getApiBase })`.

Because both sides import the same contract, request and response types stay in
sync. When the app's real API calls are in place, replace the `hello` contract,
handler, client entry, and `Home` screen with the app feature.

When adding a new route file under `packages/api/app/`, mount it in
`packages/api/app.ts`; files are not exposed automatically. Add a route to
`publicApiRoutes` only when anonymous visitors should be able to call it.

## Auth and row access

Apply auth scope on the server. Generated table endpoints apply row visibility
for you. Custom code should choose the route's ability and data authority, then
use row-scoped helpers for ordinary table work.

Do not trust clients to choose workspace, owner, role, or scope columns. Raw SQL
bypasses row helpers and should be a fallback, not the default mutation path.

## Analytical questions

Use an existing report or domain endpoint when it defines the business meaning
of a question. Otherwise use `pnpm exec sapporta rows count` for filtered,
single-table counts. State how terms such as "pending" map to stored values.

Use `--group-by`, `--order`, and `--limit` for bounded grouped counts, and use a
separate lookup for foreign-key labels. If a scoped count cannot express the
question without loading complete rows, add an application-owned report or
domain endpoint.

## Email

This project uses Nodemailer through `packages/api/mailer.ts`.
`createSapportaMailer()` returns the Nodemailer transport, parsed defaults, and
a `sendMail()` helper.

`packages/api/app.ts` receives the mailer in `loadApp()` options. Routes can use
it directly or pass it into domain modules without importing auth internals.

In development, `SAPPORTA_MAIL_TRANSPORT=stream` logs the complete generated
email source to the API console instead of delivering it. Production SMTP setup
is documented in `DEPLOYMENT.md`.

## Frontend

The frontend uses React, Vite, Tailwind, `@sapporta/ui`, shadcn/ui conventions,
Base UI primitives, TanStack Form, and TanStack Query. Prefer existing Sapporta
UI components and local patterns before adding new component abstractions. Use
lucide icons for icon buttons when an appropriate icon exists.

The generated frontend mounts one `QueryClientProvider` in
`packages/frontend/src/main.tsx`. That file is framework-owned boot wiring.
Reuse its provider, and keep application-wide cache policy in the
workspace-owned `packages/frontend/src/query-client.ts`. Customize
`query-client.ts`, not `main.tsx`. Use
`tableRecordQueryOptions()`, `tableRecordsPageQueryOptions()`, and
`tableQueryKeys` from `@sapporta/frontend/table/query` for generated table
reads. App-owned endpoints use an application-owned query-key namespace. Do not
copy table records into `useEffect`/`useState` loaders or create a second generic
table client.

Use TanStack Form for application form state. Compose standard table fields
with Sapporta's public form surface, including `FormField`,
`buildRecordFormFields()`, and `parseCreateDraft()`. Use
`FormSubmissionError`, `fieldIssuesForSubmissionError()`, and
`firstFormErrorMessage()` from `@sapporta/frontend/form` for local and API field
errors instead of adding an application-wide error parser.

After a successful mutation, invalidate every affected TanStack Query cache
before navigation or closing the form. Invalidate
`tableQueryKeys.table(tableName)` when a generated-table mutation can affect a
record and its paginated lists. TGrid sessions use a separate data source, so
also call `reloadTGridRows(tableName)` for each affected table that may have a
mounted Grid.

When designing user interfaces, follow `VISUAL-DESIGN-GUIDELINES.md`.

Protected app routes live in `appProtectedRoutes`; public routes live in
`appPublicRoutes`. `/` opens `appHomeRoute` for signed-in users; fill
`appPublicHomeRoute` instead when `/` should open for anyone.

## Shared package

`packages/shared/` is a leaf package. Both the API and frontend may depend on
it; it must not depend on either of them.

Put these things in shared:

- API contracts and wire-format request/response types.
- Shared value types used by both API handlers and UI state.
- Pure serializers, parsers, and constants for those shapes.

Do not put React components, Hono handlers, Drizzle queries, database access, or
other I/O in shared.

Use Temporal for time and date work. Do not use `Date`, `dayjs`, or `date-fns`
for parsing, arithmetic, comparison, or formatting.

## Days and time zones

Timestamps are stored as UTC. A day is a calendar day in the active
workspace's time zone, which every workspace keeps as an IANA id and an owner
changes on the workspace settings screen.

Never ask the machine what time zone it is in or what day it is.
`Temporal.Now.plainDateISO()` with no argument and `Temporal.Now.timeZoneId()`
both read the host's `TZ`, so a report built on either returns different rows
depending on how the container was started. A test fails the build if you call
them.

Read the zone in an API handler with `workspaceTimeZone(c.get("auth"))`, and in
a React screen with `appTimeZone()` from `@sapporta/frontend/platform`. Pass a
`Temporal.Instant` wherever a handler needs "now".

Bound a day-ranged filter with `resolveDateRangeQueryBounds`, and group by
local day with the `to_tz_date(column, :zone)` SQL function. The bounds come
back in both shapes: use `period.instants` against a `timestamp` column and
`period.days` against a `date` column.

```ts
const zone = workspaceTimeZone(c.get("auth"));
const period = resolveDateRangeQueryBounds(
  "period",
  request.query,
  zone,
  Temporal.Now.instant(),
);
// ... WHERE (:from IS NULL OR created_at >= :from)   -- period.instants
//       AND (:until IS NULL OR created_at <  :until)
//     GROUP BY to_tz_date(created_at, :zone)
```

The instant window's upper bound is exclusive. A closed bound compared against
a `timestamp` column drops its own last day, and one built from a wall clock
such as `23:59:59` loses an hour on the day a zone leaves daylight saving.

`to_tz_date` is supplied by the database driver, so a `sqlite3` shell does not
have it. It costs about 6µs a row — some thirty times SQLite's own `date(col)`,
which is what a zone database costs — so bound the range in the `WHERE` clause
before grouping. On a database with its own zone support it becomes a one-line
substitution, such as PostgreSQL 16's `date_trunc('day', ts, tz)`.

A report whose numbers depend on the zone should name it. `ReportTimeZoneNote`
from `@sapporta/frontend/report` renders it for the toolbar.

## More docs

- Sapporta overview: https://github.com/jasim/sapporta#readme
- Schema and migrations: https://github.com/jasim/sapporta/blob/main/docs/schema-and-migrations.md
- Auth and row security: https://github.com/jasim/sapporta/blob/main/docs/auth.md
- CLI: https://github.com/jasim/sapporta/blob/main/docs/cli.md
- Reports: https://github.com/jasim/sapporta/tree/main/docs/reports
