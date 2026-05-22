import { useEffect, useSyncExternalStore } from "react";
import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import {
  mintFilterId,
  type FilterCondition,
  type NewFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnHeaderMenuProps } from "@/column-preset";
import { lookupCapabilities } from "@/column-preset";
import { HeaderFilterMenuContent } from "@/table/filters/HeaderFilterPopover";
import type { FkOptionsMap } from "@/lookup/types";
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
  const tableColumn = column.meta?.schema;
  if (!tableColumn) return null;

  const columnPreset = column.preset;
  const searchLookup = columnPreset
    ? lookupCapabilities(columnPreset)?.searchLookup
    : undefined;

  useEffect(() => {
    void searchLookup?.loadSearchResults({ searchText: "", limit: 5000 });
  }, [searchLookup]);

  const searchEntries = useSyncExternalStore(
    (listener) =>
      searchLookup?.subscribeToLookupChanges(listener) ?? subscribeNoop(),
    () =>
      searchLookup?.cachedSearchResults({ searchText: "" }) ?? EMPTY_ENTRIES,
  );

  const filter = level.filter ?? { conditions: [], search: null };
  const tableColumns = level.schema
    .map((c) => c.meta)
    .filter(isTGridTableColumnMeta)
    .map((m) => m.schema);
  const fkOptions = searchLookup
    ? ({
        [tableColumn.name]: lookupToKeyedValues(searchEntries),
      } satisfies FkOptionsMap)
    : undefined;

  const setConditions = (conditions: FilterCondition[]) =>
    commands.setFilter({ ...filter, conditions });

  return (
    <HeaderFilterMenuContent
      column={tableColumn}
      columns={tableColumns}
      filters={filter.conditions}
      fkOptions={fkOptions}
      sort={level.sort ?? []}
      onSort={commands.setSort}
      onAddFilter={(cond) =>
        setConditions([...filter.conditions, withFilterId(cond)])
      }
      onUpdateFilter={(id, patch) =>
        setConditions(
          filter.conditions.map((cond) =>
            cond.id === id ? ({ ...patch, id } as FilterCondition) : cond,
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

function withFilterId(cond: NewFilterCondition): FilterCondition {
  return { ...cond, id: mintFilterId(cond.column, cond.op) } as FilterCondition;
}

function lookupToKeyedValues(
  entries: readonly { value: unknown; label: string }[],
): Record<string, string> {
  return Object.fromEntries(
    entries.map((option) => [String(option.value), option.label]),
  );
}

function isTGridTableColumnMeta(value: unknown): value is TGridTableColumnMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    "displayType" in value
  );
}

function subscribeNoop() {
  return () => {};
}

const EMPTY_ENTRIES: readonly [] = [];
