import type { NavLink } from "../contracts/meta-schema.js";
import { hrefPlaceholderColumns } from "../contracts/link-placeholders.js";
import type { GridDataset, GridDatasetLevel } from "./result-schema.js";

/**
 * Checks that every declarative link in a dataset reads only columns its
 * level actually has. Bind sources and url `{column}` placeholders resolve
 * against the row's `columns` values, and a name that matches no column
 * would silently withhold the link on every row — indistinguishable from a
 * legitimately NULL value. Table-declared links get the equivalent check at
 * server boot (schema extraction); datasets are app-built and first meet
 * the framework when a grid binds them, so the grid runs this check there
 * and fails loudly.
 *
 * Returns one message per problem, naming the level and declaration site;
 * empty when every link is well-formed.
 */
export function gridDatasetLinkProblems(dataset: GridDataset): string[] {
  const problems: string[] = [];
  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const columnIds = new Set(level.columns.map((column) => column.id));
    for (const [link, where] of declaredLevelLinks(level)) {
      for (const source of unknownLinkColumns(link, columnIds)) {
        problems.push(
          `Dataset "${dataset.name}" level "${levelName}" ${where} ` +
            `declares a link reading unknown column "${source}".`,
        );
      }
    }
  }
  return problems;
}

function declaredLevelLinks(
  level: GridDatasetLevel,
): Array<[NavLink, string]> {
  const links: Array<[NavLink, string]> = [];
  for (const column of level.columns) {
    for (const link of column.links ?? []) {
      links.push([link, `column "${column.id}"`]);
    }
  }
  for (const link of level.rowLinks ?? []) {
    links.push([link, "rowLinks"]);
  }
  return links;
}

/** Columns a link reads (bind sources, url placeholders) that are not in
 *  `columnIds`. */
function unknownLinkColumns(
  link: NavLink,
  columnIds: ReadonlySet<string>,
): string[] {
  const read = Object.values(link.bind ?? {});
  if (link.kind === "url") read.push(...hrefPlaceholderColumns(link.href));
  return read.filter((column) => !columnIds.has(column));
}
