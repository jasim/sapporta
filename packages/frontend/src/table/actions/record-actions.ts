import { getNavigate } from "../../app/router/router-bridge";
import { createTableRow } from "../api/rows";
import { reloadTGridRows } from "../tgrid/tgrid-session-registry";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { showCreatedRowState, tableReturnState } from "../page/show-table-row";

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
    // The table opens on the new row, at the top of the loaded rows when
    // they don't already hold it.
    getNavigate()(`/tables/${tableName}`, {
      replace: true,
      state: table ? showCreatedRowState(table, res.data) : undefined,
    });
  } catch {
    // Router bridge not initialized.
  }
  return res.data;
}

/**
 * Opens a table's New record form. Pass the table page's query string as
 * `tableSearch` so the form returns to the same page, sort, search and
 * filters.
 */
export function navigateToNewRecord(tableName: string, tableSearch?: string) {
  try {
    getNavigate()(
      `/tables/${tableName}/new`,
      tableSearch ? { state: tableReturnState(tableSearch) } : undefined,
    );
  } catch {
    // Router bridge not initialized.
  }
}
