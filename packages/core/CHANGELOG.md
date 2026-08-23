# @sapporta/server

## 0.5.0

### Minor Changes

- 306bfaa: `pnpm dev` now prints both of a project's development URLs as it starts, and
  `sapporta init` prints the same pair when it finishes. Each project has had its
  own random ports since they stopped being fixed at 3000 and 5173, but a reader
  had to find them: the frontend URL arrived in Vite's banner, the API reported a bare
  port number several seconds later among the compiler output, and neither said
  where the numbers came from. Each line now names what its URL is for — the App
  URL to open in a browser, the API URL to call directly from scripts and coding
  agents — and both name `.env.development` as the file that holds them. The API's
  own ready line reports a URL rather than a bare port.

### Patch Changes

- Improve port management of new projects
- Updated dependencies
  - @sapporta/honest@0.3.11
  - @sapporta/shared@0.2.4

## 0.4.0

### Minor Changes

- 45e8a8a: The scaffold now uses Better Auth 1.7. That release keys accounts on
  `(issuer, accountId)` and so requires an `account.issuer` column, which the
  generated auth schema did not carry: a new project resolved `^1.6.21` to 1.7.1
  and every sign-up failed with `The field "issuer" does not exist in the
"account" Drizzle schema`.

  `@sapporta/server` now declares `better-auth` as a tilde range, so a generated
  project stays on the minor line that `project-auth/schema.ts` was generated
  for. Better Auth adds columns in minor releases, and that schema is what a
  project's migrations are generated from.

  The project's own `personalAccessToken` table moves out of the generated
  `project-auth/schema.ts` and into `project-auth/auth-tokens-schema.ts`, which
  `drizzle.config.ts` reads alongside it. The generated file is now regenerated
  whole without losing the table.

- c576648: `loadSapportaProject` now runs auth schema validation itself, after the
  structural checks and before search plans compile. Previously the boot
  template called `assertAuthSchemaDefinitions` after loading the project,
  which was too late: search-plan compilation resolves the same reference
  metadata and failed on the first reference problem, hiding the aggregated
  "Auth schema validation failed" report. The generated `boot.ts` no longer
  needs its own call; existing projects that still call
  `assertAuthSchemaDefinitions` keep working — the check is simply redundant
  there now.
- 7f49d7d: Consolidate the error vocabulary into the `@sapporta/server/errors`
  module. `ErrorCode`, `ErrorCodeValue`, and `OperationError` — previously
  internal to an introspection types file — now live alongside
  `ValidationError`, `QueryParseError`, and SQLite error classification in
  the one errors module. Existing imports from `@sapporta/server/errors`
  and the root export are unchanged; the module simply exposes the full
  vocabulary now.
- 3bcfd52: `/` now opens a screen behind `AuthGate`. The generated `App.tsx` exported
  `appHomeRoute` outside the gate, and the shipped default was a redirect to
  `/welcome`, so the gate caught anonymous visitors one hop later and nothing
  looked wrong. A project that put a real home page in that slot — which the
  app-building guidance asks for — served it to visitors without a session.

  `appHomeRoute` now renders inside the gate and holds the home screen itself:
  `Welcome.tsx` becomes `Home.tsx`, `/` opens it, and `/welcome` is gone, so
  signing in lands on the home page without a redirect hop. A new
  `appPublicHomeRoute` export takes an index route for an app that wants `/` open
  to everyone; filling it opens `/` in place of `appHomeRoute`, so one of the two
  owns `/` and the other is unreachable there.

  A project owns `App.tsx` and keeps its own copy when it updates Sapporta, while
  `SapportaApp.tsx` is replaced and reads both slots. To take the change, add
  `export const appPublicHomeRoute: ReactElement | null = null;` to `App.tsx` and
  move the home screen from a redirect into `appHomeRoute`.

- 6709057: A generated project now has a `typecheck` command, and `pnpm build` runs it.

  `packages/frontend` built with a bare `vite build`, which strips types with
  esbuild and never typechecks, and the package shipped no `typecheck` script. So
  `pnpm build` reported success on frontend code carrying real type errors, and
  nothing in the project named a command that would find them — two separate
  agent sessions had to construct `tsc --noEmit` themselves, then found four and
  nine errors that a green build had hidden.

  `packages/frontend` gains `typecheck: "tsc --noEmit"`. Unlike the API it needs
  no `pretypecheck`: its tsconfig maps the workspace shared package to
  `../shared/src`, not `../shared/dist`, so it typechecks without a prior build.
  The root gains a `typecheck` that fans out to shared, API, and frontend.

  Root `build` now runs `pnpm typecheck` first, so a type-broken frontend fails
  the build instead of passing it, and fails before anything is emitted rather
  than leaving a stale `packages/frontend/dist` behind. This costs a `--noEmit`
  pass over shared and API before the emitting one; a clean scaffold builds in
  about 11s where it took about 5s.

  Existing projects are unaffected. The scaffold refresh deliberately never
  rewrites an existing project's `scripts`, so a project generated before this
  release picks the commands up only by hand.

- 0b872d2: Move test utilities off the root export and onto a dedicated
  `@sapporta/server/testing` subpath. `createTestDb` no longer ships on
  the production surface of `@sapporta/server`; import it (and the newly
  public `createTestConnection`) from `@sapporta/server/testing` instead.

### Patch Changes

- Improvements after comparing agentic build of sample projects
- bea3cab: `sapporta init` now requires pnpm 11 or later and fails with a clear message on
  older versions. The generated project keeps its workspace settings in
  `pnpm-workspace.yaml`, which pnpm 10 and earlier ignore, and its root
  package.json no longer carries a `pnpm` field that pnpm 11 would ignore.

  Source-linked scaffolds write their dependency overrides into
  `pnpm-workspace.yaml` as well; pnpm 11 dropped support for the `pnpm` field in
  the root package.json, so those overrides were silently inert. The override set
  also gains `kysely` and `@types/better-sqlite3`: both are optional peers of
  drizzle-orm, so a version drift between the generated project and the linked
  checkout split drizzle-orm into two package identities and every drizzle type
  into two incompatible declarations.

- Updated dependencies
  - @sapporta/honest@0.3.10
  - @sapporta/shared@0.2.3

## 0.3.2

### Patch Changes

- 7f9750c: Name the browser tab after the current screen. `PageHeader` now sets the
  document title to "<page> – <app name>" from the same `title` it displays, so
  tables, reports, forms, and account pages each leave a readable entry in tab
  lists and browser history. The app name comes from the loaded project info,
  falling back to the title in index.html. Screens without the standard header
  can call `usePageTitle`, and a header embedded in a panel can opt out with
  `documentTitle={false}`.
- Add column width resize separators in reports, page titles for each page
- Updated dependencies
  - @sapporta/honest@0.3.9
  - @sapporta/shared@0.2.2

## 0.3.1

### Patch Changes

- Add drill-down links to reports
- Updated dependencies
  - @sapporta/honest@0.3.8
  - @sapporta/shared@0.2.1

## 0.3.0

### Minor Changes

- 369f4d1: Enable table search by default and replace `search.columns` with explicit,
  recursive search configuration.

  Tables now search all visible application columns when `meta.search` is
  omitted. Set `search: false` to disable the endpoint behavior and hide the
  search control, use `"allColumns"` for one table node, or select fields with
  `self`. Foreign keys match the referenced row label instead of the stored ID.

  Has-many traversal is opt-in:

  ```ts
  meta: {
    rowLabelColumns: ["title"],
    children: [{ table: "quotes", foreignKey: "book_id" }],
    search: {
      self: ["id", "title", "author_id"],
      children: {
        quotes: {
          self: ["quote_text"],
        },
      },
    },
  }
  ```

  Expanded quote grids use their own query. A search that determines which books
  appear no longer filters the quotes loaded after a book is expanded.

- fd820be: Replace HTTP-shaped `scopedRows()` read inputs with generic, Drizzle-shaped
  queries.

  `page`, `scan`, `count`, and `countBy` now accept direct Drizzle expressions.
  Paged reads use numeric page semantics, while scans stream the complete visible
  selection through one deterministic SQLite cursor and one read snapshot,
  without repeated `LIMIT`/`OFFSET` queries or full-result materialization.
  The raw `scanTableRows()` cursor primitive is also exported for workflows that
  compose their own explicit row predicate.
  `lookup` has distinct typed ID and search modes. Search lookup uses bounded
  numeric limits, while ID lookup accepts only a bounded, non-empty ID list.
  Generated table contracts coerce and bound pagination and lookup numbers before
  handlers resolve table-dependent filters, columns, IDs, search, and ordering;
  their generated client inputs remain in the string wire shape.
  The named HTTP query resolvers are exported directly from `@sapporta/server`.

- 4e9bf62: Generalize deterministic, row-scoped table counts through
  `GET /api/tables/<table>/_count` and `sapporta rows count`.

  Counts support canonical typed filters, bounded grouping, deterministic order,
  typed group values, and explicit total or grouped result shapes. Foreign-key
  labels remain a separate lookup operation with their own authorization boundary.

### Patch Changes

- Release coinciding with updated homepage design
- Updated dependencies [369f4d1]
- Updated dependencies [fd820be]
- Updated dependencies
- Updated dependencies [4e9bf62]
  - @sapporta/shared@0.2.0
  - @sapporta/honest@0.3.7

## 0.2.7

### Patch Changes

- Internal testing release
- Updated dependencies
  - @sapporta/honest@0.3.6
  - @sapporta/shared@0.1.7

## 0.2.6

### Patch Changes

- Release for homepage deployment pre-checks
- Updated dependencies
  - @sapporta/honest@0.3.5
  - @sapporta/shared@0.1.6

## 0.2.5

### Patch Changes

- first iteration of auth integration
- Updated dependencies
  - @sapporta/honest@0.3.4
  - @sapporta/shared@0.1.5

## 0.2.4

### Patch Changes

- Create Dockerfile based deployment
- Updated dependencies
  - @sapporta/honest@0.3.3
  - @sapporta/shared@0.1.4

## 0.2.3

### Patch Changes

- Update sapporta cli install
- Updated dependencies
  - @sapporta/honest@0.3.2
  - @sapporta/shared@0.1.3

## 0.2.2

### Patch Changes

- 3d53017: Extract sapporta grid into separate package
- Updated dependencies [3d53017]
  - @sapporta/shared@0.1.2

## 0.2.1

Initial public release of `@sapporta/server` from the cleaned public repository history.
