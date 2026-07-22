# %%SAPPORTA:NAME%%

This is a Sapporta project. Sapporta is a TypeScript library for building
database applications with schema-as-code table definitions, generated CRUD
APIs, auth-aware row access, and a React app shell.

## Commands

- `pnpm dev` starts the API and frontend in watch mode.
- `pnpm build` compiles the shared package, API, and frontend.
- `pnpm start` runs the production server after `pnpm build`.
- `pnpm exec sapporta endpoints list` inspects the running API.

Prefer the project-local CLI form: `pnpm exec sapporta ...`.

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
