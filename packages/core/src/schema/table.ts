import type { SQL } from "drizzle-orm";
import { type SQLiteTableWithColumns, getTableConfig } from "drizzle-orm/sqlite-core";
import type { z } from "zod";
import { drainPendingColumnMeta } from "./columns.js";
import type { ValueKind } from "@sapporta/shared/value-kind";

/**
 * Column factories live in `./columns.ts` — importing them here so users
 * can continue to write `import { timestamp } from "@sapporta/server/table"`.
 * See docs/DATA-TYPE-PRINCIPLES.md §3.
 */
export {
  money,
  percentage,
  number,
  bool,
  date,
  timestamp,
  text,
} from "./columns.js";

/** Metadata for a select/enum column */
export interface SelectMeta {
  type: "select";
  column: string;
  options: string[];
}

/** Declares a has-many child relationship for grid display */
export interface ChildMeta {
  /** SQL name of the child table */
  table: string;
  /** FK column in the child table that references this parent's PK */
  foreignKey: string;
  /** Display label (defaults to child table's label) */
  label?: string;
  /** Columns to show in nested grid (defaults to all non-PK, non-FK, non-timestamp cols) */
  columns?: string[];
  /** Default sort: "column" or "-column" (defaults to PK asc) */
  defaultSort?: string;
  /** Width hint in approximate character count (same as ColumnMeta.width) */
  width?: number;
}

/** Per-column metadata for display and behavior */
export interface ColumnMeta {
  /** Semantic value kind — stamped by the column factory. Factory-declared
   *  columns always have this; hand-declared columns (via raw `real`/`text`)
   *  do not, and downstream consumers derive the kind from Drizzle's dataType.
   *  See docs/DATA-TYPE-PRINCIPLES.md §2. */
  kind?: ValueKind;
  /** Presentation-only hint layered on top of `kind`. `currency` makes a
   *  number render as money; `percentage` renders as a percent. Does NOT
   *  participate in query semantics — money compares the same as any other
   *  number. Stamped by `money()` and `percentage()` factories. */
  displayFormat?: "currency" | "percentage";
  /** Display/editor hint for text columns. Does NOT change storage,
   *  validation, filtering, sorting, or text semantics. */
  textDisplay?: "multiLine" | "markdown";
  /** Custom column header for display */
  header?: string;
  /** Hide column from grid and drawer (auto-set for created_at/updated_at). */
  visuallyHidden?: boolean;
  /** Width hint in approximate character count */
  width?: number;
  /** Minimum width in approximate character count */
  minWidth?: number;
  /** Maximum width in approximate character count */
  maxWidth?: number;
  /** Set to false for nullable numeric columns where NULL is semantically distinct
      from 0 (e.g. an optional assertion value). Suppresses the nullable-numeric
      checker warning. */
  additive?: boolean;
  /** Numeric color rule for money/number columns. `positive` always greens the
   *  ink (debit), `negative` always reds it (credit), `signed` greens values
   *  >0 and reds values <0 (net/delta). Zero/null is always neutral. */
  colorRule?: "positive" | "negative" | "signed";
  /** How zero values render when a number is present. */
  zeroDisplay?: "blank" | "dot";
  /** When true, non-null money/number cells render in foreground ink at
   *  medium weight — marks the column as the "answer" (e.g. running balance). */
  strong?: boolean;
  /** Freeform notes describing the column's meaning, conventions, or formula */
  notes?: string;
}

/** Sapporta-specific metadata attached to a table */
export interface SapportaMeta {
  /** Display label for the table */
  label?: string;
  /** Columns whose values build a row's human-readable label — used in FK
   *  dropdowns, lookup responses, and anywhere a row is referenced rather
   *  than displayed in full. Multiple columns are concatenated with a space.
   *  When unset, a heuristic picks the first text column that is neither
   *  the PK nor an FK. */
  rowLabelColumns?: string[];
  /** Select/enum columns */
  selects?: SelectMeta[];
  /** Whether records are immutable (no update/delete) */
  immutable?: boolean;
  /** User-provided Zod validation schema (overrides auto-inferred) */
  validation?: z.ZodObject<any>;
  /** Custom save function (overrides default insert/update) */
  save?: (record: Record<string, unknown>, db: any) => Promise<any>;
  /** Default sort order applied when no explicit sort is requested.
   *  Accepts a Drizzle orderBy expression: `desc(myTable.date)` or `asc(myTable.name)`.
   *  Server-only — does not serialize to the UI schema API. */
  defaultSort?: SQL;
  /** Has-many child relationships for nested grid display */
  children?: ChildMeta[];
  /** Per-column metadata keyed by column name */
  columns?: Record<string, ColumnMeta>;
  /** Cross-column search configuration for the `q` query parameter.
   *  Columns are matched with ILIKE and OR-ed together. */
  search?: { columns: string[] };
}

/** A Sapporta table definition — wraps a Drizzle SQLite table with metadata */
export interface TableDef {
  /** The Drizzle SQLite table object */
  drizzle: SQLiteTableWithColumns<any>;
  /** SQL table name extracted from the Drizzle table */
  sqlName: string;
  /** Sapporta metadata */
  meta: SapportaMeta;
}

/** Options for the table() function */
export interface TableOptions {
  /** The Drizzle sqliteTable definition */
  drizzle: SQLiteTableWithColumns<any>;
  /** Optional sapporta metadata */
  meta?: SapportaMeta;
}

/**
 * Define a Sapporta table. Wraps a Drizzle sqliteTable with metadata.
 *
 * Usage:
 * ```ts
 * const accounts = table({
 *   drizzle: sqliteTable("accounts", { ... }),
 *   meta: { label: "Accounts" }
 * });
 * ```
 */
export function table(options: TableOptions): TableDef {
  const config = getTableConfig(options.drizzle);
  // `table()` is the join point for the public API: it combines the user's
  // separate Drizzle definition with their Sapporta metadata. It also drains
  // factory metadata from `money()`, `date()`, etc. and folds that into
  // ordinary `meta.columns` data on the returned TableDef.
  const drained = drainPendingColumnMeta(config.columns.map((c) => c.name));
  const userColumns = options.meta?.columns ?? {};
  const mergedColumns: Record<string, ColumnMeta> = { ...userColumns };
  for (const [name, factoryMeta] of drained) {
    // Explicit user metadata wins; factory metadata supplies the default
    // semantic kind and display format for Sapporta's downstream APIs.
    mergedColumns[name] = { ...factoryMeta, ...mergedColumns[name] };
  }
  return {
    drizzle: options.drizzle,
    sqlName: config.name,
    meta: {
      ...options.meta,
      ...(Object.keys(mergedColumns).length > 0 ? { columns: mergedColumns } : {}),
    },
  };
}
