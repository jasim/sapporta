import type { SQL } from "drizzle-orm";
import {
  type AnySQLiteTable,
  index,
  integer,
  sqliteTable,
  getTableConfig,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { InferInsertModel } from "drizzle-orm";
import type { Temporal } from "@sapporta/shared/temporal";
import { drainPendingColumnMeta } from "./columns.js";
import type {
  ColumnMeta as FactoryColumnMeta,
  ValueKind,
} from "@sapporta/shared/value-kind";
import {
  isSystemManagedScopeFieldName,
  type ReferenceRule,
  type RowScope,
} from "../auth/row-scope.js";

/**
 * Column factories live in `./columns.ts` — importing them here so users
 * can continue to write `import { timestamp } from "@sapporta/server/table"`.
 * See docs/DATA-TYPE-PRINCIPLES.md §3.
 */
export {
  money,
  percentage,
  number,
  select,
  bool,
  date,
  timestamp,
  text,
} from "./columns.js";
export { sqliteTable, integer, index, uniqueIndex };

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
  /** Display label for the column. Defaults are resolved during schema extraction. */
  label?: string;
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
  /** Whether callers may write this column through generated table APIs. */
  apiWritable?: boolean;
}

/** Normalized Sapporta metadata attached to a TableDef.
 *
 * Public callers provide sparse `SapportaTableInputMeta`; `sapportaTable()`
 * fills the
 * runtime defaults so downstream code can trust these table-level fields. */
export interface SapportaMeta {
  /** Display label for the table */
  label: string;
  /** Columns whose values build a row's human-readable label — used in FK
   *  dropdowns, lookup responses, and anywhere a row is referenced rather
   *  than displayed in full. Multiple columns are concatenated with a space. */
  rowLabelColumns: readonly [string, ...string[]];
  /** Whether records are immutable (no update/delete) */
  immutable: boolean;
  /**
   * Declares the row isolation boundary used by built-in table operations and
   * reference validation helpers.
   */
  rowScope: RowScope;
  /**
   * Explicit reference rules keyed by source SQL column name. Use this for
   * logical FKs that do not have Drizzle .references() metadata, or to mark
   * proven FK columns as server-managed with apiSettable: false.
   */
  references: Record<string, ReferenceRule>;
  /** Default sort order applied when no explicit sort is requested.
   *  Accepts a Drizzle orderBy expression: `desc(myTable.date)` or `asc(myTable.name)`.
   *  Server-only — does not serialize to the UI schema API. */
  defaultSort?: SQL;
  /** Has-many child relationships for nested grid display */
  children: ChildMeta[];
  /** Per-column metadata keyed by column name */
  columns: Record<string, ColumnMeta>;
  /** Cross-column search configuration for the `q` query parameter.
   *  Columns are matched with ILIKE and OR-ed together. */
  search?: { columns: string[] };
}

type SapportaMetaDefaultedField =
  "label" | "immutable" | "rowScope" | "references" | "children" | "columns";

/** Sparse public metadata accepted by `sapportaTable()`.
 *
 * These fields are optional at the authoring boundary and normalized into
 * `SapportaMeta` before the TableDef is returned. */
export type SapportaTableInputMeta = Omit<
  SapportaMeta,
  SapportaMetaDefaultedField
> & {
  label?: string;
  immutable?: boolean;
  references?: Record<string, ReferenceRule>;
  children?: ChildMeta[];
  columns?: Record<string, ColumnMeta>;
  /**
   * Defaults to `workspaceUserScoped`, the strictest row boundary. Use
   * `workspaceGlobal` or `systemGlobal` only for data that intentionally has a
   * broader visibility boundary.
   */
  rowScope?: RowScope;
};

// Validation callbacks serve inserts and patches, so their inferred value is a
// partial insert model. Temporal values use the canonical JSON string form that
// structural parsing supplies to application validation.
type CanonicalWriteValue<TValue> = TValue extends
  Temporal.PlainDate | Temporal.Instant
  ? string
  : TValue;

type CanonicalInsertValue<TTable extends AnySQLiteTable> = {
  [
    TField in keyof InferInsertModel<TTable, { dbColumnNames: true }>
  ]: CanonicalWriteValue<
    InferInsertModel<TTable, { dbColumnNames: true }>[TField]
  >;
};

export type TableValidationValue<TTable extends AnySQLiteTable> = Readonly<
  Partial<CanonicalInsertValue<TTable>>
>;

export type TableValidationField<TTable extends AnySQLiteTable> =
  (keyof InferInsertModel<TTable, { dbColumnNames: true }> & string) | "$";

export interface TableValidationContext<TTable extends AnySQLiteTable> {
  /** Inserts contain the prepared row; patches contain only submitted fields. */
  operation: "insert" | "patch";
  /** Attach an issue to a public SQL column name, or to `$` for the row. */
  addIssue(field: TableValidationField<TTable>, message: string): void;
}

/**
 * Application validation that runs after Sapporta's structural write parser.
 *
 * The callback receives canonical values, including ISO strings for date and
 * timestamp columns. It can add cross-field or domain issues. It cannot replace
 * the structural schema or transform the values that Drizzle receives. This
 * composition keeps application rules from weakening unrelated column checks.
 */
export type TableValidation<TTable extends AnySQLiteTable> = (
  value: TableValidationValue<TTable>,
  context: TableValidationContext<TTable>,
) => void;

/**
 * The complete table description consumed by Sapporta.
 *
 * Application code authors two complementary pieces. The Drizzle table owns
 * storage facts such as SQL names, nullability, defaults, primary keys, foreign
 * keys, and SQLite types. Sapporta metadata owns application semantics and
 * presentation such as value kinds, row labels, write policy, and grid hints.
 * `sapportaTable()` joins those pieces into a `TableDef`. Schema extraction,
 * generated APIs, auth, runtime validation, and table UI projections all start
 * from that same joined description.
 *
 * Values at Sapporta's public boundaries use SQL column names. Drizzle property
 * names remain an implementation detail of database access and are translated
 * by `resolveRowFields()` immediately around Drizzle calls.
 */
export interface TableDef<TTable extends AnySQLiteTable = AnySQLiteTable> {
  /** The Drizzle SQLite table object */
  drizzle: TTable;
  /** SQL table name extracted from the Drizzle table */
  sqlName: string;
  /** Sapporta metadata */
  meta: SapportaMeta;
  /** Runtime form of the application validation declared in `TableOptions`. */
  validate?(
    value: Readonly<Record<string, unknown>>,
    context: {
      operation: "insert" | "patch";
      addIssue(field: string, message: string): void;
    },
  ): void;
}

/** Options for the sapportaTable() function */
export interface TableOptions<TTable extends AnySQLiteTable> {
  /** The Drizzle sqliteTable definition */
  drizzle: TTable;
  /** Sapporta metadata */
  meta: SapportaTableInputMeta;
  /**
   * Adds operation-aware application issues after structural parsing.
   *
   * For an insert, auth and other trusted server code have already added their
   * required fields. For a patch, `value` contains only the submitted fields.
   * Field keys are inferred public SQL column names.
   */
  validate?(
    value: TableValidationValue<TTable>,
    context: TableValidationContext<TTable>,
  ): void;
}

const AUTO_MANAGED_TIMESTAMP_COLUMN_NAMES = new Set([
  "created_at",
  "updated_at",
]);

export function isAutoManagedTimestampColumn(name: string): boolean {
  return AUTO_MANAGED_TIMESTAMP_COLUMN_NAMES.has(name);
}

function normalizeSapportaMeta(
  sqlName: string,
  columnNames: readonly string[],
  input: SapportaTableInputMeta,
  factoryColumns: ReadonlyMap<string, FactoryColumnMeta>,
): SapportaMeta {
  if (input.rowLabelColumns.length === 0) {
    throw new Error(
      `Table "${sqlName}" must declare at least one row label column.`,
    );
  }

  const knownColumns = new Set(columnNames);
  for (const name of input.rowLabelColumns) {
    if (!knownColumns.has(name)) {
      throw new Error(
        `Table "${sqlName}" rowLabelColumns includes unknown column "${name}".`,
      );
    }
  }

  const userColumns = input.columns ?? {};
  const columns: Record<string, ColumnMeta> = {};

  for (const name of columnNames) {
    const systemManagedScopeField = isSystemManagedScopeFieldName(name);
    columns[name] = {
      ...(isAutoManagedTimestampColumn(name) ? { visuallyHidden: true } : {}),
      ...factoryColumns.get(name),
      ...userColumns[name],
      // Ownership fields are implementation details of row scoping. Unlike
      // timestamp defaults, applications cannot opt them back into ordinary
      // table presentation.
      ...(systemManagedScopeField ? { visuallyHidden: true } : {}),
    };
  }

  for (const [name, meta] of Object.entries(userColumns)) {
    if (name in columns) continue;
    columns[name] = meta;
  }

  return {
    ...input,
    label: input.label ?? sqlName,
    immutable: input.immutable ?? false,
    rowScope: input.rowScope ?? "workspaceUserScoped",
    references: input.references ?? {},
    children: input.children ?? [],
    columns,
  };
}

/**
 * Define the joined table description used throughout Sapporta.
 *
 * Usage:
 * ```ts
 * const invoiceTable = sqliteTable("invoices", {
 *   id: integer("id").primaryKey({ autoIncrement: true }),
 *   status: select("status", ["draft", "issued", "paid"]),
 *   total: money("total").notNull(),
 * });
 *
 * const invoices = sapportaTable({
 *   drizzle: invoiceTable,
 *   meta: { label: "Invoices", rowLabelColumns: ["id"] },
 *   validate(value, context) {
 *     if (context.operation === "insert" && value.total === 0) {
 *       context.addIssue("total", "Total must be greater than zero.");
 *     }
 *   },
 * });
 * ```
 *
 * The select options above drive Drizzle typing, server Zod validation, and
 * frontend select metadata from one column declaration. The validation
 * callback adds an application rule after structural parsing.
 */
export function sapportaTable<TTable extends AnySQLiteTable>(
  options: TableOptions<TTable>,
): TableDef<TTable> {
  const config = getTableConfig(options.drizzle);
  // This is the join point for the public API: it combines the user's separate
  // Drizzle definition with their Sapporta metadata. It also drains factory
  // metadata from `money()`, `date()`, etc. and folds that into ordinary
  // `meta.columns` data on the returned TableDef.
  const columnNames = config.columns.map((c) => c.name);
  const drained = drainPendingColumnMeta(columnNames);
  return {
    drizzle: options.drizzle,
    sqlName: config.name,
    meta: normalizeSapportaMeta(
      config.name,
      columnNames,
      options.meta,
      drained,
    ),
    validate: options.validate
      ? (value, context) =>
          options.validate!(
            value as TableValidationValue<TTable>,
            context as TableValidationContext<TTable>,
          )
      : undefined,
  };
}
