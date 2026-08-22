# Architecture

This is the map of the Sapporta codebase: what each package is for, what
modules it exposes, and the rules that keep the layering intact. Read this
before opening source. AGENTS.md holds the working instructions; this file
holds the structure.

## Two Axes

Sapporta code is organized along two independent axes. Keeping them separate
makes the rest of the layout legible.

**Where the code runs.** The workspace packages answer this:

- Server only: `@sapporta/server`, `@sapporta/honest`
- Browser only: `@sapporta/frontend`, `@sapporta/grid`, `@sapporta/ui`
- Both: `@sapporta/shared` (pure TypeScript, no runtime dependencies)

**How the code reaches an application.** Every line of a generated project
arrives in one of three ways:

- **Imported.** Library code the project depends on through `@sapporta/*`
  packages. All real behavior lives here.
- **Copied, framework-owned.** Glue files written into the project by
  `sapporta init` and overwritten by a scaffold refresh: `boot.ts`,
  `main.tsx`, `project-auth/` (except `options.ts`), `mailer.ts`. The
  project can read and edit them, but Sapporta considers them its own.
- **Copied, user-owned.** Files the project author is expected to edit:
  starter examples (`app.ts`, `authz/`, sample contracts) and workspace
  files (`package.json`, env files, docs). A refresh never overwrites
  workspace files.

The single source of truth for the third axis is the scaffold manifest at
[packages/core/src/cli/init-project/scaffold-manifest.ts](packages/core/src/cli/init-project/scaffold-manifest.ts),
where every generated file carries an ownership of `framework`, `example`,
or `workspace`.

## Packages and Layering

```
packages/cli/           sapporta — npx-able wrapper whose bin re-exports @sapporta/server/cli
packages/core/          @sapporta/server — schema-as-code tables, row engine, CRUD/meta APIs, CLI, and the project scaffold templates
packages/honest/        @sapporta/honest — Hono + ts-rest adapter for contract routing, request parsing, and OpenAPI output
packages/shared/        @sapporta/shared — leaf package: wire contracts, filter/query grammars, and pure helpers shared by server and browser
packages/grid/          @sapporta/grid — GridCore (the backend-agnostic grid engine), column presets, and lookup primitives
packages/frontend/      @sapporta/frontend — Sapporta-bound admin frontend: app shell, table and report pages, auth screens, boot wiring
packages/ui/            @sapporta/ui — UI primitives (Base UI wrappers) and small React utilities
```

Dependency direction (an arrow means "may import from"):

```
@sapporta/frontend  →  @sapporta/grid, @sapporta/ui, @sapporta/shared
@sapporta/grid      →  @sapporta/ui, @sapporta/shared
@sapporta/server    →  @sapporta/honest, @sapporta/shared
sapporta (cli)      →  @sapporta/server
```

`@sapporta/shared`, `@sapporta/ui`, and `@sapporta/honest` import nothing
else in the workspace. Nothing in `@sapporta/grid` may import Sapporta
backend concepts; its data sources take injected endpoint factories.

## Modules

A module is a subpath in a package's `exports` map — `@sapporta/server/table`
and `@sapporta/shared/contracts` are modules the way `List` and `Dict` are
modules of `elm/core`. The tables below are the module index for each
package. `scripts/check-module-index.mjs` asserts these tables stay in sync
with the actual `exports` maps, so a new subpath must be documented here to
pass checks. The `./package.json` export and the `sapporta:source` build
condition are plumbing, not modules, and are not listed.

### @sapporta/shared — packages/shared

| Module | Purpose |
| --- | --- |
| `.` | Barrel of the pure value helpers: filter grammar, query params, value kinds, temporal and date-range helpers, CSV, record ids, row scopes, labels, counts, validation |
| `./contracts` | ts-rest route definitions and Zod wire schemas for the table, meta, and auth APIs; re-exports `initContract` so consumers avoid a direct `@sapporta/rest-core` dependency |
| `./filter` | Filter operator vocabulary shared by the server query grammar and grid filtering |
| `./value-kind` | Classification of column values used by formatting and filtering |
| `./temporal` | Date/time helpers over the Temporal polyfill |
| `./daterange` | Date-range model and picker key space |
| `./csv` | CSV serialization |
| `./grid-dataset` | Zod schema of the report-grid wire format: columns, levels, footer rows, color rules |
| `./record-id` | `RecordId` — a primary-key value in an address position (URL, query key), and `toRecordId` for crossing into one |
| `./row-scope` | Row-scope column-name constants (`workspace_id`, `scoped_to_user_id`) |
| `./error` | `ApiError` |
| `./validation` | API problem shapes, bounded integers, field issues |
| `./client` | `createApiClient` — typed fetch client over the contracts that throws `ApiError` on non-2xx |

The root barrel carries only pure value helpers. The structural modules —
`contracts`, `grid-dataset`, `client` — are subpath-only by design: they are
imported deliberately, at the few places that wire the API boundary, and
keeping them out of the barrel keeps casual root imports lightweight.

### @sapporta/server — packages/core

| Module | Purpose |
| --- | --- |
| `.` | Runtime surface consumed by a project's `boot.ts` and endpoint code: project loading and mounting, middleware installers, `scopedRows`, the auth mechanism (principals, abilities, row scopes), and API re-exports |
| `./table` | Column builders and the `sapportaTable` wrapper used by schema files |
| `./errors` | The error vocabulary: `ErrorCode`, `OperationError`, validation and query-parse error classes, SQLite error classification |
| `./testing` | `createTestDb` and `createTestConnection` — in-memory SQLite databases with production PRAGMA settings for tests |
| `./create-project` | Programmatic project creation — the engine behind `sapporta init` |
| `./source-link-runtime` | Node module-resolution preload for source-linked development |
| `./cli` | The `sapporta` command (side-effectful main) |
| `./cli/commands` | Command registry and implementations |
| `./cli/client` | Typed client the CLI uses to talk to a running app |
| `./cli/http-client` | HTTP plumbing for the CLI client |
| `./cli/format` | CLI output formatting |
| `./cli/render` | CLI table/record rendering |

### @sapporta/honest — packages/honest

| Module | Purpose |
| --- | --- |
| `.` | `TsRestApi` (a Hono subclass) that mounts ts-rest contracts with one-schema request parsing, OpenAPI 3.1 emission, and `registerFamily` for route sets resolved at runtime |

### @sapporta/grid — packages/grid

| Module | Purpose |
| --- | --- |
| `.` | GridCore public surface — the base grid engine — with the stylesheet imported as a side effect |
| `./advanced` | Runtime escape hatches: phantom-row lifecycle, cursor manager, controller internals |
| `./column-preset` | Typed column constructors (`text`, `currency`, `date`, `foreignKey`, …), display formatting, cells and editors, header chrome, column sizing |
| `./lookup` | Lookup value and search caches |
| `./lookup/react` | React bindings for lookups |
| `./index.css` | Compiled stylesheet |

### @sapporta/frontend — packages/frontend

| Module | Purpose |
| --- | --- |
| `.` | Barrel of the modules below |
| `./app` | Boot loader, home redirect and not-found views, router bridge, navigation actions |
| `./platform` | API origin configuration, fetch wrapper, the typed `uiClient`, localStorage preferences |
| `./form` | Submission-error mapping for forms |
| `./schema` | Schema catalog: metadata fetch actions and store |
| `./auth` | Full auth surface: gates, session store, and page components |
| `./auth/runtime` | Gates and session store without page components |
| `./auth/pages` | Login, signup, and password-reset pages |
| `./auth/profile` | Account profile and change-password pages |
| `./routes/table` | Table screen route components |
| `./routes/new-record` | New-record form route |
| `./table/query` | Table query options and URL state |
| `./report` | Report pages: grid-dataset rendering, report chrome, summary stats, date-range params |
| `./lookup` | `LookupPicker` and the lookup source bound to the Sapporta API |
| `./layout` | `Page`, `PageHeader`, and page-level chrome |
| `./shell` | `AppShell`, sidebar, status bar, account menu |
| `./index.css` | Compiled stylesheet |

### @sapporta/ui — packages/ui

| Module | Purpose |
| --- | --- |
| `.` | Barrel of all primitives and utilities |
| `./alert-dialog` | Alert dialog primitive |
| `./badge` | Badge primitive |
| `./button` | Button primitive |
| `./checkbox` | Checkbox primitive |
| `./context-menu` | Context menu primitive |
| `./dialog` | Dialog primitive |
| `./input` | Input primitive |
| `./label` | Label primitive |
| `./popover` | Popover primitive |
| `./sheet` | Sheet primitive |
| `./switch` | Switch primitive |
| `./tooltip` | Tooltip primitive |
| `./combobox` | Combobox styles and behavior |
| `./kbd` | Keyboard-key chip |
| `./param-pill` | Parameter pill |
| `./cn` | Class-name merge helper |
| `./use-debounce` | Debounce hook |
| `./index.css` | Compiled stylesheet |

### sapporta — packages/cli

No exports map. The package publishes only `bin/sapporta.mjs`, which
re-exports `@sapporta/server/cli` so that `npx sapporta` resolves to a
friendly name.

## The Grid Layer Stack

The data-grid code forms three layers, from generic to Sapporta-specific:

1. **GridCore** — `packages/grid/src/core/`. The base grid engine:
   framework-agnostic rows, columns, selection, editing, and data sources,
   unopinionated and tied to no backend. Domain features are out of scope
   by charter (see the essay in `packages/grid/src/core/index.ts`); data
   attaches through `column.meta` and injected endpoint factories.
2. **ColumnPreset** — `packages/grid/src/column-preset/`. Typed column
   constructors with formatting, cells, editors, and header chrome, built on
   GridCore's types.
3. **TGrid** — `packages/frontend/src/table/tgrid/`. The Sapporta-bound
   table grid: compiles a `TableSchema` from `@sapporta/shared/contracts`
   into grid schemas, and manages table sessions, query state, and the
   bound `TGrid` view component. The rest of `packages/frontend/src/table/`
   is the layer above it — the standard table screens (routes, page chrome,
   filters, forms) composed on top of TGrid sessions.

Reports ride a parallel path: the server produces a `GridDataset`
(`@sapporta/shared/grid-dataset`), which `@sapporta/frontend`'s report
module renders on GridCore via `ReportGridDataset`.

## Conventions

- **Subpath exports are the module system.** Adding a public module means
  adding an `exports` subpath and a row in the tables above. Every JS
  export carries `types`, `sapporta:source`, and `default` conditions
  (enforced by `tests/package-exports.test.ts`); the
  `sapporta:source` condition lets development builds resolve workspace
  sources directly.
- **Mechanism in the library, glue in the project.** Behavior belongs in a
  package; generated projects receive only thin, readable wiring plus
  clearly marked starter code. When a scaffold file grows real logic, the
  logic should move into a package and leave the file as glue.
- **`@sapporta/shared` stays a leaf.** If code there needs the server or
  the UI, the abstraction belongs on the other side of the boundary.
