# @sapporta/server

## 0.6.0

### Minor Changes

- 0f70216: Generated projects now ship `pnpm seed`: `packages/api/seed.ts` for the sample
  rows, and `packages/api/script-runtime.ts`, which opens the application with no
  server running. Rows written there go through the app's own save path, with the
  same validation, column defaults, and ownership stamping a request from the
  browser gets, so seeded data is data the app could have produced. Filling a new
  app used to mean signing up over HTTP against the running server, keeping
  Set-Cookie across calls, sending an origin CORS would accept, and reading the
  API port out of `.env.development` — eighty lines of plumbing before the first
  row, none of it necessary, because a script runs on the same machine as the
  database. Agent access tokens cannot close the gap either: only a signed-in
  person can create one, and a freshly scaffolded app has no account yet.

  `openScriptRuntime()` is the general way in and is meant to be reused: a
  nightly job, a one-off import, or a maintenance task gives it an address and a
  password and gets that person's row access, the same as a request would. The
  account is proved, not named — signing in there means holding the password,
  exactly as it does in a browser — so there is nothing in that file for a caller
  to borrow, and no way to act as an account whose password it does not have. It
  is still not for a route: a served request already carries the row access it
  earned, at `c.get("auth")`.

  What a script gets back is what a request handler works with: `rows(table)` for
  one table, and `db` and `auth` for a domain workflow, which takes the same pair
  a route passes it from `c.get("db")` and `c.get("auth")`. A nightly job that
  completes a booking therefore runs the application's own transition, deriving
  the same totals and writing the same event rows, rather than a second copy of
  it written against `rows()`.

  The workspace a seed run creates keeps the time zone of the machine that ran
  it. A browser sends its own zone with a sign-up request and a script has none
  to send, so it reads the machine's, and the sample timestamps read on the clock
  of the developer about to look at them. It is an ordinary workspace zone from
  then on, changed on the workspace settings screen like any other.

  `packages/api/seed-runtime.ts` is that same call with the sample-data account
  wired in, and the sample-data account is the one thing here that needs
  guarding, because its password is written in the source. Creating it skips what
  the sign-up route does to protect a real address: the rate limit, the
  trusted-origin check, and the verification email. So the guard sits on the
  capability rather than on the script that calls it —
  `project-auth/sample-data.ts` refuses unless `.env.development` sets
  `SAPPORTA_ALLOW_SAMPLE_DATA_SEEDING=true` and `NODE_ENV` is not `production`,
  and both the account creation and the verified-address write check it
  themselves. A route that reached either one is refused for the same reason the
  seed script is. The permission is granted rather than merely not withheld, so
  an environment that never heard of the setting is refused instead of being
  taken for a developer's machine.

  The two sharp methods on the project's auth object now say what they cost.
  `createSampleDataAccount()` names what it is for and checks the permission
  before doing anything, and `verifyEmailPasswordWithoutRateLimit()` says in its
  name that the throttle in front of the sign-in route counts HTTP requests and
  therefore does not apply to it — it is for a command-line script, where there
  is no caller to throttle, and never for a route.

  `boot.ts` and the script runtime both start from `openProjectRuntime()` in
  `packages/api/runtime.ts`, which returns the `close()` both call, so the HTTP
  server and `pnpm seed` cannot drift apart. It defaults mail off for a script,
  because the addresses in a database belong to people who did not ask a script
  to write to them, and it takes the anonymous-route list as an option from
  `boot.ts` rather than importing `app.ts`, so opening the app does not pull in
  every route module.

  Reads of the account table live in `packages/api/project-auth/user.ts`, over
  the generated Drizzle schema, and agent tokens share them, so the three ways of
  identifying a person cannot disagree about what an account is. That module
  reads only; the one write `pnpm seed` needs belongs to `sample-data.ts`
  alongside the permission that guards it. `project-auth/index.ts` also names its
  workspace exports one by one instead of re-exporting the module wholesale, so
  adding a function there cannot publish it by accident. `userPrincipal()` now
  returns the new `UserPrincipal` type rather than the wider `Principal`, so
  callers that have already established there is a user no longer have to narrow.

  A script picks the first workspace its account belongs to, and a browser
  prefers whichever workspace the session is already in and falls back to the
  same one. The two therefore agree for an account with a single workspace and
  for a session that has not chosen one, which covers a freshly seeded project;
  they part company only for a person with several workspaces who has switched.

  `authz/resolveRequestDataAuthority()` is unchanged and still the only place a
  served request's row access is decided; its comment now describes what the
  starter app actually grants a signed-in request, which is everything in its
  active workspace rather than only that account's own rows.

- fea5db2: A day is now a calendar day in the active workspace's time zone, everywhere.
  Six surfaces used to answer "which day is this moment on?" and they gave four
  different answers, so a grid cell could read `2026-08-24 02:00` in a row a
  report had grouped under `2026-08-23`. There is now one value per workspace,
  stored in the database, resolved once per request on the server and once per
  page load in the browser.

  Storage does not change. Timestamps are still fixed-width UTC text; what
  changes is which zone turns one of those instants into a calendar day, and back.

  **The zone is a business fact, not a reader's preference.** "Revenue for August
  24" has to mean the same thing to everyone looking at the same workspace, or two
  colleagues read different numbers off one dashboard and neither is wrong. So the
  per-device display preference added earlier on this line is gone:
  `DISPLAY_ZONE`, `CHOSEN_DISPLAY_ZONE`, `setDisplayZone`, the Display section on
  the account page, and the `sapporta:display-zone` browser key. `appTimeZone()`
  from `@sapporta/frontend/platform` replaces `DISPLAY_ZONE` at every call site
  and takes no other change with it: the value is published from the auth context
  response the boot sequence already fetches, before `BootLoader` lets any route
  render, so nothing downstream becomes a hook and nothing becomes asynchronous.
  Switching workspaces publishes the new zone through the same path that
  publishes the new workspace.

  The value itself is held by `@sapporta/grid`, which needs it to write a cell
  and cannot import from the frontend: `setDisplayTimeZone` / `displayTimeZone`
  from `@sapporta/grid/column-preset`. One holder, so a grid cell and the screen
  around it cannot disagree about the day a row falls on. A date or timestamp
  column takes no `zone` option; an application driving the grid on its own
  publishes the zone once before the first grid renders.

  **On the server**, `AuthWorkspace` gains `timeZone`, checked with
  `parseTimeZone` where the workspace row is read, and `workspaceTimeZone(auth)`
  is the one accessor a handler calls. It throws for a request with no workspace —
  an anonymous public route, or one holding only `systemGlobalOnly` authority —
  because such a request has no calendar, and the right answer to asking for one
  is an error rather than UTC.

  **Filtering by day.** `resolveDateRangeQueryBounds` now takes a required
  `(zone, now: Temporal.Instant)` pair in place of a `today` that defaulted to
  `Temporal.Now.plainDateISO()`. That default read the host's `TZ`, so a "last 7
  days" report returned different rows depending on how the container was
  started. It resolves those days once into both shapes a column can be compared
  against — `days` for a `date` column, and a half-open `instants` window for a
  `timestamp` column:

  ```ts
  const zone = workspaceTimeZone(c.get("auth"));
  const period = resolveDateRangeQueryBounds(
    "period",
    request.query,
    zone,
    Temporal.Now.instant(),
  );
  // WHERE (:from IS NULL OR created_at >= :from)   -- period.instants
  //   AND (:until IS NULL OR created_at <  :until)
  ```

  One function rather than one per column type: the wrong choice is a report that
  silently drops a day, and that is not a choice worth offering at the top of a
  handler. Half-open instants fix two live defects. Inclusive plain-date bounds pointed at a
  `timestamp` column excluded their own last day, because every instant stored on
  the 24th begins `2026-08-24T`, which sorts after `2026-08-24`. And a closed
  bound built from a wall clock such as `23:59:59` lost an hour on the day a zone
  leaves daylight saving, because that wall clock happens twice.

  The table filters had that second defect too, and they still need a closed
  bound because the reader picks the operator: `on or before the 24th` is an
  `lte`, and an `lte` has to name a last moment. So the moment is now derived
  from where the _next_ day begins rather than from a local `23:59:59` —
  `parseDateInputToInstantString(day, "endOfDay", zone)` is one second before the
  start of the day after. In `America/Santiago`, whose clocks go back at
  midnight, filtering "on or before 2026-04-04" previously stopped at
  `2026-04-05T02:59:59Z` and dropped the last hour of April 4; it now stops at
  `2026-04-05T03:59:59Z`, which is that hour's end.

  **Grouping by day.** `connectProject` registers `to_tz_date(instant, zone)` on
  every project connection, so report SQL can bucket rows by local day:

  ```sql
  SELECT to_tz_date(created_at, :zone) AS day, count(*) AS n
  FROM   txns GROUP BY day ORDER BY day
  ```

  SQLite ships no time zone database, so this supplies Node's. The result is
  exact: a day that runs 23 or 25 hours holds exactly its own rows, which no fixed
  offset can report. It costs about 6µs a row — some thirty times a bare
  `date(col)`, which is what crossing into JavaScript for a real zone database
  costs — so bound the range in the `WHERE` clause before grouping. It is registered
  `deterministic` and `directOnly` — the latter refuses `CREATE INDEX` over it,
  which would otherwise write a JavaScript function's name into the database file
  and leave it unwritable by any process without that function registered. On a
  database with its own zone support this is a one-line substitution, such as
  PostgreSQL 16's `date_trunc('day', ts, tz)`.

  **Storing and changing it.** The workspace row gains a `timeZone` column, an
  IANA id and never a fixed offset: an offset describes one instant, a report
  describes a range, and a range can contain the moment the offset changes. The
  sign-up request carries the browser's zone, so the first workspace an account
  creates starts on the calendar its owner keeps; after that the workspace owns
  its own. An owner changes it on the new Workspace settings screen, through
  `PUT /api/auth-context/workspace/time-zone`, which answers with a fresh auth
  context.

  `deviceTimeZone()` survives with two callers, and a test greps for any other
  reader of an ambient zone — `deviceTimeZone()`, `Temporal.Now.timeZoneId()`, or
  `Temporal.Now.plainDateISO()` with no argument. The second caller is `pnpm
seed`, which has no request to take a zone from: it reads the machine's, so the
  seeded workspace keeps the clock of the developer who is about to sign in and
  look at the rows, and a day-grouped report over sample data lands on the days
  that person would call them.

  A report whose numbers depend on a zone says which zone: `ReportTimeZoneNote`
  renders `Asia/Kolkata UTC+05:30` in the toolbar, including when the zone is UTC.
  CSV export and grid clipboard copy are deliberately unchanged — they keep
  emitting the stored UTC instant with its trailing `Z`, which is the right thing
  to hand a downstream program.

### Patch Changes

- release
- c819490: `/api/openapi.json` now renders for a master table whose child's foreign key is
  server-owned. Declaring `meta.children` on the master and marking the child key
  non-writable — either `references: { fk: { apiSettable: false } }` or
  `columns: { fk: { apiWritable: false } }` — took down OpenAPI generation and
  every consumer of it:

  ```
  $ pnpm exec sapporta endpoints list
  {"ok":false,"error":"Unrecognized key: \"meal_id\"","code":"INTERNAL"}
  ```

  `createBodyZod()` omits the child key from the child insert schema to build the
  master-with-`$details` branch, but `forInsert()` had already dropped it: a key
  the API may not write is not in the insert shape to begin with. Zod 4 rejects an
  `.omit()` mask naming an absent key, and does so from the lazy `shape` getter,
  so the throw surfaced during JSON-schema conversion rather than at construction.
  Row CRUD was unaffected — generated create and update routes set
  `skipBodyValidation`, so the body schema is only read by OpenAPI and generated
  clients.

  `omitField()` now omits only a key the shape carries. The pairing is the
  recommended one for a server-authored child key, and it is what turns a caller
  who submits that key into an explicit `422` rather than a value the server
  silently overwrites.

- 2637cb8: `scopedRows()` now returns properly typed rows for tables built with the
  Sapporta column factories. Every factory took its column name as a plain
  `string`, which threw away the name literal that Drizzle records on the column
  builder. `TableRow` keys rows off that literal, so any column declared with
  `text()`, `number()`, `select()`, `timestamp()`, `bool()`, `date()`, `money()`,
  or `percentage()` collapsed into an index signature: reading `row.food_name`
  gave `string | number | Instant | null` rather than `string | null`. Only
  columns declared with Drizzle's own `integer()` kept their type.

  The factories are now generic in the name, so the literal survives and each
  column keeps its own type — including `select()`, which keeps its enum values
  as a union. Nothing changes at runtime.

  `columns.test.ts` asserts the row type of a table using all eight factories and
  that the row type carries no index signature. These are `expectTypeOf`
  assertions, so `pnpm typecheck` is what enforces them.

- 40cc6a8: with timezone improvements
- Updated dependencies [58ee9a8]
- Updated dependencies
- Updated dependencies [fea5db2]
- Updated dependencies [40cc6a8]
  - @sapporta/shared@0.3.0
  - @sapporta/honest@0.3.12

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
