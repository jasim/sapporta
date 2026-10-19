import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TGridRowsByLevel } from "../tgrid/tgrid-types";
import type { TGridSession } from "../tgrid/tgrid-session";
import { tableRowKey } from "../tgrid/tgrid-runtime-config";

// Opening a table at one of its rows. A page that creates a row navigates to
// its table with `showTableRowState` as the location state; the table page
// then shows that row once its rows have loaded: the cursor on it, the
// branches above it open, a search or filter that leaves it out cleared.

export type ShowTableRowState = {
  showTableRow: { table: string; rowKey: string };
};

/** Location state that asks a table's page to show one of its rows. */
export function showTableRowState(
  table: string,
  rowKey: string,
): ShowTableRowState {
  return { showTableRow: { table, rowKey } };
}

/** The row a location asks this table to show, if any. */
export function tableRowToShow(state: unknown, table: string): string | null {
  if (typeof state !== "object" || state === null) return null;
  const request = (state as Partial<ShowTableRowState>).showTableRow;
  if (typeof request !== "object" || request === null) return null;
  return request.table === table && typeof request.rowKey === "string"
    ? request.rowKey
    : null;
}

/**
 * Location state that asks a table's page to show a row the table API just
 * created, read from its primary key. A bulk create answers with every row;
 * the first is the one to show. Undefined when the answer has no row key.
 */
export function showCreatedRowState(
  table: TableSchema,
  created: Record<string, unknown> | readonly Record<string, unknown>[],
): ShowTableRowState | undefined {
  const row = Array.isArray(created) ? created[0] : created;
  const primaryKey = table.columns.find((column) => column.primary);
  const rowKey = primaryKey && row ? tableRowKey(row, primaryKey.name) : null;
  return rowKey === null ? undefined : showTableRowState(table.name, rowKey);
}

/**
 * Shows the row the current location asks for, once, through the table's
 * live session. The request is then removed from the location, so Back and
 * reload don't show the row again.
 */
export function useShowTableRowFromLocation<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
>(table: string, session: TGridSession<RowsByLevel, AppServices> | null) {
  const location = useLocation();
  const navigate = useNavigate();
  const rowKey = tableRowToShow(location.state, table);
  // Strict Mode runs the effect twice for one location; show the row once.
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (session === null || rowKey === null) return;
    if (shownFor.current === location.key) return;
    shownFor.current = location.key;
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
    void session.showRow(rowKey, { clearQueryIfHidden: true });
  }, [
    location.key,
    location.pathname,
    location.search,
    navigate,
    rowKey,
    session,
  ]);
}
