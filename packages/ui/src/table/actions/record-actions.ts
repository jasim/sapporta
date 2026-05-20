import { getNavigate } from "@/app/router/router-bridge";
import { createRow } from "@/table/api/rows";
import { refetchTable } from "@/table/state/table-grid-registry";

export async function createRecord(
  tableName: string,
  data: Record<string, unknown>,
) {
  const res = await createRow(tableName, data);
  refetchTable(tableName);
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
