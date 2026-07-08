import type { ColumnHeaderMenuProps } from "@sapporta/grid/column-preset";
import type { TypedFilterCondition } from "@sapporta/shared/filter";
import type { ColumnSchema as GridColumnSchema } from "@sapporta/grid";
import { lookupCapabilities, preset } from "@sapporta/grid/column-preset";
import type { LookupForColumn } from "../../lookup";
import { HeaderFilterMenuContent } from "../filters/HeaderFilterPopover";
import type { TGridFilter } from "./tgrid-filter";
import type { TGridTableColumnMeta } from "./tgrid-column-mapper";

export function renderTGridHeaderMenu(
  props: ColumnHeaderMenuProps<TGridTableColumnMeta, TGridFilter>,
): React.ReactNode {
  return <TGridHeaderMenu {...props} />;
}

function TGridHeaderMenu({
  level,
  column,
  commands,
  close,
}: ColumnHeaderMenuProps<TGridTableColumnMeta, TGridFilter>) {
  const meta = tableColumnMetaOf(column.column);
  if (!meta) return null;

  const filter = level.filter ?? { conditions: [], search: null };
  const columns = level.schema
    .map(tableColumnMetaOf)
    .filter((value): value is TGridTableColumnMeta => value !== null)
    .map((value) => value.schema)
    .filter((tableColumn) => !tableColumn.visuallyHidden);
  const lookupForColumn = lookupForGridColumn(level.schema);

  if (!commands.setFilter || !commands.setSort) return null;

  const setConditions = (conditions: TypedFilterCondition[]) =>
    commands.setFilter?.({ ...filter, conditions });

  return (
    <HeaderFilterMenuContent
      column={meta.schema}
      columns={columns}
      filters={filter.conditions}
      lookupForColumn={lookupForColumn}
      sort={level.sort ? [...level.sort] : []}
      sortColumnId={column.column.id}
      onSort={commands.setSort}
      onAddFilter={(cond) => setConditions([...filter.conditions, cond])}
      onUpdateFilter={(id, patch) =>
        setConditions(
          filter.conditions.map((cond) =>
            cond.id === id ? { ...patch, id } : cond,
          ),
        )
      }
      onRemoveFilter={(id) =>
        setConditions(filter.conditions.filter((cond) => cond.id !== id))
      }
      close={close}
    />
  );
}

function lookupForGridColumn(
  columns: readonly GridColumnSchema[],
): LookupForColumn {
  return (column) => {
    const gridColumn = columns.find((candidate) => {
      const meta = tableColumnMetaOf(candidate);
      return meta?.schema.name === column.name;
    });
    if (!gridColumn) return undefined;
    const columnPreset = preset(gridColumn);
    return columnPreset ? lookupCapabilities(columnPreset) : undefined;
  };
}

function tableColumnMetaOf(
  column: Pick<GridColumnSchema, "meta">,
): TGridTableColumnMeta | null {
  const value = column.meta;
  if (typeof value !== "object" || value === null) return null;
  if (!("table" in value) || typeof value.table !== "string") return null;
  if (!("schema" in value) || !isTableColumnSchema(value.schema)) return null;
  if (!("displayType" in value) || typeof value.displayType !== "string") {
    return null;
  }
  return value as TGridTableColumnMeta;
}

function isTableColumnSchema(
  value: unknown,
): value is TGridTableColumnMeta["schema"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
  );
}
