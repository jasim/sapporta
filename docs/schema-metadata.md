# Schema Metadata

`sapportaTable({ drizzle, meta })` attaches application metadata to a Drizzle
table. Sapporta uses that metadata in three places:

- Generated table APIs: validation, row visibility, search, sorting, lookup,
  update/delete policy, OpenAPI request/response shapes, and master-detail
  create payloads.
- Metadata APIs: `/api/meta/tables` and `/api/meta/tables/:name` serialize the
  parts the frontend needs.
- Frontend table UI: table titles, grid columns, forms, filters, lookup fields,
  search controls, and expandable child levels.

The public schema shape lives in `packages/core/src/schema/table.ts`. The
serialized frontend shape lives in `packages/shared/src/contracts/meta-schema.ts`.

## Table Metadata

```ts
export const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    label: "Accounts",
    rowScope: "workspaceUserScoped",
    rowLabelColumns: ["name"],
    search: { columns: ["name", "code"] },
    selects: [
      { type: "select", column: "account_type", options: ["asset", "expense"] },
    ],
    children: [
      {
        table: "journal_lines",
        foreignKey: "account_id",
        label: "Journal Lines",
        defaultSort: "-created_at",
      },
    ],
    columns: {
      workspace_id: { visuallyHidden: true },
      scoped_to_user_id: { visuallyHidden: true },
      opening_balance: { additive: false },
      balance: { strong: true },
    },
  },
});
```

### `label`

Human-facing table name. Serialized to the frontend and used by built-in table
navigation, page titles, toolbar titles, and child labels when a child relation
does not provide its own `label`.

Defaults to the SQL table name when omitted. Declare it for tables users see.

### `rowLabelColumns`

Required non-empty list of columns used to build a row's human-readable label.
Lookup endpoints and foreign-key controls use this label instead of showing raw
IDs. Multiple columns are joined with a space; if all label values are empty,
Sapporta falls back to the primary key.

Use stable, human-readable columns such as `name`, `invoice_number`, `title`,
or `first_name` plus `last_name`.

### `selects`

Declares enum-like text columns:

```ts
selects: [
  { type: "select", column: "status", options: ["draft", "posted", "void"] },
]
```

Effects:

- Generated create/update validation accepts only the listed option values.
- OpenAPI row and insert schemas use enum values for that column.
- Frontend grids and forms render select controls.
- Filters can use fixed-value pickers for the column.

Values must match the values stored in the database. If users can manage the
option set, use a reference table and foreign key instead.

### `immutable`

Marks a table append-only. Generated update and delete operations return an
error; reads, lookup, export, and create still work. The built-in frontend also
omits the new-record action where appropriate and disables grid editing.

Use for ledgers, posted journal lines, audit logs, and other records whose
history should be preserved.

### `validation`

Optional custom Zod object used by the save pipeline instead of the schema
Sapporta infers from Drizzle columns and `selects`.

Use this only when table-level validation must go beyond column shape. Keep
cross-row, multi-table, or request-specific business rules in custom endpoint
code rather than hiding them in table metadata.

### `rowScope`

Declares the row visibility boundary used by generated table APIs and reference
validation:

- `workspaceUserScoped`: requires `workspace_id` and `scoped_to_user_id`.
- `workspaceGlobal`: requires `workspace_id`.
- `systemGlobal`: no workspace predicate; for installation-wide reference data.

Sapporta currently defaults omitted `rowScope` to `workspaceUserScoped`, but app
schemas should declare it explicitly. Auth boundaries are design decisions.

### `references`

Explicit reference rules keyed by source SQL column:

```ts
references: {
  customer_id: { table: "customers" },
  invoice_id: { table: "invoices", clientCanSet: false },
}
```

Prefer Drizzle `.references()` for physical foreign keys. Use `meta.references`
for logical references that Drizzle cannot prove, or to mark an otherwise valid
reference as server-managed with `clientCanSet: false`.

Generated writes validate that referenced rows are visible in the active row
scope, not merely that the primary key exists.

### `defaultSort`

Server-only default ordering for generated list and export operations when the
request does not include `sort=...`.

This is a Drizzle order expression such as `asc(accountsTable.name)` or
`desc(journalEntriesTable.posted_at)`. It is not serialized through the schema
metadata API. Frontend route state, explicit `sort=...`, and child
`defaultSort` are separate concepts.

### `children`

Declares has-many relationships from this table to source/child tables. Sapporta
does not infer parent-to-child navigation from inbound FKs; add a child entry
when users need to inspect, create, or navigate those rows from the parent.

`children` affects:

- Metadata API child schema.
- Expandable built-in table levels.
- Generated row-level drill-into links.
- Master-detail create request and response schemas.

### `columns`

Per-column metadata keyed by SQL column name. Factory-declared columns also add
metadata here automatically: `money()` stamps `kind: "number"` and
`displayFormat: "currency"`, `date()` stamps `kind: "date"`, and so on.

### `search`

Opt-in cross-column search for generated list and export queries:

```ts
search: { columns: ["name", "notes"] }
```

When declared, `GET /api/tables/<name>?q=cash` ORs `LIKE '%cash%'` across the
listed columns and ANDs that group with normal filters. Empty or whitespace-only
`q` is ignored. Sending `q` to a table without `search` returns 400.

The frontend toolbar renders a search input only when `search` is declared.

## Child Metadata

```ts
children: [
  {
    table: "order_items",
    foreignKey: "order_id",
    label: "Line Items",
    columns: ["product", "qty"],
    defaultSort: "line_no",
    width: 32,
  },
]
```

### `table`

SQL name of the child/source table.

### `foreignKey`

Column on the child table that points at this parent table's primary key. Child
level loads use this as the parent-row filter, and master-detail create uses it
to backfill the new parent ID into detail rows.

### `label`

Human-facing child collection label. Defaults to the child table's `label`.

### `columns`

Intended visible column subset for nested child display. The schema metadata API
serializes this field. Check the current frontend path before relying on it for
the built-in schema grid: the schema-driven TGrid currently builds child columns
from the child table schema.

### `defaultSort`

Default sort for source-owned child levels. Use `"column"` for ascending or
`"-column"` for descending. Defaults to the child primary key when omitted.

### `width`

Serialized width hint for the child relation. It is metadata for consumers; the
current built-in schema grid does not apply it directly.

## Column Metadata

### `kind`

Semantic value kind: `"text"`, `"number"`, `"boolean"`, `"date"`, or
`"timestamp"`. Sapporta column factories stamp this automatically. Hand-declared
raw Drizzle columns fall back to storage-derived kind during schema extraction.

`kind` drives validation, filter operator applicability, typed filter parsing,
and frontend display/editor selection.

### `displayFormat`

Presentation hint on numeric columns: `"currency"` or `"percentage"`.
`money()` and `percentage()` stamp this automatically. It does not change query
semantics: currency values compare, filter, and sort as numbers.

### `textDisplay`

Text presentation/editor hint:

- `"multiLine"` for long plain text such as notes, descriptions, addresses, or
  instructions.
- `"markdown"` for user-authored formatted text.

This does not change storage, validation, filtering, sorting, or search.

### `label`

Human-facing column label. Defaults are derived from the column name. Used by
metadata consumers, built-in grids, forms, filters, and report-like table
surfaces.

### `visuallyHidden`

Hides a column from built-in frontend table grids, forms, and filter controls.
`created_at` and `updated_at` are auto-hidden unless explicitly overridden.

This is a visual hint only. Generated API responses and CSV export can still
include the underlying column.

### `width`, `minWidth`, `maxWidth`

Character-count sizing hints for grid columns. `width` is fixed;
`minWidth`/`maxWidth` provide flexible bounds.

### `additive`

Set `additive: false` on nullable numeric columns where `NULL` is meaningfully
different from zero, such as an optional assertion value. This suppresses the
boot-time nullable-numeric warning.

Leave additive measures such as debit, credit, quantity, and amount as
non-null with a default zero instead.

### `colorRule`

Numeric color hint:

- `"positive"`: non-zero values use positive coloring.
- `"negative"`: non-zero values use negative coloring.
- `"signed"`: positive values use positive coloring and negative values use
  negative coloring.

Zero and null stay neutral.

### `zeroDisplay`

Controls how numeric zero renders: `"blank"` or `"dot"`. The stored value
remains zero.

### `strong`

Marks an important numeric answer column, such as a running balance or final
amount. Built-in numeric cells render non-null values with stronger foreground
emphasis.

### `notes`

Freeform developer-facing notes about the column's meaning, units, conventions,
or formula. This is serialized in schema metadata but not currently rendered by
the standard table UI.

### `clientEditable`

`clientEditable: false` tells generated frontend forms to omit the column.
Auth boot validation also rejects `clientEditable: true` on system-managed
scope fields.

Treat this as a UI and policy hint, not as the only server-side protection for
arbitrary fields. Server-managed references should use `meta.references` with
`clientCanSet: false`; scope fields are protected by row security.
