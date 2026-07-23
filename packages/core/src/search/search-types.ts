/** Values from the current table node that participate in table search. */
export type SearchSelf = false | "allColumns" | readonly string[];

/**
 * Describes the values that represent one root row during table search.
 *
 * Child keys are SQL table names declared by the current table's
 * `meta.children`. Traversal happens only where it is explicitly configured.
 */
export type TableSearch =
  | false
  | "allColumns"
  | {
      self?: SearchSelf;
      children?: Readonly<Record<string, TableSearch>>;
    };

export type NormalizedTableSearch =
  | false
  | "allColumns"
  | {
      readonly self: SearchSelf;
      readonly children: Readonly<Record<string, NormalizedTableSearch>>;
    };

/**
 * Applies table-search defaults and rejects shapes that cannot describe a
 * finite, useful search.
 */
export function normalizeTableSearch(
  search: TableSearch | undefined,
): NormalizedTableSearch {
  return normalizeNode(search ?? "allColumns", new Set<object>());
}

function normalizeNode(
  search: TableSearch,
  ancestors: Set<object>,
): NormalizedTableSearch {
  if (search === false || search === "allColumns") return search;

  if (ancestors.has(search)) {
    throw new Error(
      "Table search configuration contains a cyclic object reference.",
    );
  }

  const self = search.self ?? "allColumns";
  if (Array.isArray(self) && self.length === 0) {
    throw new Error(
      "Table search self columns cannot be empty. Use self: false instead.",
    );
  }

  ancestors.add(search);
  const children: Record<string, NormalizedTableSearch> = {};
  for (const [tableName, childSearch] of Object.entries(
    search.children ?? {},
  )) {
    children[tableName] = normalizeNode(childSearch, ancestors);
  }
  ancestors.delete(search);

  return Object.freeze({
    self: Array.isArray(self) ? Object.freeze([...self]) : self,
    children: Object.freeze(children),
  });
}
