import { getNavigate } from "../../app/router/router-bridge";
import { createTableRow } from "../api/rows";
import { reloadTGridRows } from "../tgrid/tgrid-session-registry";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { showCreatedRowState } from "../page/show-table-row";

export async function createRecord(
  tableName: string,
  data: Record<string, unknown>,
) {
  const res = await createTableRow(tableName, data);
  reloadTGridRows(tableName);
  const table = useSchemaStore
    .getState()
    .tables.find((one) => one.name === tableName);
  try {
    // The table opens on the new row when it is on the loaded rows.
    getNavigate()(`/tables/${tableName}`, {
      replace: true,
      state: table ? showCreatedRowState(table, res.data) : undefined,
    });
  } catch {
    // Router bridge not initialized.
  }
  return res.data;
}

export function navigateToNewRecord(tableName: string) {
  try {
    getNavigate()(`/tables/${tableName}/new`);
  } catch {
    // Router bridge not initialized.
  }
}
