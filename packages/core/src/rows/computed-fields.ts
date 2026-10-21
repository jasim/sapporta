/**
 * `computeFields()`: runs the loaders of a table's computed fields for one
 * batch of rows and returns their values as a side map.
 *
 * The generated table API calls it after each read that names fields in its
 * `computed` parameter, and application code can call it after its own reads.
 * It does nothing else: no HTTP, no paging and no row reads.
 *
 * Rules the result keeps, so that a client never has to guess what a missing
 * value means:
 * - every requested field holds a value for every id of the batch, and `null`
 *   is the only "no value";
 * - a loader that throws, or that leaves an id out, fails the whole call.
 *
 * Loaders run concurrently, each once per call. Two fields that come from the
 * same query share it through `batch.once()`.
 */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { ComputedValues, Json } from "@sapporta/shared/contracts";
import type { RecordId } from "@sapporta/shared/record-id";
import type { SapportaAuthContext } from "../auth/context.js";
import type { ComputedBatch, ComputedField } from "../schema/computed-field.js";
import type { TableDef } from "../schema/table.js";

export interface ComputeFieldsInput<TTable extends AnySQLiteTable> {
  db: BetterSQLite3Database;
  auth: SapportaAuthContext;
  table: TableDef<TTable>;
  /** Primary keys of rows the request may read, such as the rows a scoped
   *  read just returned. */
  ids: readonly RecordId[];
  /** Names of computed fields of `table`. */
  names: readonly string[];
}

/**
 * Computes the named fields of `table` for a batch of rows. The result maps
 * each field name to the batch's ids and their values.
 *
 * ```ts
 * const overdue = await scopedRows(db, auth, invoices).findMany({ where, limit: 100 });
 * const balances = await computeFields({
 *   db, auth, table: customers,
 *   ids: [...new Set(overdue.map((i) => String(i.customer_id)))],
 *   names: ["balance"],
 * });
 * ```
 */
export async function computeFields<TTable extends AnySQLiteTable>(
  input: ComputeFieldsInput<TTable>,
): Promise<ComputedValues> {
  const { db, auth, ids } = input;
  const table = input.table as TableDef;
  const fields = table.computed ?? {};
  const names = Array.from(new Set(input.names));
  for (const name of names) requireField(table, fields, name);
  if (names.length === 0) return {};

  const shared = new Map<string, Promise<unknown>>();
  const batch: ComputedBatch = {
    table,
    ids,
    db,
    auth,
    once: <T>(key: string, compute: () => Promise<T>): Promise<T> => {
      let result = shared.get(key);
      if (!result) {
        result = compute();
        shared.set(key, result);
      }
      return result as Promise<T>;
    },
  };

  const results = await Promise.all(
    names.map(async (name) => {
      const field = fields[name]!;
      return checkValues(table, name, field, ids, await field.load(batch));
    }),
  );
  const computed: ComputedValues = {};
  names.forEach((name, index) => {
    const values = results[index]!;
    const byId: Record<string, Json> = {};
    for (const id of ids) byId[id] = values.get(id) ?? null;
    computed[name] = byId;
  });
  return computed;
}

function requireField(
  table: TableDef,
  fields: Readonly<Record<string, ComputedField>>,
  name: string,
): void {
  if (!Object.hasOwn(fields, name)) {
    const known = Object.keys(fields);
    throw new Error(
      `Table "${table.sqlName}" has no computed field "${name}". ${known.length > 0 ? `Its computed fields are: ${known.join(", ")}.` : "It declares no computed fields."}`,
    );
  }
}

function checkValues(
  table: TableDef,
  name: string,
  field: ComputedField,
  ids: readonly RecordId[],
  values: ReadonlyMap<RecordId, Json>,
): ReadonlyMap<RecordId, Json> {
  const missing = ids.filter((id) => !values.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Computed field "${table.sqlName}.${name}" returned no value for id(s) ${missing.join(", ")}. Return null for a row that has no value.`,
    );
  }
  if (field.schema) {
    for (const id of ids) {
      const value = values.get(id);
      if (value === null) continue;
      const parsed = field.schema.safeParse(value);
      if (!parsed.success) {
        throw new Error(
          `Computed field "${table.sqlName}.${name}" returned a value for id ${id} that does not match its schema: ${parsed.error.message}`,
        );
      }
    }
  }
  return values;
}
