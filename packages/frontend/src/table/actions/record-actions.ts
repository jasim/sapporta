import { getNavigate } from "../../app/router/router-bridge";
import { createTableRow } from "../api/rows";
import { reloadTGridRows } from "../tgrid/tgrid-session-registry";

export async function createRecord(
  tableName: string,
  data: Record<string, unknown>,
) {
  const res = await createTableRow(tableName, data);
  reloadTGridRows(tableName);
  try {
    getNavigate()(`/tables/${tableName}`, { replace: true });
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
