/**
 * Computed fields: named values of each row that the server computes at read
 * time, such as an account's parent path or an item's stock on hand.
 *
 * A computed field is not a column. It is not stored, cannot be written, and is
 * not part of the row object. A read names the fields it wants in its
 * `computed` parameter, and the response carries their values beside the rows,
 * keyed by field name and then by row id. `computeFields()` runs the loaders;
 * this module holds only the declarations, so schema files can import it
 * without loading the row engine.
 */
import type { z } from "zod";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { RecordId } from "@sapporta/shared/record-id";
import type { Json } from "@sapporta/shared/contracts";
import type { ValueKind } from "@sapporta/shared/value-kind";
import type { SapportaAuthContext } from "../auth/context.js";
import type { TableDef } from "./table.js";

/** How a computed value reads. `"json"` is anything that is not one scalar,
 *  such as a series of numbers for a graph. */
export type ComputedFieldKind = ValueKind | "json";

/**
 * The rows one loader run computes values for, and what the loader may use to
 * compute them.
 */
export interface ComputedBatch<TTable extends AnySQLiteTable = AnySQLiteTable> {
  /** The table whose rows these are. */
  readonly table: TableDef<TTable>;
  /** The rows to compute for, as primary keys, in the order the read
   *  returned them. Read the rows themselves, or other tables, through
   *  `scopedRows(batch.db, batch.auth, table)`. */
  readonly ids: readonly RecordId[];
  /**
   * Runs `compute` once per batch for each `key`, and gives every caller the
   * same result. Use it when two fields come from one query, such as buy and
   * sell volume from one scan of trades, or when one field is built from
   * another's values: both call the same function through `once`.
   */
  once<T>(key: string, compute: () => Promise<T>): Promise<T>;
  readonly db: BetterSQLite3Database;
  /** The auth of the request. Read other tables through
   *  `scopedRows(batch.db, batch.auth, table)`, so values never come from rows
   *  the request may not read. */
  readonly auth: SapportaAuthContext;
}

/**
 * Computes a field's values for a batch of rows. The returned map must hold
 * every id of the batch; use `null` for a row that has no value. A missing id
 * fails the read.
 */
export type ComputedFieldLoader<
  TTable extends AnySQLiteTable = AnySQLiteTable,
  TValue extends Json = Json,
> = (
  batch: ComputedBatch<TTable>,
) =>
  | Promise<ReadonlyMap<RecordId, TValue | null>>
  | ReadonlyMap<RecordId, TValue | null>;

/** One computed field of a table. */
export interface ComputedField<
  TTable extends AnySQLiteTable = AnySQLiteTable,
  TValue extends Json = Json,
> {
  /** How the value reads. It chooses the default formatting, and it is listed
   *  in the table's metadata. */
  kind: ComputedFieldKind;
  /** Display label. Defaults to the name in title case, as for columns. */
  label?: string;
  /** Notes on what the value means, shown in the table's metadata. */
  notes?: string;
  /**
   * Schema of one value. Every value except `null` is checked against it,
   * and it documents the value in the generated OpenAPI.
   */
  schema?: z.ZodType<TValue>;
  /**
   * Computes the values for a batch of rows. It runs inside reads, including
   * the lookups a picker sends while someone types, so it must not write.
   */
  load: ComputedFieldLoader<TTable, TValue>;
  /** Set by `treePath()`: the field is a tree table's parent path, joined
   *  with `separator`. `meta.tree.path` names such a field. */
  treePath?: { readonly separator: string };
}

/**
 * Declares a computed field. It returns its argument; it exists so that
 * TypeScript infers the value type from `schema` or from `load`.
 *
 * ```ts
 * computed: {
 *   onHand: computedField({
 *     kind: "number",
 *     load: ({ ids, db, auth }) => loadOnHand(db, auth, ids),
 *   }),
 * }
 * ```
 */
export function computedField<
  TTable extends AnySQLiteTable = AnySQLiteTable,
  TValue extends Json = Json,
>(field: ComputedField<TTable, TValue>): ComputedField<TTable, TValue> {
  return field;
}

const COMPUTED_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Checks the computed field names of a table and its `rowCaption`. A field may
 * not share a name with a column, so a name in `rowCaption` or in a request
 * always means one thing.
 */
export function checkComputedFields(
  sqlName: string,
  columnNames: readonly string[],
  computed: Readonly<Record<string, ComputedField>>,
  rowCaption: string | undefined,
): void {
  const columns = new Set(columnNames);
  for (const name of Object.keys(computed)) {
    if (name.startsWith("$")) {
      throw new Error(
        `Table "${sqlName}" computed field "${name}" starts with "$", which Sapporta reserves.`,
      );
    }
    if (!COMPUTED_FIELD_NAME.test(name)) {
      throw new Error(
        `Table "${sqlName}" computed field "${name}" must start with a letter or "_" and contain only letters, digits and "_".`,
      );
    }
    if (columns.has(name)) {
      throw new Error(
        `Table "${sqlName}" computed field "${name}" has the name of a column. Give it a different name.`,
      );
    }
  }
  if (
    rowCaption !== undefined &&
    !columns.has(rowCaption) &&
    !Object.hasOwn(computed, rowCaption)
  ) {
    throw new Error(
      `Table "${sqlName}" rowCaption names "${rowCaption}", which is neither a column nor a computed field.`,
    );
  }
}
