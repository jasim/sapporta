# @sapporta/frontend

## 0.7.0

### Minor Changes

- 6beed02: Two cards-presentation fixes for grids, and the grid presentation is now
  a required value.

  The primary-key cell no longer paints row-header chrome in cards. Standard
  tables use the pk column as a data-backed row header, and cards kept its
  tabular treatment: a tinted background — which in a full-width card field
  looked identical to the selected-cell background — and a click that selected
  the whole row while every other cell click placed the cell cursor. In cards
  that column now renders as a plain field: no tinted band, and clicking it
  selects the cell like any other. A selected row still shows through the
  card-level selected background, and the structural checkbox gutter
  ("empty-selectable-cell") keeps its meaning in every presentation. On touch,
  tapping the Id chip no longer selects the row and surfaces the delete
  toolbar.

  Keyboard traversal in cards now follows the rendered order. A card leads
  with its title column, but arrows and Tab walked the columns in schema
  order, so the title — visually first — was reached last and vertical
  movement felt shuffled. Movement now resolves against the order the active
  presentation renders (the presentation travels with each keystroke and
  editor commit, like a modifier key): cards traversal leads with the title
  column before the remaining columns in schema order, and moving past the
  last field lands on the next card's title. Tabular grids are unchanged.

  The presentation is a required value everywhere it travels. It used to be
  an optional parameter that silently fell back to `"tabular"`, so a call
  site that forgot to pass it navigated a cards grid in the spreadsheet's
  column order. Every boundary that carries a presentation (`handleKey`,
  `commitEdit`, `handleCellPointer`, `navigateCell`, and the `presentation`
  prop on `Grid`, `GridLevel`, and `TGrid`) now requires the caller to name
  the presentation it renders, so a missing value is a type error rather
  than a wrong default.

- eebb57d: Text cells no longer show a tooltip of their own. Every non-empty text column
  opened a popup on hover, whether or not the value was long enough to be
  clipped, which made the tooltip noise on short columns and left no way to turn
  it off. Whether a value is worth pointing at depends on the data in the row,
  which the application knows and the column kind does not.

  Columns that want a tooltip now ask for one, and to make that cheap,
  `renderCell` overrides now receive `defaultContent`: the cell the column would
  have rendered on its own, formatting and truncation included. Wrapping it
  decorates the built-in cell instead of rebuilding it, and ignoring it replaces
  the cell outright, as before. This holds at every layer — column-preset
  options, TGrid column options, and the new `renderCell` prop on
  `ReportGridDataset` (keyed by level name and then by column id), where the
  report's drill-through links stay attached around the override's output.

  ```tsx
  columns.table("title", {
    renderCell: ({ defaultContent, row }) => (
      <CellTooltip content={row.summary}>{defaultContent}</CellTooltip>
    ),
  });
  ```

  `CellTooltip` from `@sapporta/grid/column-preset` carries the popup's sizing
  and placement. An empty `content` renders the cell body alone, so a tooltip
  can be shown on the rows that need one and left off elsewhere. A cell built
  from scratch instead of from `defaultContent` can apply
  `presetCellClassNames` to keep the built-in truncation and stay lined up with
  the columns beside it.

- eae8f32: Column resizing is findable, and a dragged width is now honoured.

  The drag handle painted nothing until the pointer was already on it, so the
  only way to find a column edge was to sweep the header and watch the cursor.
  Pointing anywhere at the header now draws every column boundary at once, and
  the boundary being aimed at thickens into a full-height accent bar. The grab
  area widened from 8px to 12px, straddling the boundary so it can be reached
  from either side, and `--grid-column-resize-handle-width` sets it per grid
  alongside the existing `--grid-column-resize-handle-color`,
  `--grid-column-resize-handle-idle-color`, and
  `--grid-column-resize-handle-hover-color`.

  A dragged width was also being clamped to the column preset's own `min` and
  `max`. Those bounds answer how to size a column nobody has sized, and reusing
  them as resize limits left a `timestamp` column 16px of travel between its
  floor and ceiling — the handle moved and the column sprang back. An explicit
  width now overrides them and is bounded only by the grid's own `minPx` floor
  (48px by default, set through `columnSizing.minPx`), which keeps a column from
  being dragged away to nothing. Automatic sizing is unchanged: the preset
  bounds still produce each column's `minmax()` track.

  `clampColumnPixelWidth` no longer takes a column as its first argument, since
  it no longer consults the column's preset. Call it as
  `clampColumnPixelWidth(width, minPx)`.

- 5c08071: Tapping a card on a narrow table page now opens a record detail sheet: a
  bottom sheet listing every visible field of the row as label/value lines.
  Grid cells could already edit inline, but the cell editor overlay is a
  pointer-and-keyboard workflow that positions poorly on a phone, and date and
  timestamp columns had no cell editor at all — so on mobile a record could
  neither be read in full nor edited comfortably.

  Fields in the sheet edit through the same form controls as the new-record
  form (text, number, date, timestamp, checkbox, select, and foreign-key
  lookups), and each save flows through the grid's cell patch path, so
  optimistic updates, custom `saveCellValue` handlers, and failure banners
  behave exactly like inline grid edits. The sheet reads the displayed row
  live and closes itself when the row leaves the page.

  The tap arrives through a new default table interaction,
  `CELL_GRID_WITH_ROW_CLICK_ACTIVATION`: plain click now also emits a semantic
  row activation. Pointer and keyboard behavior is otherwise unchanged — the
  click still places the cell cursor first — and wide layouts ignore the
  event, so desktop tables are untouched. A TGrid definition that passes its
  own `interaction` keeps it, as before.

  Narrow cards also tightened up around the sheet: a card title that hosts the
  row-expansion chevron may wrap to two lines before clamping instead of
  truncating at one, and secondary fields whose value is empty are skipped
  entirely — the sheet now shows the full field list, so an empty line in the
  card only cost density. Only default preset cells are skipped; client
  columns and columns with a custom `renderCell` always render, since they can
  draw content for an empty value.

- 0cea541: Report grids now render as stacked cards on narrow screens, the same
  presentation table pages use. Below a 760px container width
  `ReportGridDataset` switches from the tabular layout to cards; there is no
  preference toggle — reports carry no per-table view preference, so the
  container width alone picks the presentation.

  Each level's first visible text column is stamped as the card title, and
  since cards render no column header row, nested levels gain a small
  uppercase level label in the header's place so a child level does not appear
  as an unlabeled run of cards.

### Patch Changes

- release
- b03210e: The grid's cards presentation is denser and typographically consistent.
  Field rows drop the tabular 28px cell height for a compact ~22px line,
  labels sit in a fixed-width column at a uniform weight and color, and
  inline data values (ids, dates, numbers) take the body font size while
  keeping their mono family. The primary-key value now reads like any other
  field — left-aligned in the value column with the expansion chevron
  directly after it — instead of the tabular grid's right-aligned identifier
  treatment, and the selection gutter's idle gray wash is transparent in
  cards, painting only on hover, selection, and focus.
- Updated dependencies
- Updated dependencies [6beed02]
- Updated dependencies [eebb57d]
- Updated dependencies [eae8f32]
- Updated dependencies [5c08071]
  - @sapporta/grid@0.6.0
  - @sapporta/shared@0.3.2
  - @sapporta/ui@0.2.15

## 0.6.1

### Patch Changes

- Release
- Updated dependencies
  - @sapporta/grid@0.5.1
  - @sapporta/shared@0.3.1
  - @sapporta/ui@0.2.14

## 0.6.0

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
- Updated dependencies [58ee9a8]
- Updated dependencies
- Updated dependencies [fea5db2]
- Updated dependencies [40cc6a8]
  - @sapporta/shared@0.3.0
  - @sapporta/grid@0.5.0
  - @sapporta/ui@0.2.13

## 0.5.0

### Minor Changes

- a9b70c3: The agent setup prompt copied from the account profile page now verifies a new
  token with `api get '/api/auth-context'`, which answers with the user and
  workspace the token acts as. It asked for `endpoints list`, which answers
  without a credential on a local development server, so the check passed even
  when the token was never wired into the CLI.

### Patch Changes

- Improve port management of new projects
- Updated dependencies
  - @sapporta/grid@0.4.1
  - @sapporta/shared@0.2.4
  - @sapporta/ui@0.2.12

## 0.4.0

### Minor Changes

- 237c4bb: A navigation item is active on its own page and on the pages nested under it.
  The check was a plain prefix match, so an item pointing at `/` looked active
  everywhere, and an item for `/orders` also lit up on `/orders-archive`.
- c27b34c: `AppShell` now renders navigation once a visitor has a session. A public page
  loaded it with the signed-in sidebar, rail, and bottom bar, whose links only
  bounce a visitor to the sign-in page.
- aa25d57: Signing in returns to the page the visitor asked for. `AuthGate` recorded that
  page when it sent a visitor without a session to sign in, but nothing read it
  back: the sign-in form and `PublicOnlyGate` always continued to `/`, so a
  deep link opened by a signed-out visitor was lost.

### Patch Changes

- Improvements after comparing agentic build of sample projects
- c3d67b8: Make the TGrid layer visible as a directory and unify the report grid
  vocabulary. `src/table/grid-adapter/`, the `tgrid-*` state files, and the
  `TGrid` view now live together in `src/table/tgrid/`; the rest of
  `src/table/` is the table-screen layer built on top. On the report side,
  `ReportGrid.tsx` is now `ReportGridDataset.tsx` to match its public
  `ReportGridDataset` export, and the one-file `src/grid-dataset/` directory
  (which collided with `@sapporta/shared/grid-dataset`) moved into
  `src/report/grid-dataset-path.ts`. Exports are unchanged. The only
  observable difference: the report grid's internal CSS block was renamed
  from `sapporta-report-tgrid*` to `sapporta-report-grid-dataset*`
  (`data-grid-part` hooks are untouched), so any app styling against the
  old class names must update them.
- Updated dependencies [74ac829]
- Updated dependencies
- Updated dependencies [6460e61]
- Updated dependencies [c46f748]
  - @sapporta/ui@0.2.11
  - @sapporta/grid@0.4.0
  - @sapporta/shared@0.2.3

## 0.3.2

### Patch Changes

- 1595392: Let the server's email verification policy decide access after sign-up. The
  auth store no longer treats every unverified email as a blocked session; it
  relies on the `email_not_verified` failure the API returns when verification
  is required. Sign-up now enters the app directly when the server started a
  session, and shows the verify-email page only when it did not. In development,
  where verification is not required by default, new users land in the app
  without clicking the emailed link.
- 7f9750c: Name the browser tab after the current screen. `PageHeader` now sets the
  document title to "<page> – <app name>" from the same `title` it displays, so
  tables, reports, forms, and account pages each leave a readable entry in tab
  lists and browser history. The app name comes from the loaded project info,
  falling back to the title in index.html. Screens without the standard header
  can call `usePageTitle`, and a header embedded in a panel can opt out with
  `documentTitle={false}`.
- Add column width resize separators in reports, page titles for each page
- Updated dependencies
  - @sapporta/grid@0.3.2
  - @sapporta/shared@0.2.2
  - @sapporta/ui@0.2.10

## 0.3.1

### Patch Changes

- Add drill-down links to reports
- Updated dependencies
  - @sapporta/grid@0.3.1
  - @sapporta/shared@0.2.1
  - @sapporta/ui@0.2.9

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

- a1659d8: Let table pages control what happens when keyboard navigation reaches the edge
  of the loaded rows. The standard `TableGridView` now pauses on the visible
  Previous or Next pagination button before changing pages. Lower-level hooks
  and TGrid sessions remain policy-free unless the application provides a
  boundary handler. Activating the focused pagination button changes pages and
  returns focus to the first or last row of the newly loaded page. An arrow key
  on that pagination button returns browser focus to the grid without changing
  its cursor or selection.
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
- b934cd0: Show a ready-to-copy coding-agent setup prompt after creating an access token.
- f1d56c6: Use Space as the canonical row-expansion command. Enter opens cells that are
  editable at runtime and otherwise runs their declared activation. Shift+Space
  toggles independent row selection, and readonly data sources no longer enter
  edit mode. Cell editing now starts through Enter, typing, or double-click.
  Pointer expansion runs only from the cell's expansion caret, so clicking its
  value keeps the normal cell interaction.
- Updated dependencies [369f4d1]
- Updated dependencies [a1659d8]
- Updated dependencies [fd820be]
- Updated dependencies
- Updated dependencies [f1d56c6]
- Updated dependencies [30469d1]
- Updated dependencies [4e9bf62]
  - @sapporta/shared@0.2.0
  - @sapporta/grid@0.3.0
  - @sapporta/ui@0.2.8

## 0.2.7

### Patch Changes

- Internal testing release
- Updated dependencies
  - @sapporta/grid@0.2.7
  - @sapporta/shared@0.1.7
  - @sapporta/ui@0.2.7

## 0.2.6

### Patch Changes

- Release for homepage deployment pre-checks
- Updated dependencies
  - @sapporta/grid@0.2.6
  - @sapporta/shared@0.1.6
  - @sapporta/ui@0.2.6

## 0.2.5

### Patch Changes

- first iteration of auth integration
- Updated dependencies
  - @sapporta/grid@0.2.5
  - @sapporta/shared@0.1.5
  - @sapporta/ui@0.2.5

## 0.2.4

### Patch Changes

- Create Dockerfile based deployment
- Updated dependencies
  - @sapporta/grid@0.2.4
  - @sapporta/shared@0.1.4
  - @sapporta/ui@0.2.4

## 0.2.3

### Patch Changes

- Update sapporta cli install
- Updated dependencies
  - @sapporta/grid@0.2.3
  - @sapporta/shared@0.1.3
  - @sapporta/ui@0.2.3

## 0.2.2

### Patch Changes

- 3d53017: Extract sapporta grid into separate package
- Updated dependencies [3d53017]
  - @sapporta/grid@0.2.2
  - @sapporta/shared@0.1.2
  - @sapporta/ui@0.2.2
