import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { TableSchema } from "@sapporta/shared/contracts";
import type { TGridRowsByLevel } from "../tgrid/tgrid-types";
import type { TGridSession } from "../tgrid/tgrid-session";
import { tableRowKey } from "../tgrid/tgrid-runtime-config";

// Opening a table at one of its rows. A page that creates a row navigates to
// its table with `showTableRowState` as the location state; the table page
// then shows that row once its rows have loaded: the cursor on it, the
// branches above it open. On a flat table that has not loaded the row, the
// saved row joins the top of the loaded rows.

export type TableRowToShow = {
  rowKey: string;
  /** The row as the table API saved it, when the page that saved it has it. */
  savedRow?: Readonly<Record<string, unknown>>;
};

export type ShowTableRowState = {
  showTableRow: TableRowToShow & { table: string };
};

/** Location state that asks a table's page to show one of its rows. */
export function showTableRowState(
  table: string,
  rowKey: string,
  savedRow?: Readonly<Record<string, unknown>>,
): ShowTableRowState {
  return {
    showTableRow: { table, rowKey, ...(savedRow ? { savedRow } : {}) },
  };
}

/** The row a location asks this table to show, if any. */
export function tableRowToShow(
  state: unknown,
  table: string,
): TableRowToShow | null {
  if (typeof state !== "object" || state === null) return null;
  const request = (state as Partial<ShowTableRowState>).showTableRow;
  if (typeof request !== "object" || request === null) return null;
  if (request.table !== table || typeof request.rowKey !== "string") {
    return null;
  }
  const savedRow = request.savedRow;
  return typeof savedRow === "object" && savedRow !== null
    ? { rowKey: request.rowKey, savedRow }
    : { rowKey: request.rowKey };
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
  return rowKey === null || !row
    ? undefined
    : showTableRowState(table.name, rowKey, row);
}

// Coming back to a table page. The New record form opens with the table
// page's query string in its location state, and goes back to the table with
// it, so the user returns to the page, sort, search and filters they left.

export type TableReturnState = { tableSearch: string };

/** Location state for a page that returns to a table page with `search`. */
export function tableReturnState(search: string): TableReturnState {
  return { tableSearch: search };
}

/** The table page URL to return to from a location with `state`. */
export function tableReturnUrl(table: string, state: unknown): string {
  const search =
    typeof state === "object" && state !== null
      ? (state as Partial<TableReturnState>).tableSearch
      : undefined;
  const query = typeof search === "string" ? search.replace(/^\?/, "") : "";
  return `/tables/${table}${query ? `?${query}` : ""}`;
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
  const request = tableRowToShow(location.state, table);
  const rowKey = request?.rowKey ?? null;
  const savedRow = request?.savedRow;
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
    void session.showRow(rowKey, {
      savedRow,
      clearQueryIfHidden: true,
    });
  }, [
    location.key,
    location.pathname,
    location.search,
    navigate,
    rowKey,
    savedRow,
    session,
  ]);
}
