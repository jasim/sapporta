/**
 * `attachReferenceComputed()`: computes, once per report, the computed fields
 * that the tables named by a report's `reference` columns draw, and puts them
 * in the dataset's `computed` member.
 */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ComputedValues } from "@sapporta/shared/contracts";
import {
  gridDatasetReferenceIds,
  type GridDataset,
} from "@sapporta/shared/grid-dataset";
import type { SapportaAuthContext } from "../auth/context.js";
import type { TableCatalog } from "../schema/catalog.js";
import type { TableDef } from "../schema/table.js";
import { computeFields } from "./computed-fields.js";

export interface AttachReferenceComputedInput {
  db: BetterSQLite3Database;
  auth: SapportaAuthContext;
  /** The app's tables, as a list or as the table catalog. */
  tables: readonly TableDef[] | Pick<TableCatalog, "get">;
  /** More computed fields to compute, by table name, such as the fields an
   *  app's `label` slot `needs`. */
  names?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Computes the fields that the rows named by the dataset's `reference`
 * columns are drawn with: each referenced table's `rowCaption` when it is a
 * computed field, and the fields `names` lists for the table. It collects
 * the ids of each table across every level, node, child and footer row, and
 * runs `computeFields` once per table. It returns the dataset with
 * `computed` set; tables with nothing to compute are left out.
 *
 * `computeFields` does not check that the request may read the ids it is
 * given. Call this only on a dataset whose ids come from the report's own
 * scoped reads, such as `scopedRows()` or SQL filtered by the same rules.
 *
 * ```ts
 * const dataset = buildLedgerDataset(rows);
 * return c.json(await attachReferenceComputed(dataset, { db, auth, tables }));
 * ```
 */
export async function attachReferenceComputed(
  dataset: GridDataset,
  input: AttachReferenceComputedInput,
): Promise<GridDataset> {
  const lookupTable = tableLookup(input.tables);
  const work: Array<Promise<[string, ComputedValues]>> = [];
  for (const [tableName, ids] of gridDatasetReferenceIds(dataset)) {
    const table = lookupTable(tableName);
    if (!table) {
      throw new Error(
        `Dataset "${dataset.name}" references table "${tableName}", which is not one of the app's tables.`,
      );
    }
    const names = new Set(input.names?.[tableName] ?? []);
    const caption = table.meta.rowCaption;
    if (caption !== undefined && table.computed?.[caption]) names.add(caption);
    if (names.size === 0 || ids.length === 0) continue;
    work.push(
      computeFields({
        db: input.db,
        auth: input.auth,
        table,
        ids,
        names: Array.from(names),
      }).then((values) => [tableName, values]),
    );
  }
  if (work.length === 0) return dataset;

  const computed: Record<string, ComputedValues> = { ...dataset.computed };
  for (const [tableName, values] of await Promise.all(work)) {
    computed[tableName] = { ...computed[tableName], ...values };
  }
  return { ...dataset, computed };
}

function tableLookup(
  tables: AttachReferenceComputedInput["tables"],
): (name: string) => TableDef | undefined {
  if (!isTableList(tables)) return (name) => tables.get(name);
  const byName = new Map(tables.map((table) => [table.sqlName, table]));
  return (name) => byName.get(name);
}

function isTableList(
  tables: AttachReferenceComputedInput["tables"],
): tables is readonly TableDef[] {
  return Array.isArray(tables);
}
