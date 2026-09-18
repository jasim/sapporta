import type { GridDataset, GridDatasetLevel } from "./result-schema.js";

/**
 * The column that shows a tree level's hierarchy: the declared
 * `tree.column`, else the first visible text column, else the first visible
 * column. `null` for a level without `tree`, or when the declared column is
 * not a visible column of the level.
 */
export function gridDatasetTreeColumn(level: GridDatasetLevel): string | null {
  if (!level.tree) return null;
  const visible = level.columns.filter(
    (column) => column.visuallyHidden !== true,
  );
  const declared = level.tree.column;
  if (declared !== undefined) {
    return visible.some((column) => column.id === declared) ? declared : null;
  }
  return (
    visible.find((column) => column.kind === "text")?.id ??
    visible[0]?.id ??
    null
  );
}

/**
 * Checks the columns each tree level names: its parent column is a column of
 * the level, and its tree column is a visible column of the level. A
 * misnamed parent column would otherwise show every row at top level, which
 * looks like a report without a hierarchy.
 *
 * Returns one message per problem, naming the level; empty when every tree
 * declaration names columns the level has.
 */
export function gridDatasetTreeProblems(dataset: GridDataset): string[] {
  const problems: string[] = [];
  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const tree = level.tree;
    if (!tree) continue;
    const where = `Dataset "${dataset.name}" tree level "${levelName}"`;

    if (!level.columns.some((column) => column.id === tree.parentColumn)) {
      problems.push(
        `${where} names unknown parent column "${tree.parentColumn}".`,
      );
    }
    if (gridDatasetTreeColumn(level) === null) {
      problems.push(
        tree.column === undefined
          ? `${where} has no visible column to show the tree.`
          : `${where} names tree column "${tree.column}", ` +
              `which is not a visible column of the level.`,
      );
    }
  }
  return problems;
}
