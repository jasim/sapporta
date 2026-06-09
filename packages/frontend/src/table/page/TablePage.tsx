import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { TableSchema } from "@sapporta/shared/contracts";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { navigateToNewRecord } from "@/table/actions/record-actions";
import { defineSchemaTGrid } from "@/table/grid-adapter/schema-tgrid";
import { TableGridView } from "./TableGridView";

type SchemaDrivenRowsByLevel = Record<string, Record<string, unknown>>;

// Built-in table route for `/tables/:tableName`.
// It is intentionally small: the route supplies schema, URL state, navigation,
// and the "new record" action, while the reusable table view owns the shared
// table controls.
export function TablePage({ tableName }: { tableName: string }) {
  const tableSchema = useSchemaStore((s) =>
    s.tables.find((t) => t.name === tableName),
  );
  const tables = useSchemaStore((s) => s.tables);

  if (!tableSchema) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        We could not find the schema for "{tableName}".
      </div>
    );
  }

  return (
    <TablePageWithSession
      tableName={tableName}
      tableSchema={tableSchema}
      tables={tables}
    />
  );
}

function TablePageWithSession({
  tableName,
  tableSchema,
  tables,
}: {
  tableName: string;
  tableSchema: TableSchema;
  tables: readonly TableSchema[];
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // The schema helper needs quick access to every table because child rows are
  // declared by table name in `table.children`.
  const tablesByName = useMemo(
    () => Object.fromEntries(tables.map((table) => [table.name, table])),
    [tables],
  );

  const definition = useMemo(() => {
    return defineSchemaTGrid({
      rootTableName: tableSchema.name,
      tablesByName,
      rootLevelQuery: { urlSync: true },
    });
  }, [tableSchema.name, tablesByName]);

  return (
    <TableGridView<SchemaDrivenRowsByLevel>
      definition={definition}
      table={tableSchema}
      searchParams={searchParams}
      navigate={navigate}
      registerAs={tableName}
      onNewRecord={
        tableSchema.immutable
          ? undefined
          : () => navigateToNewRecord(tableSchema.name)
      }
    />
  );
}
