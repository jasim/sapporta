# %%SAPPORTA:NAME%%

This is a Sapporta-based project: a pnpm workspace with a Hono API, React frontend, 
and a shared package for contracts. Sapporta supplies schema-as-code table definitions, 
generated CRUD APIs, auth-aware row access, and a React app shell.

`CODING-PRINCIPLES.md` - for coding style, and
`VISUAL-DESIGN-GUIDELINES.md` for UX. After writing a
major change or addition, use a separate sub-agent or coding-agent thread to
read `CODING-PRINCIPLES.md`, review the written code, and apply the principles
to it. That review happens after the code is written, not during the initial
implementation.

## Commands

| Command                             | Does                                              |
| ----------------------------------- | ------------------------------------------------- |
| `pnpm dev`                          | API and frontend in watch mode; prints both URLs  |
| `pnpm typecheck`                    | Typechecks shared, API, and frontend              |
| `pnpm build`                        | Runs `typecheck`, then compiles all three         |
| `pnpm start`                        | Production server, after `pnpm build`             |
| `pnpm seed`                         | Writes `packages/api/seed.ts` into the dev database |
| `pnpm exec sapporta endpoints list` | Lists the routes the running API serves           |

Run `pnpm typecheck` after every change. `vite build` strips types with esbuild
and reports no type errors, so it is not a type check.

A schema change generates and applies its own migration:

```bash
pnpm --filter ./packages/api db:generate --name add_table
pnpm --filter ./packages/api db:migrate
pnpm --filter ./packages/api db:check
```

Review the generated SQL before applying it. The server checks migration
readiness at startup and never applies migrations itself.

## Ports

`sapporta init` picked this project's `SAPPORTA_API_PORT` and
`SAPPORTA_FRONTEND_PORT` at random and wrote them into `.env.development`, and
`pnpm dev` prints both as URLs when it starts. On a collision, change the value
there and run `pnpm dev` again. Changing the frontend port also means changing
`SAPPORTA_PUBLIC_APP_URL`, which is the origin the browser loads the app from
and the origin sign-in is accepted from.

Prefer the project-local CLI form, `pnpm exec sapporta ...`. It reads
`SAPPORTA_API_PORT` from `.env.development`, so API-backed commands need no
`--api-url`; pass one only to reach a different deployment.

## Where changes go

- **Tables, columns, relations, indexes, search** — `packages/api/schema/`,
  then generate and apply a migration.
  https://sapporta.com/docs/guides/model-data/tables-columns-and-schema-metadata.md
- **Backend routes** — contract in `packages/shared/src/contracts/`, handler in
  `packages/api/app/`, mounted from `packages/api/app.ts`. The `/api/hello`
  files show the shape end to end.
  https://sapporta.com/docs/guides/application-code/custom-api-endpoints.md
- **Auth, abilities, row access** — `packages/api/authz/`.
  https://sapporta.com/docs/guides/security/authentication-and-abilities.md
- **Frontend routes and navigation** — `packages/frontend/src/App.tsx`.
  https://sapporta.com/docs/guides/application-code/frontend-routes-navigation-and-layout.md
- **Browser API calls** — typed clients in `packages/frontend/src/api.ts`.
  https://sapporta.com/docs/guides/application-code/typed-api-clients.md
- **Cache policy and post-mutation refresh** —
  `packages/frontend/src/query-client.ts`; `main.tsx` is boot wiring and is not
  the place for application policy.
  https://sapporta.com/docs/guides/application-code/cached-table-reads-and-refresh.md
- **Custom forms and validation** — `packages/frontend/src/`.
  https://sapporta.com/docs/guides/application-code/custom-forms-and-validation.md
- **Reports** — shared contract, backend route, frontend screen, navigation.
  https://sapporta.com/docs/guides/reports/route-based-reports.md
- **Sample data** — rows in `packages/api/seed.ts`, then `pnpm seed`. Any
  other command-line script uses `openScriptRuntime()` in
  `packages/api/script-runtime.ts`.
  https://sapporta.com/docs/guides/operations/sample-data-and-scripts.md
- **Email** — `packages/api/mailer.ts`, handed to `loadApp()` from
  `packages/api/app.ts`.
  https://sapporta.com/docs/guides/operations/email-and-runtime-services.md
- **Runtime settings** — `.env.development`.
  https://sapporta.com/docs/reference/project/environment-variables.md

`packages/shared/` is a leaf package. The API and frontend may import it; it
must not import either of them, and it holds no React, Hono, Drizzle, or other
I/O. `packages/shared/AGENTS.md` owns the rest of that boundary. A file under
`packages/api/app/` is inert until `packages/api/app.ts` mounts it; add a route
to `publicApiRoutes` only for anonymous callers.

The frontend uses React, Vite, Tailwind, `@sapporta/ui`, shadcn/ui conventions,
Base UI primitives, TanStack Form, TanStack Query, and lucide icons. Prefer the
existing Sapporta components and local patterns to new abstractions.

## Invariants

- Apply auth scope on the server. Generated table endpoints apply row
  visibility for you; custom code chooses the route's ability and data
  authority and then uses row-scoped helpers. Never let a client choose
  workspace, owner, role, or scope columns. Raw SQL is a fallback, not the
  default mutation path.
  https://sapporta.com/docs/reference/server/row-scoped-data-helpers.md
- A day is a calendar day in the active workspace's time zone, which the
  workspace stores as an IANA id. Never ask the machine what zone or day it is:
  `Temporal.Now.timeZoneId()` and argless `Temporal.Now.plainDateISO()` read
  the host's `TZ`, and a test fails the build for either. Read the zone with
  `workspaceTimeZone(c.get("auth"))` on the server and `appTimeZone()` from
  `@sapporta/frontend/platform` in a screen.
  https://sapporta.com/docs/reference/server/days-and-time-zones.md
  Bounding a date range and grouping by local day:
  https://sapporta.com/docs/guides/reports/group-and-filter-by-day.md
- Use Temporal for all time and date work. Do not use `Date`, `dayjs`, or
  `date-fns` to parse, compare, format, or do arithmetic.
- Seed and script through the app's own save path — `pnpm seed`, or
  `openScriptRuntime()` for anything else. Never seed over HTTP with a
  hand-written cookie jar, and never with raw SQL `INSERT`, which skips
  validation, defaults, and ownership stamping. Both runtimes hand back
  `rows(table)` for one table, and `db` and `auth` for a domain workflow, which
  takes the same pair a route passes it. The seeded workspace keeps the time
  zone of the machine that ran the seed. Never call `openScriptRuntime()` from
  a route, from middleware, or from anything they reach; a served request
  already carries its row access at `c.get("auth")`.
  https://sapporta.com/docs/guides/operations/sample-data-and-scripts.md
- Do not ask for an access token to read the schema or to change source files.
  Read `packages/api/schema/` directly, or use `endpoints list` and
  `endpoints show`, which need no credential against `pnpm dev`. Only `rows`,
  `sql`, `tables`, and `api` need `SAPPORTA_API_TOKEN`, and only a signed-in
  person can create one from `/account/profile?token=new`.
  https://sapporta.com/docs/guides/security/agent-access-and-scoped-tokens.md
- `@sapporta/*` are installed dependencies. Resolve one from the workspace
  package that declares it rather than hand-writing or globbing a
  `node_modules` path; a generated project has no root `node_modules/@sapporta`
  and `.pnpm/` directory names change on reinstall.

## Documentation

- All docs: https://sapporta.com/docs.md
- Guides: https://sapporta.com/docs/guides.md
- Reference: https://sapporta.com/docs/reference.md
- Project file map:
  https://sapporta.com/docs/reference/project/project-files.md
- Working with a coding agent:
  https://sapporta.com/docs/guides/discovery/develop-with-a-coding-agent.md
- CLI: https://sapporta.com/docs/guides/discovery/use-the-sapporta-cli.md
- Troubleshooting:
  https://sapporta.com/docs/guides/operations/troubleshooting.md
- Deployment: `DEPLOYMENT.md` in this project.
