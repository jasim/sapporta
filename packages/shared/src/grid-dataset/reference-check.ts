import { toRecordId, type RecordId } from "../record-id.js";
import type {
  GridDataset,
  GridDatasetFooterRow,
  GridDatasetNode,
} from "./result-schema.js";

/**
 * Checks that every `reference` column names an `idColumn` its level has. A
 * misnamed id column would otherwise draw every cell as plain text, which
 * looks like a table without a row display.
 *
 * Returns one message per problem, naming the level and column; empty when
 * every reference is well-formed.
 */
export function gridDatasetReferenceProblems(dataset: GridDataset): string[] {
  const problems: string[] = [];
  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const columnIds = new Set(level.columns.map((column) => column.id));
    for (const column of level.columns) {
      const reference = column.reference;
      if (!reference || columnIds.has(reference.idColumn)) continue;
      problems.push(
        `Dataset "${dataset.name}" level "${levelName}" column ` +
          `"${column.id}" references table "${reference.table}" through ` +
          `unknown id column "${reference.idColumn}".`,
      );
    }
  }
  return problems;
}

/**
 * The ids of the rows each referenced table is named by, across every level,
 * node, child and footer row of the dataset. Each id appears once per table,
 * in the order first met. Empty ids (`null`, `undefined`, `""`) are skipped.
 */
export function gridDatasetReferenceIds(
  dataset: GridDataset,
): Map<string, RecordId[]> {
  // Level name → [table, idColumn] pairs of its reference columns.
  const referencesByLevel = new Map<string, Array<[string, string]>>();
  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const pairs: Array<[string, string]> = [];
    for (const column of level.columns) {
      if (column.reference) {
        pairs.push([column.reference.table, column.reference.idColumn]);
      }
    }
    if (pairs.length > 0) referencesByLevel.set(levelName, pairs);
  }

  const idsByTable = new Map<string, Set<RecordId>>();
  if (referencesByLevel.size === 0) return new Map();

  const collect = (
    levelName: string,
    columns: Readonly<Record<string, unknown>>,
  ) => {
    for (const [table, idColumn] of referencesByLevel.get(levelName) ?? []) {
      const value = columns[idColumn];
      if (typeof value !== "string" && typeof value !== "number") continue;
      if (value === "") continue;
      const ids = idsByTable.get(table) ?? new Set<RecordId>();
      ids.add(toRecordId(value));
      idsByTable.set(table, ids);
    }
  };
  const collectFooter = (
    levelName: string,
    rows: readonly GridDatasetFooterRow[] | undefined,
  ) => {
    for (const row of rows ?? []) collect(levelName, row.columns);
  };
  const visit = (nodes: readonly GridDatasetNode[]) => {
    for (const node of nodes) {
      collect(node.levelName, node.columns);
      for (const children of Object.values(node.children ?? {})) {
        visit(children);
      }
      for (const [levelName, rows] of Object.entries(
        node.childFooterRows ?? {},
      )) {
        collectFooter(levelName, rows);
      }
    }
  };
  visit(dataset.nodes);
  collectFooter(dataset.rootLevel, dataset.footerRows);

  return new Map(
    Array.from(idsByTable, ([table, ids]) => [table, Array.from(ids)]),
  );
}
