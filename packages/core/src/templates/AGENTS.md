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
- `pnpm exec sapporta endpoints list` lists the routes the running API serves.

Prefer the project-local CLI form: `pnpm exec sapporta ...`.

### Running beside other projects

`sapporta init` draws each project's `SAPPORTA_API_PORT` and
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
handler, client entry, and `Welcome` screen with the app feature.

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
`appPublicRoutes`.

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

## More docs

- Sapporta overview: https://github.com/jasim/sapporta#readme
- Schema and migrations: https://github.com/jasim/sapporta/blob/main/docs/schema-and-migrations.md
- Auth and row security: https://github.com/jasim/sapporta/blob/main/docs/auth.md
- CLI: https://github.com/jasim/sapporta/blob/main/docs/cli.md
- Reports: https://github.com/jasim/sapporta/tree/main/docs/reports
