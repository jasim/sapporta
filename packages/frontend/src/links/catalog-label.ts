import { useSchemaStore } from "../schema-catalog/state/schema-store";

/** Display-label lookup for link destinations, backed by the loaded schema
 *  catalog. Returns undefined when the table is unknown or not yet loaded. */
export function catalogTableLabel(table: string): string | undefined {
  return useSchemaStore.getState().tables.find((t) => t.name === table)?.label;
}
