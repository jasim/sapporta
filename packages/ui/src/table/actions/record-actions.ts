import { getNavigate } from "@/app/router/router-bridge";
import { createRow } from "@/table/api/rows";
import { useDrawerStore } from "@/table/state/drawer-store";
import { refetchTable } from "@/table/state/table-grid-registry";

export async function createRecord(
  tableName: string,
  data: Record<string, unknown>,
) {
  const res = await createRow(tableName, data);
  refetchTable(tableName);
  useDrawerStore.getState().close();
  try {
    getNavigate()(`/tables/${tableName}`, { replace: true });
  } catch {
    // Router bridge not initialized.
  }
  return res.data;
}

export function openDrawerCreate(tableName: string) {
  useDrawerStore.getState().openCreate(tableName);
  try {
    getNavigate()(`/tables/${tableName}/new`);
  } catch {
    // Router bridge not initialized.
  }
}

export function closeDrawer() {
  const tableName = useDrawerStore.getState().tableName;
  useDrawerStore.getState().close();
  if (tableName) {
    try {
      getNavigate()(`/tables/${tableName}`, { replace: true });
    } catch {
      // Router bridge not initialized.
    }
  }
}
