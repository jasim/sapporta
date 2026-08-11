# @sapporta/server

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
