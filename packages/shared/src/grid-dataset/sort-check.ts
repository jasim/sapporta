import type { GridDataset } from "./result-schema.js";

/**
 * Checks that every `sortBy` entry is a column of the level. A misnamed entry
 * would otherwise compare a field no row has, which leaves ties in the order
 * they were sent.
 *
 * Returns one message per problem, naming the level and column; empty when
 * every `sortBy` names columns the level has.
 */
export function gridDatasetSortProblems(dataset: GridDataset): string[] {
  const problems: string[] = [];
  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const where = `Dataset "${dataset.name}" level "${levelName}"`;
    const columnIds = new Set(level.columns.map((column) => column.id));

    for (const column of level.columns) {
      for (const id of column.sortBy ?? []) {
        if (columnIds.has(id)) continue;
        problems.push(
          `${where} column "${column.id}" sorts by unknown column "${id}".`,
        );
      }
    }
  }
  return problems;
}
