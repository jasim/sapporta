import { getNavigate } from "../router/router-bridge";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";

export function navigateToTable(tableName: string) {
  useSchemaStore.getState().setActiveTable(tableName);
  try {
    getNavigate()(`/tables/${tableName}`);
  } catch {
    // Router bridge not initialized.
  }
}
