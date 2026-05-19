/**
 * Route component for /p/:projectId/tables/:tableName
 *
 * The route owns shell-level effects (active sidebar state, create-drawer URL
 * sync, key hints) and delegates the table surface to the new grid page.
 */

import { useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useSchemaStore } from "../stores/schema-store";
import { useDrawerStore } from "../stores/drawer-store";
import { useKeyHints, type KeyHint } from "../stores/hints-store";
import { NewTablePage } from "../components/table-new/NewTablePage";

// Static — module-level so useEffect doesn't re-run every render.
const TABLE_HINTS: KeyHint[] = [
  { key: "↑↓", desc: "navigate" },
  { key: "⏎", desc: "edit / commit" },
  { key: "space", desc: "expand row" },
  { key: "⌘N", desc: "new row" },
  { key: "⌘K", desc: "command" },
  { key: "⌘F", desc: "find" },
  { key: "⌘E", desc: "export" },
];

export function TableRoute() {
  const { tableName } = useParams<{ tableName: string }>();
  const location = useLocation();
  const isNewRoute = location.pathname.endsWith("/new");
  const { loaded, tables } = useSchemaStore();
  const tableExists = tables.some((t) => t.name === tableName);

  useKeyHints(TABLE_HINTS);

  useEffect(() => {
    if (!tableName || !tableExists) return;
    useSchemaStore.getState().setActiveTable(tableName);
  }, [tableName, tableExists]);

  useEffect(() => {
    if (!loaded || !tableName || !tableExists) return;

    const drawer = useDrawerStore.getState();
    if (isNewRoute) {
      if (!drawer.open || drawer.tableName !== tableName) {
        drawer.openCreate(tableName);
      }
    } else if (drawer.open) {
      drawer.close();
    }
  }, [loaded, tableName, tableExists, isNewRoute]);

  if (!loaded) return null;
  if (!tableName || !tableExists) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        Table not found
      </div>
    );
  }

  return <NewTablePage key={tableName} tableName={tableName} />;
}
