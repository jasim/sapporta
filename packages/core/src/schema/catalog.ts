import type { TableDef } from "./table.js";
import {
  compileSearchPlans,
  type SearchPlan,
  type SearchPlanWarning,
} from "../search/search-plan.js";

export interface TableCatalog {
  readonly tables: readonly TableDef[];
  readonly searchWarnings: readonly SearchPlanWarning[];
  get(name: string): TableDef | undefined;
  has(name: string): boolean;
  searchPlanFor(tableName: string): SearchPlan;
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
  const compiledSearch = compileSearchPlans(orderedTables);

  return {
    tables: Object.freeze(orderedTables),
    searchWarnings: compiledSearch.warnings,
    get(name) {
      return byName.get(name);
    },
    has(name) {
      return byName.has(name);
    },
    searchPlanFor(tableName) {
      const plan = compiledSearch.plans.get(tableName);
      if (!plan) {
        throw new Error(
          `Cannot resolve a search plan for unregistered table "${tableName}".`,
        );
      }
      return plan;
    },
  };
}
