/**
 * `treePath()`: a computed field that gives each row of a tree table the
 * labels of its ancestors, from the top down, such as "Expenses > Kitchen" for
 * an account named Groceries.
 *
 * One recursive common table expression (CTE) per batch collects the batch's
 * rows and all their ancestors. Like the tree search in `tree-rows.ts`, every
 * step of the walk reads only rows the request may see, so a path stops at
 * the nearest ancestor the request cannot read and never names it. `UNION`
 * removes rows already reached, so a loop in the data ends the walk.
 */
import { inArray, sql, type SQL } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { RecordId } from "@sapporta/shared/record-id";
import { toRecordId } from "@sapporta/shared/record-id";
import { columnBySqlName } from "../schema/column.js";
import type { SapportaAuthContext } from "../auth/context.js";
import type { ComputedBatch, ComputedField } from "../schema/computed-field.js";
import type { TableDef } from "../schema/table.js";
import { findPkColumn, primaryKeyValues } from "../schema/pk.js";
import { labelValueSql, rowLabeller, rowLabelSql } from "./row-label.js";
import { resolveRowFields } from "./row-fields.js";

export interface TreePathOptions {
  /** Placed between two ancestors' labels. Defaults to `" > "`. */
  separator?: string;
  /** Column whose value names each ancestor. Defaults to the row label. */
  column?: string;
  /** Display label of the field. */
  label?: string;
}

/**
 * A computed field for a table with `meta.tree`: the labels of each row's
 * ancestors, from the top down, joined by `separator`. A top-level row has no
 * value (`null`).
 *
 * ```ts
 * meta: {
 *   rowLabelColumns: ["name"],
 *   tree: { parentColumn: "parent_id" },
 *   rowCaption: "parentPath",
 * },
 * computed: { parentPath: treePath() },
 * ```
 */
export function treePath(options: TreePathOptions = {}): ComputedField {
  const separator = options.separator ?? " > ";
  return {
    kind: "text",
    ...(options.label !== undefined ? { label: options.label } : {}),
    notes: "Labels of the row's ancestors, from the top down.",
    load: (batch) => loadTreePaths(batch, separator, options.column),
  };
}

async function loadTreePaths(
  batch: ComputedBatch,
  separator: string,
  column: string | undefined,
): Promise<ReadonlyMap<RecordId, string | null>> {
  const { table, db, auth } = batch;
  const tree = table.meta.tree;
  if (!tree) {
    throw new Error(
      `Table "${table.sqlName}" uses treePath() but does not declare meta.tree.`,
    );
  }
  const paths = new Map<RecordId, string | null>();
  if (batch.ids.length === 0) return paths;

  const pk = findPkColumn(table);
  const parent = requireColumn(table, tree.parentColumn);
  const labeller = rowLabeller(table);
  const nameColumns = column === undefined ? labeller.labelColumns : [column];
  const fields = resolveRowFields(
    table,
    Array.from(new Set([pk.name, tree.parentColumn, ...nameColumns])),
  );
  const access = auth.rowSecurity.forTable(table);
  const tableName = sql.identifier(getTableConfig(table.drizzle).name);
  const visible = sql.identifier("sapporta_path_visible");
  const reached = sql.identifier("sapporta_path_reached");
  const id = sql.identifier("id");
  const parentId = sql.identifier("parent_id");
  const starts = primaryKeyValues(table, batch.ids);

  const reachedIds = sql`with recursive ${visible}(${id}, ${parentId}) as (select ${pk}, ${parent} from ${tableName} where ${access.ownedRows()}), ${reached}(${id}) as (select ${pk} from ${tableName} where ${access.ownedRows(inArray(pk, starts))} union select ${visible}.${parentId} from ${visible} join ${reached} on ${visible}.${id} = ${reached}.${id} join ${visible} as ${sql.identifier("p")} on ${sql.identifier("p")}.${id} = ${visible}.${parentId}) select ${id} from ${reached}`;

  const rows = (await db
    .select(fields.databaseSelection)
    .from(table.drizzle)
    .where(access.ownedRows(sql`${pk} in (${reachedIds})`))) as Record<
    string,
    unknown
  >[];

  const byId = new Map<RecordId, Record<string, unknown>>();
  for (const row of rows) {
    byId.set(toRecordId(row[pk.name] as string | number), row);
  }
  const nameOf = (row: Record<string, unknown>): string =>
    column === undefined ? labeller.label(row) : String(row[column] ?? "");

  for (const startId of batch.ids) {
    const names: string[] = [];
    const seen = new Set<RecordId>([startId]);
    let current = byId.get(startId);
    while (current) {
      const parentValue = current[tree.parentColumn];
      if (parentValue === null || parentValue === undefined) break;
      const parentKey = toRecordId(parentValue as string | number);
      if (seen.has(parentKey)) break;
      seen.add(parentKey);
      current = byId.get(parentKey);
      if (current) names.push(nameOf(current));
    }
    paths.set(
      startId,
      names.length > 0 ? names.reverse().join(separator) : null,
    );
  }
  return paths;
}

export interface TreePathRelationOptions {
  /** Name of the relation in the `with recursive` list. Defaults to
   *  `tree_paths`. */
  name?: string;
  /** Placed between two ancestors' labels. Defaults to `" > "`. */
  separator?: string;
  /** Column whose value names each row. Defaults to the row label. */
  column?: string;
}

/**
 * The paths of a tree table's rows as a SQL relation, for reports and other
 * code that runs raw SQL. It gives the same paths as `treePath()`.
 *
 * The result is one member of a `with recursive` list, named `tree_paths`
 * unless `name` says otherwise, with three columns:
 *
 * - `id`: the row's primary key.
 * - `parent_path`: the labels of the row's ancestors, from the top down,
 *   joined by `separator`; NULL for a row with no visible parent.
 * - `path`: `parent_path`, the separator and the row's own label, or only
 *   the row's own label.
 *
 * It reads only the rows `auth` may see. A path stops at the nearest
 * ancestor the request cannot see, as `treePath()`'s does. Rows in a loop of
 * parents that never reaches a top-level row, and the rows under them, have
 * no row in the relation.
 *
 * ```ts
 * const paths = treePathRelation(accounts, auth);
 * db.all(sql`with recursive ${paths}
 *   select a.name, p.parent_path from accounts a
 *   left join tree_paths p on p.id = a.id`);
 * ```
 */
export function treePathRelation(
  table: TableDef,
  auth: SapportaAuthContext,
  options: TreePathRelationOptions = {},
): SQL {
  const tree = table.meta.tree;
  if (!tree) {
    throw new Error(
      `Table "${table.sqlName}" uses treePathRelation() but does not declare meta.tree.`,
    );
  }
  const separator = options.separator ?? " > ";
  const pk = findPkColumn(table);
  const parent = requireColumn(table, tree.parentColumn);
  const label =
    options.column === undefined
      ? rowLabelSql(table)
      : sql`coalesce(${labelValueSql(requireColumn(table, options.column))}, '')`;
  const access = auth.rowSecurity.forTable(table);
  const tableName = sql.identifier(getTableConfig(table.drizzle).name);
  const name = sql.identifier(options.name ?? "tree_paths");
  const id = sql.identifier("sapporta_id");
  const parentId = sql.identifier("sapporta_parent_id");
  const rowLabel = sql.identifier("sapporta_label");
  const v = sql.identifier("v");

  // Each visible row is read through a subquery, so the table's own column
  // names never clash with the relation's `id` and `path`.
  const visible = sql`(select ${pk} as ${id}, ${parent} as ${parentId}, ${label} as ${rowLabel} from ${tableName} where ${access.ownedRows()})`;

  // The walk starts at every visible row whose parent is NULL or hidden, and
  // goes down one level of visible children per step.
  return sql`${name}(id, parent_path, path) as (select ${v}.${id}, null, ${v}.${rowLabel} from ${visible} as ${v} where ${v}.${parentId} is null or ${v}.${parentId} not in (select ${id} from ${visible}) union all select ${v}.${id}, ${name}.path, ${name}.path || ${separator} || ${v}.${rowLabel} from ${visible} as ${v} join ${name} on ${v}.${parentId} = ${name}.id)`;
}

function requireColumn(table: TableDef, name: string): SQLiteColumn {
  const column = columnBySqlName(table, name);
  if (!column) {
    throw new Error(
      `Tree column "${table.sqlName}.${name}" could not be bound.`,
    );
  }
  return column;
}
