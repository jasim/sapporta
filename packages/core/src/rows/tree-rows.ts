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

function requireColumn(table: TableDef, name: string): SQLiteColumn {
  const column = columnBySqlName(table, name);
  if (!column) {
    throw new Error(
      `Tree column "${table.sqlName}.${name}" could not be bound.`,
    );
  }
  return column;
}
