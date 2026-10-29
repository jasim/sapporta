/**
 * Filter and search results for tree tables (`meta.tree`).
 *
 * In a tree table each row may name a parent row of the same table, such as an
 * account's `parent_id`. When such a table is filtered or searched, a match
 * deep in the tree must still be shown under its ancestors. For example, a
 * search for "federal" in an accounts table returns Federal together with its
 * ancestors Taxes and Expenses. The ancestors that do not match themselves are
 * called context rows, and the response lists them so the grid can style them.
 *
 * A tree read takes two conditions. The fixed condition bounds the rows the
 * list may return at all, such as a page's fixed filter `archived = false` or
 * a child list's parent key. The match condition, built from the user's
 * filters and search, selects the matches among those rows. Ancestors and
 * descendants are kept only when they satisfy the fixed condition, so a
 * search for a parent's name does not bring back its archived children.
 *
 * The walk is a recursive common table expression (CTE). Drizzle has no
 * builder for recursive CTEs in SQLite, so it is written with `sql` templates
 * here, in one place. The first CTE collects the rows that the caller may see
 * under the table's row security and that satisfy the fixed condition. Every
 * step of the walk reads from that set, so a walk stops at a row outside it
 * and never returns such a row. `UNION` (rather than `UNION ALL`) removes rows
 * that were already reached, so a loop in the data ends the recursion.
 *
 * The result is a predicate on the table's primary key. The `treeMatch()`
 * operation of `scopedRows()` returns it as an ordinary `where`, so the caller
 * can pass it to `page`, `findMany`, `scan`, or `count`, and ordering, paging,
 * and public-column picking stay the same as for any other read.
 */
import { and, sql, type SQL } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TreeMatchContext } from "@sapporta/shared/contracts";
import { toRecordId, type RecordId } from "@sapporta/shared/record-id";
import type { SapportaAuthContext } from "../auth/context.js";
import { columnBySqlName } from "../schema/column.js";
import { findPkColumn } from "../schema/pk.js";
import type { TableDef, TreeMeta } from "../schema/table.js";

export interface TreeMatchInput {
  /**
   * A condition every returned row satisfies, such as a child list's parent
   * key or a page's fixed filters. The ancestors and descendants kept around
   * the matches must satisfy it too.
   */
  readonly fixed?: SQL;
  /** Selects the matches among the rows that satisfy `fixed`. */
  readonly match: SQL;
  /**
   * `"ancestors"` keeps each match's ancestors. `"ancestors-and-descendants"`
   * also keeps every descendant of a match.
   */
  readonly matchContext: TreeMatchContext;
}

export interface TreeMatchPredicates {
  /** Matches, their ancestors, and (by mode) their descendants. */
  readonly rows: SQL;
  /** Ancestors that are neither matches nor inside a matched subtree. */
  readonly context: SQL;
}

export function treeMatchPredicates(
  table: TableDef,
  tree: TreeMeta,
  auth: SapportaAuthContext,
  input: TreeMatchInput,
): TreeMatchPredicates {
  const tableName = sql.identifier(getTableConfig(table.drizzle).name);
  const pk = findPkColumn(table);
  const parent = requireColumn(table, tree.parentColumn);
  const access = auth.rowSecurity.forTable(table);

  const reachable = sql.identifier("sapporta_tree_reachable");
  const matched = sql.identifier("sapporta_tree_matched");
  const up = sql.identifier("sapporta_tree_up");
  const down = sql.identifier("sapporta_tree_down");
  const id = sql.identifier("id");
  const parentId = sql.identifier("parent_id");

  // `up` holds the matches and their ancestors. The descendants branch is
  // recursive only when subtrees are kept; with `ancestors` the "down" set is
  // exactly the matches.
  const descendants =
    input.matchContext === "ancestors-and-descendants"
      ? sql` union select ${reachable}.${id} from ${reachable} join ${down} on ${reachable}.${parentId} = ${down}.${id}`
      : sql``;

  const ctes = sql`with recursive ${reachable}(${id}, ${parentId}) as (select ${pk}, ${parent} from ${tableName} where ${access.ownedRows(input.fixed)}), ${matched}(${id}) as (select ${pk} from ${tableName} where ${access.ownedRows(and(input.fixed, input.match))}), ${up}(${id}, ${parentId}) as (select ${reachable}.${id}, ${reachable}.${parentId} from ${reachable} join ${matched} on ${reachable}.${id} = ${matched}.${id} union select ${reachable}.${id}, ${reachable}.${parentId} from ${reachable} join ${up} on ${reachable}.${id} = ${up}.${parentId}), ${down}(${id}) as (select ${id} from ${matched}${descendants})`;

  return {
    rows: sql`${pk} in (${ctes} select ${id} from ${down} union select ${id} from ${up})`,
    context: sql`${pk} in (${ctes} select ${id} from ${up} except select ${id} from ${down})`,
  };
}

/**
 * A predicate on the primary key that keeps every row except `id` and the
 * rows below it, such as the choices for a row's parent, where picking the
 * row itself or one of its descendants would make a loop.
 *
 * The walk goes through every row of the table, not only the ones the
 * caller may see: a row under `id` through a hidden row is still below it.
 * The predicate only removes rows, so it shows the caller nothing new.
 */
export function notUnderPredicate(
  table: TableDef,
  tree: TreeMeta,
  id: string,
): SQL {
  const tableName = sql.identifier(getTableConfig(table.drizzle).name);
  const pk = findPkColumn(table);
  const parent = requireColumn(table, tree.parentColumn);
  const under = sql.identifier("sapporta_tree_under");
  const underId = sql.identifier("id");
  return sql`${pk} not in (with recursive ${under}(${underId}) as (select ${pk} from ${tableName} where ${pk} = ${id} union select ${pk} from ${tableName} join ${under} on ${parent} = ${under}.${underId}) select ${underId} from ${under})`;
}

/**
 * An order clause that sorts the top-level rows of a tree by
 * `tree.rootOrder`: rows whose `column` holds the first listed value come
 * first, and rows whose value is not listed come last. Every row below the
 * top level sorts the same, so siblings keep the order of the clauses after
 * this one, such as the table's `defaultSort`. Absent without `rootOrder`.
 */
export function treeRootOrderClause(
  table: TableDef,
  tree: TreeMeta,
): SQL | undefined {
  const order = tree.rootOrder;
  if (!order) return undefined;
  const parent = requireColumn(table, tree.parentColumn);
  const column = requireColumn(table, order.column);
  const ranks = order.values.map(
    (value, index) => sql`when ${value} then ${index}`,
  );
  return sql`case when ${parent} is null then (case ${column} ${sql.join(ranks, sql` `)} else ${order.values.length} end) else 0 end`;
}

/** A row of a tree in display order, and how deep it sits. */
export interface TreeOrderedRow<TRow> {
  readonly row: TRow;
  readonly depth: number;
}

/**
 * Puts the rows of a tree in display order: depth-first, each row followed by
 * its children. Siblings keep the order of `rows`, so the query's order
 * decides it.
 *
 * Every row is returned once. A row whose parent is not among `rows`, such as
 * one under a row the request may not read, is shown at the top level. Rows
 * in a loop of parents never reach a top-level row; the first of them in
 * `rows` is shown at the top level, and the others under it.
 */
export function treeDisplayOrder<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  keyColumn: string,
  parentColumn: string,
): TreeOrderedRow<TRow>[] {
  const keyOf = (value: unknown): RecordId | null =>
    typeof value === "string" || typeof value === "number"
      ? toRecordId(value)
      : null;
  const keys = new Set(rows.map((row) => keyOf(row[keyColumn])));
  const children = new Map<RecordId, TRow[]>();
  const tops: TRow[] = [];
  for (const row of rows) {
    const parent = keyOf(row[parentColumn]);
    if (parent === null || !keys.has(parent)) {
      tops.push(row);
      continue;
    }
    const siblings = children.get(parent) ?? [];
    siblings.push(row);
    children.set(parent, siblings);
  }

  const ordered: TreeOrderedRow<TRow>[] = [];
  const placed = new Set<TRow>();
  const place = (top: TRow) => {
    const stack: TreeOrderedRow<TRow>[] = [{ row: top, depth: 0 }];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (placed.has(next.row)) continue;
      placed.add(next.row);
      ordered.push(next);
      const key = keyOf(next.row[keyColumn]);
      const below = key === null ? [] : (children.get(key) ?? []);
      for (let index = below.length - 1; index >= 0; index -= 1) {
        stack.push({ row: below[index]!, depth: next.depth + 1 });
      }
    }
  };
  for (const top of tops) place(top);
  for (const row of rows) place(row);
  return ordered;
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
