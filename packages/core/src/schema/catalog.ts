import type { TableDef } from "./table.js";

export interface TableCatalog {
  readonly tables: readonly TableDef[];
  get(name: string): TableDef | undefined;
  has(name: string): boolean;
}

/**
 * Immutable table catalog loaded from project schema files at server boot.
 *
 * The project must restart after schema changes, so runtime code only needs a
 * stable ordered list plus name lookup.
 */
export function createTableCatalog(tables: readonly TableDef[]): TableCatalog {
  const orderedTables = [...tables];
  const byName = new Map<string, TableDef>();

  for (const def of orderedTables) {
    const existing = byName.get(def.sqlName);
    if (existing) {
      throw new Error(`Duplicate table schema "${def.sqlName}" loaded.`);
    }
    byName.set(def.sqlName, def);
  }

  return {
    tables: Object.freeze(orderedTables),
    get(name) {
      return byName.get(name);
    },
    has(name) {
      return byName.has(name);
    },
  };
}
