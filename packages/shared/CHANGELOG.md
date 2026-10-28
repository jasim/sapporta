# @sapporta/shared

## 0.6.0

### Minor Changes

- 210d5d4: A report column can name the columns a sort on it orders by:
  `sortBy: ["date", "sequence"]`, first key first. Each listed column, hidden
  ones included, compares by its own `kind`, and all follow the direction chosen
  on the column. A level can declare the order its rows start in with
  `sort: [{ column, direction }]`. `gridDatasetSortProblems(dataset)` reports
  `sortBy` entries the level lacks.

## 0.5.0

### Minor Changes

- cdefd83: Tables can declare computed fields: named values of each row that the server
  computes when a read asks for them, such as an account's parent path or an
  item's stock on hand. Declare them with `computed: { name: computedField({
kind, load }) }` in `sapportaTable`. A loader receives a batch of rows
  (`table`, `ids`, `once()`, `db`, `auth`) and returns a value for every id, with
  `null` for a row that has no value. Fields that share a query, or that build on
  each other's values, share the work through `once()`. `treePath()` gives each
  row of a tree table its ancestors' labels, such as "Expenses > Kitchen".

  Every row read of the table API takes `computed=name,name2`: the list
  (including tree reads and child levels), the single-row read and the lookup.
  Create and update compute nothing, so a saved row is never reported as an
  error. The response then carries `computed`, which maps each field
  name to the row ids and their values. A field that fails, or that leaves out an
  id, fails the request, and an unknown name is a 400. `computeFields()` runs
  the same loaders from your own endpoints and reports.

  `meta.rowCaption` names a column or computed field that the default display of
  a row draws under its label. The table schema lists the computed fields
  (`computed`) and the caption (`rowCaption`).

- a3b6de0: Lookups can offer only some rows of a table.

  - The lookup search takes `filter[col][op]=value`, the same filters as list
    reads, so a picker can offer, say, accounts of one type. Lookups by id take
    no filter, so a chosen row keeps its label after it stops matching.
  - `notUnder=<id>` leaves out a row of a tree table and every row below it:
    the choices for a row's parent, without the ones that would make a loop.
  - `useTableLookup("accounts", { filter: [{ column: "account_type", op: "in",
values: ["asset"] }], notUnder: accountId })` gives a `LookupPicker` that
    searches only those rows. `store.table(name, narrowing)` does the same for
    a row store.

- aaae9c2: A report column can name the table row each of its cells shows:
  `reference: { table, idColumn }`, where `idColumn` is the row column holding
  the id (usually visually hidden). A `GridDataset` can carry `computed` values
  for the referenced rows, by table.
- 7763d9e: Table search (`?q=`) now requires every word of the term rather than the
  whole term as one substring. Each word may match a different searched value
  of the row, including a child row or a referenced row's label, so
  `grocery 2500` finds a journal whose description says grocery and whose entry
  is 2500. A double-quoted phrase is one word. Repeated words count once, and
  words after the first 16 are ignored. Number columns match a numeric word by
  its stored value (`2,500` and `2500.00` match 2500, `250` does not) and are
  skipped for other words; before, their text was matched as a substring. A
  percentage column is matched by its stored fraction, so `0.25` finds 25%.
  Primary keys are still matched as text, so `250` finds row 2500.
  `searchWords(term)` in `@sapporta/shared` returns the words the search uses,
  for highlighting them in the browser.
- fe8fae6: `decodeFilterObject()` parses filter conditions written as a JSON object, such
  as `{ "amount": { "gte": 100 } }`, into `NewFilterCondition[]`. It rejects an
  array on a scalar operator and `null` on any operator but `is`.

  An `in`/`nin` item can now contain a comma. Inside an item, `\,` stands for a
  comma and `\\` for a backslash, so `filter[terms][in]=Net 30\, EOM,Net 60`
  matches two options. `encodeFilters()` writes these escapes, and the server
  reads them. A comma inside an item used to split it in two, so the filter
  returned the wrong rows. A backslash before any other character is now a
  `bad_value`, so an item containing a backslash must be written as `\\`.

  `encodeFilters()` and `encodeFilterValue()` now accept conditions without an
  `id`, and throw `FilterParseError` for an empty `in`/`nin` list or item, which
  the server would reject. `wireKey()`, and so `encodeFilters()`, throws for an
  empty column name or one containing `]`, which the key cannot carry.
  `materializeFilterCondition()` is removed; it had no callers.

  A lookup narrowing's `filter` is encoded by `encodeFilters()`.

  The CLI's `--where` and `--fixed` flags use `decodeFilterObject()`, so
  `sapporta rows list` and `sapporta rows count` reject those filters before
  sending the request. Use `{ "is": null }` to match a missing value;
  `{ "eq": null }` used to compare a text column against the string `"null"`.
  A list operator now needs a JSON array: `{ "in": "a,b" }` is rejected. The
  CLI no longer drops query parameters with an empty value, so
  `{ "name": { "eq": "" } }` matches empty text instead of being ignored.

  `sapporta api get|post|put|delete --query` now rejects array and `null`
  values instead of joining an array with commas and sending `null` as the
  string `"null"`. Write a list in the form the endpoint expects, such as
  `{ "fields": "a,b" }`. Empty strings in `--query` are now sent as well.

  The filter editor's tag input splits pasted text such as `a, b` on commas, the
  same as typing a comma between the two.

- fe8fae6: An empty filter value on a `number`, `date` or `timestamp` column is now a
  `bad_value`. It used to be read as `NULL` and compared with `=` or `>=`, which
  matched no rows without an error. `filter[amount][eq]=` now returns `400`; match
  a missing value with `is`. On a `text` column an empty value still matches
  empty text. `parseFilterValue()` throws `TypedFilterParseError` for an empty
  or blank string on those kinds instead of returning `null`.

  `NewFilterCondition` is removed. `encodeFilters()`, `encodeFilterValue()` and
  `decodeFilterObject()` use `FilterDraftCondition`, so an `in`/`nin` list may
  hold numbers, which are written as strings. `POLARITIES` lists the `is`
  operator's values.

  Clearing one date in a date-range filter card removes that bound and keeps
  the other, instead of sending an empty date.

### Patch Changes

- 33e6dc2: The packages now require zod 4.6.7 or later: their zod peer range is
  `^4.6.7`, up from `^4.3.6`. Applications on an older zod 4 need to upgrade it.

## 0.4.0

### Minor Changes

- bc914c7: A column's meta takes `gridEditable: false` for a column the generated grids
  and a record's detail fields show but never edit, such as text an import
  wrote. Unlike `apiWritable: false`, the table API still accepts it, so code
  and agents can set it, and a create form still asks for it. The extracted
  `ColumnSchema` carries it.
- b52c7a6: A `GridDataset` level can declare `tree: { parentColumn, column? }` to show
  rows that name a parent row of the same level, such as accounts with a
  `parent_id`, as one tree. The level's nodes are one flat list, and
  `parentColumn` names the column that holds the parent row's `rowKey`.
  `gridDatasetTreeProblems` reports a tree level that names a parent column the
  level does not have, or names a tree column that is not visible.
  `gridDatasetTreeColumn` returns the column that shows a level's tree.
- 1ff6208: `TableSchema.tree` describes a table whose rows form a tree. The list query
  accepts `tree` (`ancestors` or `ancestors-and-descendants`) and
  `fixed[col][op]` conditions, and the list response `meta` can carry
  `tree: { matchCount, contextIds }`. `resolveTableTree` fills in the defaults
  of a tree declaration. `encodeFilters`, `encodeTypedFilters`, `decodeFilters`,
  and `wireKey` take an optional `FilterNamespace` (`"filter"` or `"fixed"`).

### Patch Changes

- Grid updates and new release

## 0.3.3

### Patch Changes

- Release

## 0.3.2

### Patch Changes

- release

## 0.3.1

### Patch Changes

- Release

## 0.3.0

### Minor Changes

- 58ee9a8: Date and timestamp cells now read as `2026-08-23` and `2026-08-23 16:38`
  instead of the raw wire value. A timestamp column printed its stored form —
  `2026-08-23T11:08:00Z` — which is 144px of monospace text in a track that
  allows 108px, so the column was both hard to scan and clipped.

  Timestamp columns are their own column preset, `columnPreset.timestamp()`, with
  their own default width. Which of the two shapes a column reads in comes from
  the column's declared kind rather than from the value in the cell, so a column
  reads the same way in every row even where the values underneath it vary. Table
  and report columns pick the preset from the kind they already declare, and
  schema-declared sizing still wins where it is present.

  `formatTemporalForDisplay()` in `@sapporta/shared/temporal` is the display half
  of the codecs that already sit there: it drops the `T`, the `Z`, and the
  seconds, and resolves an instant to the reader's own time zone — the same zone
  the input codecs beside it read and write in. It takes the precision the column
  asks for, and precision is a ceiling: a plain date in a timestamp column stays a
  date rather than gaining a midnight. A value in neither canonical shape is
  reported as `null` so the caller can show the text exactly as it arrived rather
  than invent a date from it.

  Hovering a timestamp cell shows the moment the cell text leaves out —
  `2026-08-24 02:00:00 (UTC+05:30)` — so that two rows a few seconds apart can be
  told apart, and so that the zone a cell is printed on is recoverable from the
  cell itself. The description is resolved on first hover, not on render.

  Date and timestamp filters on timestamp columns work again. A date-only bound
  reached the instant parser as typed and was rejected — `Temporal.Instant
requires a time zone offset` — out of a change handler, so a range filter on a
  timestamp column could not be edited at all. A date control on a timestamp
  column now names a local day, and the operator picks the edge of that day the
  bound sits on: `on or after` and `before` read its first instant, `after` and
  `on or before` its last. `on` and `not on` are no longer offered for timestamp
  columns, because a day is a range of instants and the condition grammar has no
  way to say so in a single condition.

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
- 40cc6a8: with timezone improvements

## 0.2.4

### Patch Changes

- Improve port management of new projects

## 0.2.3

### Patch Changes

- Improvements after comparing agentic build of sample projects

## 0.2.2

### Patch Changes

- Add column width resize separators in reports, page titles for each page

## 0.2.1

### Patch Changes

- Add drill-down links to reports

## 0.2.0

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

## 0.1.7

### Patch Changes

- Internal testing release

## 0.1.6

### Patch Changes

- Release for homepage deployment pre-checks

## 0.1.5

### Patch Changes

- first iteration of auth integration

## 0.1.4

### Patch Changes

- Create Dockerfile based deployment

## 0.1.3

### Patch Changes

- Update sapporta cli install

## 0.1.2

### Patch Changes

- 3d53017: Extract sapporta grid into separate package

## 0.1.1

Initial public release of `@sapporta/shared` from the cleaned public repository history.
