import { getNavigate } from "@/app/router/router-bridge";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";

export function navigateToReport(reportName: string) {
  useSchemaStore.getState().setActiveReport(reportName);
  try {
    getNavigate()(`/reports/${reportName}`);
  } catch {
    // Router bridge not initialized.
  }
}

export function navigateToTable(tableName: string) {
  useSchemaStore.getState().setActiveTable(tableName);
  try {
    getNavigate()(`/tables/${tableName}`);
  } catch {
    // Router bridge not initialized.
  }
}
