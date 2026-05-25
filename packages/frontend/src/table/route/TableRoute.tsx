/**
 * Route component for /p/:projectId/tables/:tableName
 *
 * The route owns table-grid shell effects (active sidebar state, key hints) and
 * delegates the table surface to the table page.
 */

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { useKeyHints, type KeyHint } from "@/shell/state/hints-store";
import { TablePage } from "@/table/page/TablePage";

// Static: module-level so useEffect doesn't re-run every render.
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
  const { loaded, tables } = useSchemaStore();
  const tableSchema = tables.find((t) => t.name === tableName);

  useKeyHints(TABLE_HINTS);

  useEffect(() => {
    if (!tableName || !tableSchema) return;
    useSchemaStore.getState().setActiveTable(tableName);
  }, [tableName, tableSchema]);

  if (!loaded) return null;
  if (!tableName || !tableSchema) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        Table not found
      </div>
    );
  }

  return <TablePage key={tableName} tableName={tableName} />;
}
